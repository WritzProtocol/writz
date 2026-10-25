import { Router, type Request, type Response } from "express";
import { rateLimit } from "../rate-limit.js";
import { FunnelError, type OnboardingFunnel } from "../onboarding/funnel.js";

export interface OnboardingRouterDeps {
  funnel: OnboardingFunnel;
  /** Per-IP budget for POST /metrics/onboarding/events per window. */
  rateLimit: number;
  rateWindowMs: number;
  now?: () => number;
}

/**
 * The testnet onboarding funnel (see `onboarding/funnel.ts`).
 *
 * GET  /metrics/onboarding         counts per step, per day, the faucet outcomes and the headline
 * POST /metrics/onboarding/events  { step, stellarAddress, channel?, txid? } from the app
 */
export function createOnboardingRouter(deps: OnboardingRouterDeps): Router {
  const router = Router();
  const limit = rateLimit({
    name: "onboarding-events",
    limit: deps.rateLimit,
    windowMs: deps.rateWindowMs,
    ...(deps.now ? { now: deps.now } : {}),
    body: (retryAfterSeconds) => ({ error: "rate_limited", message: "too many events from this address", retryAfterSeconds }),
  });

  router.get("/", (_req: Request, res: Response) => {
    res.json(deps.funnel.summary());
  });

  router.post("/events", limit, async (req: Request, res: Response) => {
    try {
      res.status(202).json(await deps.funnel.report(req.body));
    } catch (e) {
      if (e instanceof FunnelError) {
        res.status(e.httpStatus).json({ error: e.code, message: e.message });
        return;
      }
      console.error(JSON.stringify({ evt: "onboarding_event_error", message: e instanceof Error ? e.message : String(e) }));
      res.status(500).json({ error: "internal_error", message: "the event could not be recorded" });
    }
  });

  return router;
}
