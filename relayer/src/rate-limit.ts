import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * In-memory, per-process fixed-window rate limiter - the same shape as the
 * frontend's `/api/cosign` limiter (frontend/src/lib/rateLimit.ts). It resets
 * on restart and does not coordinate across instances; the relayer runs as a
 * single Railway service, so that is the protection that matters today.
 */

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Bucket namespace, so separate limiters never share a counter. */
  name: string;
  limit: number;
  windowMs: number;
  now?: () => number;
  /** JSON body of the 429 response; defaults to a plain `{ error }`. */
  body?: (retryAfterSeconds: number) => object;
}

export interface RateLimiter extends RequestHandler {
  reset(): void;
}

/**
 * The client address as Express resolves it under the app's `trust proxy`
 * setting (TRUST_PROXY_HOPS, applied in index.ts). With one trusted hop it is
 * the right-most X-Forwarded-For entry, the one Railway's edge writes; the
 * left-most entry is whatever the caller sent and cannot key a limiter.
 * Falls back to a constant so a missing address degrades to one shared
 * bucket rather than no limit at all.
 */
export function clientKey(req: Request): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

export function rateLimit({ name, limit, windowMs, now = Date.now, body }: RateLimitOptions): RateLimiter {
  const windows = new Map<string, Window>();

  const handler = ((req: Request, res: Response, next: NextFunction) => {
    const t = now();
    if (windows.size > 10_000) {
      for (const [k, w] of windows) if (w.resetAt <= t) windows.delete(k);
    }

    const key = clientKey(req);
    const existing = windows.get(key);
    if (!existing || existing.resetAt <= t) {
      windows.set(key, { count: 1, resetAt: t + windowMs });
      next();
      return;
    }

    if (existing.count >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - t) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json(body ? body(retryAfterSeconds) : { error: "Too many requests - slow down and try again shortly" });
      console.warn(JSON.stringify({ evt: "rate_limited", limiter: name, path: req.originalUrl.split("?")[0] }));
      return;
    }

    existing.count += 1;
    next();
  }) as RateLimiter;

  handler.reset = () => windows.clear();
  return handler;
}
