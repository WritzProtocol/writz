/**
 * In-memory, per-process rate limiter. Deliberately simple: a fixed window
 * counter per key, stored in a Map that self-prunes on access.
 *
 * Explicit limitation: this resets on redeploy/restart and does not
 * coordinate across multiple instances - it protects a single process from
 * being hammered, not a fleet from being hammered in aggregate. That matches
 * this app's current deployment reality (see docs/architecture/technical-overview.md
 * and the relayer/keeper architecture notes in docs/roadmap/phases.md - nothing
 * in this stack runs multi-instance today). If that changes, replace this with
 * a shared store (e.g. Upstash Redis) keyed the same way; the call site
 * (`checkRateLimit`) is the only thing that would need to change.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

// Prune expired windows opportunistically so this Map never grows unbounded
// across the life of the process, without needing a background timer.
function prune(now: number) {
  for (const [key, w] of windows) {
    if (w.resetAt <= now) windows.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the caller may retry. Only set when `allowed` is false. */
  retryAfterMs?: number;
}

/**
 * Returns whether `key` is still within `limit` requests per `windowMs`.
 * Call once per request, before doing any real work, so a request over the
 * limit doesn't pay for the RPC calls / proof verification it would trigger.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  if (windows.size > 10_000) prune(now); // cheap bound on worst-case memory

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (existing.count >= limit) {
    return { allowed: false, retryAfterMs: existing.resetAt - now };
  }

  existing.count += 1;
  return { allowed: true };
}

/**
 * Best-effort client identifier from standard proxy headers. Falls back to a
 * constant so a misconfigured proxy degrades to "one shared bucket" rather
 * than silently disabling rate limiting (empty/undefined key would otherwise
 * bypass it if the caller isn't careful).
 */
export function clientKeyFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
