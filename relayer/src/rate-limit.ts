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
}

export interface RateLimiter extends RequestHandler {
  reset(): void;
}

/**
 * First hop of X-Forwarded-For, as set by Railway's edge. Falls back to a
 * constant so a missing header degrades to one shared bucket rather than no
 * limit at all.
 */
export function clientKey(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  if (first) return first;
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) return realIp.trim();
  return "unknown";
}

export function rateLimit({ name, limit, windowMs, now = Date.now }: RateLimitOptions): RateLimiter {
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
      res.setHeader("Retry-After", String(Math.ceil((existing.resetAt - t) / 1000)));
      res.status(429).json({ error: "Too many requests - slow down and try again shortly" });
      console.warn(JSON.stringify({ evt: "rate_limited", limiter: name, path: req.originalUrl.split("?")[0] }));
      return;
    }

    existing.count += 1;
    next();
  }) as RateLimiter;

  handler.reset = () => windows.clear();
  return handler;
}
