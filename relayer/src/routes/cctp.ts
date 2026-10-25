import { Router, type Request, type Response } from "express";
import { rateLimit } from "../rate-limit.js";
import { RelayError, type CctpRelay } from "../cctp/service.js";

export interface CctpRouterDeps {
  /** Undefined when the relay is not configured; POST and the per-burn GET then answer 503. */
  relay: CctpRelay | undefined;
  /** Why it is off, for the 503 body and the status route. */
  disabledReason: string;
  /** Per-IP budget for POST /cctp/relay attempts per window. */
  rateLimit: number;
  rateWindowMs: number;
  now?: () => number;
}

/**
 * GET  /cctp/relay             status: enabled, relay address and its Base Sepolia ETH balance, mints today
 * POST /cctp/relay  {burnHash} starts completing a Stellar burn on Base Sepolia; answers where it stands
 * GET  /cctp/relay/:burnHash   where a transfer stands, for the app to poll
 */
export function createCctpRouter(deps: CctpRouterDeps): Router {
  const router = Router();

  // Each new burn hash costs Iris polls for up to the confirmation window, so
  // attempts are limited per IP on top of the in-flight and daily caps.
  const attempts = rateLimit({
    name: "cctp-relay",
    limit: deps.rateLimit,
    windowMs: deps.rateWindowMs,
    ...(deps.now ? { now: deps.now } : {}),
    body: (retryAfterSeconds) => ({
      error: "rate_limited",
      message: "too many relay requests from this address; slow down",
      retryAfterSeconds,
    }),
  });

  const disabled = (res: Response) =>
    res.status(503).json({
      error: "cctp_relay_disabled",
      message: `the Writz CCTP relay is not available: ${deps.disabledReason}`,
    });

  const answerError = (res: Response, e: unknown) => {
    if (e instanceof RelayError) {
      if (e.retryAfterSeconds !== undefined) res.setHeader("Retry-After", String(e.retryAfterSeconds));
      res.status(e.httpStatus).json({
        error: e.code,
        message: e.message,
        ...(e.retryAfterSeconds !== undefined ? { retryAfterSeconds: e.retryAfterSeconds } : {}),
      });
      return;
    }
    console.error(JSON.stringify({ evt: "cctp_relay_route_error", message: e instanceof Error ? e.message : String(e) }));
    res.status(500).json({ error: "internal_error", message: "the relay could not answer this request" });
  };

  router.get("/relay", async (_req: Request, res: Response) => {
    if (!deps.relay) {
      res.json({ enabled: false, network: "base-sepolia", reason: deps.disabledReason });
      return;
    }
    res.json(await deps.relay.info());
  });

  router.post("/relay", attempts, (req: Request, res: Response) => {
    if (!deps.relay) {
      disabled(res);
      return;
    }
    try {
      const view = deps.relay.request(req.body?.burnHash);
      // 202 while the relay is still working on it, 200 once it is settled.
      res.status(view.kind === "arrived" || view.kind === "failed" ? 200 : 202).json(view);
    } catch (e) {
      answerError(res, e);
    }
  });

  router.get("/relay/:burnHash", (req: Request, res: Response) => {
    if (!deps.relay) {
      disabled(res);
      return;
    }
    try {
      res.json(deps.relay.status(req.params["burnHash"]));
    } catch (e) {
      answerError(res, e);
    }
  });

  return router;
}
