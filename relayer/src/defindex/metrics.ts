import type { Request, Response, NextFunction, RequestHandler } from "express";

export type VaultRoute = "apy" | "position" | "deposit" | "withdraw";

interface RouteStats {
  requests: number;
  clientErrors: number;
  serverErrors: number;
  rateLimited: number;
  totalMs: number;
  maxMs: number;
  consecutiveServerErrors: number;
  lastServerErrorAt: string | null;
}

/**
 * Consecutive 5xx responses on one route before an alert line is logged.
 * Low enough to page on a real DeFindex outage, high enough that one flaky
 * upstream call doesn't.
 */
export const ALERT_AFTER_CONSECUTIVE_FAILURES = 5;

const ROUTES: VaultRoute[] = ["apy", "position", "deposit", "withdraw"];

function emptyStats(): RouteStats {
  return {
    requests: 0,
    clientErrors: 0,
    serverErrors: 0,
    rateLimited: 0,
    totalMs: 0,
    maxMs: 0,
    consecutiveServerErrors: 0,
    lastServerErrorAt: null,
  };
}

const stats = new Map<VaultRoute, RouteStats>(ROUTES.map((r) => [r, emptyStats()]));

export function recordVaultRequest(route: VaultRoute, status: number, durationMs: number, at = new Date()): void {
  const s = stats.get(route)!;
  s.requests += 1;
  s.totalMs += durationMs;
  s.maxMs = Math.max(s.maxMs, durationMs);

  const line = { evt: "defindex_request", route, status, durationMs: Math.round(durationMs) };

  if (status >= 500) {
    s.serverErrors += 1;
    s.consecutiveServerErrors += 1;
    s.lastServerErrorAt = at.toISOString();
    console.error(JSON.stringify(line));
    // Logged exactly once per failure streak so a log-based alert fires once,
    // not on every request of an ongoing outage.
    if (s.consecutiveServerErrors === ALERT_AFTER_CONSECUTIVE_FAILURES) {
      console.error(
        `[ALERT] defindex ${route}: ${s.consecutiveServerErrors} consecutive server errors (last status ${status})`,
      );
    }
    return;
  }

  if (s.consecutiveServerErrors >= ALERT_AFTER_CONSECUTIVE_FAILURES) {
    console.warn(`[RECOVERED] defindex ${route}: succeeded after ${s.consecutiveServerErrors} consecutive server errors`);
  }
  s.consecutiveServerErrors = 0;

  if (status === 429) s.rateLimited += 1;
  else if (status >= 400) s.clientErrors += 1;
  console.log(JSON.stringify(line));
}

/** Records the response for `route` once it has been sent, whatever produced it. */
export function trackVaultRoute(route: VaultRoute): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    const start = performance.now();
    res.on("finish", () => recordVaultRequest(route, res.statusCode, performance.now() - start));
    next();
  };
}

export interface VaultRouteSnapshot {
  requests: number;
  clientErrors: number;
  serverErrors: number;
  rateLimited: number;
  avgMs: number;
  maxMs: number;
  failing: boolean;
  lastServerErrorAt: string | null;
}

export function vaultMetricsSnapshot(): Record<VaultRoute, VaultRouteSnapshot> {
  const out = {} as Record<VaultRoute, VaultRouteSnapshot>;
  for (const [route, s] of stats) {
    out[route] = {
      requests: s.requests,
      clientErrors: s.clientErrors,
      serverErrors: s.serverErrors,
      rateLimited: s.rateLimited,
      avgMs: s.requests ? Math.round(s.totalMs / s.requests) : 0,
      maxMs: Math.round(s.maxMs),
      failing: s.consecutiveServerErrors >= ALERT_AFTER_CONSECUTIVE_FAILURES,
      lastServerErrorAt: s.lastServerErrorAt,
    };
  }
  return out;
}

export function resetVaultMetrics(): void {
  for (const r of ROUTES) stats.set(r, emptyStats());
}
