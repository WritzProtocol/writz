import { Router, type Request, type Response } from "express";
import { rateLimit, clientKey } from "../rate-limit.js";
import { FaucetError, PUBLIC_SIGNET_FAUCETS, type SignetFaucet } from "../faucet/service.js";

export interface FaucetRouterDeps {
  /** Undefined when the faucet is not configured; every call then answers 503. */
  faucet: SignetFaucet | undefined;
  /** Why it is off, for the 503 body and the status route. */
  disabledReason: string;
  /** Per-IP budget for POST /faucet/signet attempts (successful or not) per window. */
  rateLimit: number;
  rateWindowMs: number;
  now?: () => number;
}

/**
 * GET  /faucet/signet  status: enabled, amount, daily cap left, faucet address, balance
 * POST /faucet/signet  { address }  pays the configured amount to a Signet address
 */
export function createFaucetRouter(deps: FaucetRouterDeps): Router {
  const router = Router();

  // A burst limit on attempts, on top of the per-claim cooldowns: invalid or
  // refused requests are cheap, but each valid one costs Esplora calls.
  const attempts = rateLimit({
    name: "faucet",
    limit: deps.rateLimit,
    windowMs: deps.rateWindowMs,
    ...(deps.now ? { now: deps.now } : {}),
    body: (retryAfterSeconds) => ({
      error: "rate_limited",
      message: "too many faucet requests from this address; slow down",
      retryAfterSeconds,
    }),
  });

  const disabled = (res: Response) =>
    res.status(503).json({
      error: "faucet_disabled",
      message: `the Writz Signet faucet is not available: ${deps.disabledReason}`,
      publicFaucets: PUBLIC_SIGNET_FAUCETS,
    });

  router.get("/signet", async (_req: Request, res: Response) => {
    if (!deps.faucet) {
      res.json({ enabled: false, network: "signet", reason: deps.disabledReason, publicFaucets: PUBLIC_SIGNET_FAUCETS });
      return;
    }
    res.json(await deps.faucet.status());
  });

  router.post("/signet", attempts, async (req: Request, res: Response) => {
    if (!deps.faucet) {
      disabled(res);
      return;
    }
    try {
      const result = await deps.faucet.claim(req.body?.address, clientKey(req));
      res.json({ ...result, explorerUrl: `https://mempool.space/signet/tx/${result.txid}` });
    } catch (e) {
      if (e instanceof FaucetError) {
        if (e.retryAfterSeconds !== undefined) res.setHeader("Retry-After", String(e.retryAfterSeconds));
        res.status(e.httpStatus).json({
          error: e.code,
          message: e.message,
          ...(e.retryAfterSeconds !== undefined ? { retryAfterSeconds: e.retryAfterSeconds } : {}),
          ...(e.code === "faucet_empty" || e.code === "upstream_unavailable" ? { publicFaucets: PUBLIC_SIGNET_FAUCETS } : {}),
        });
        return;
      }
      console.error(JSON.stringify({ evt: "faucet_error", message: e instanceof Error ? e.message : String(e) }));
      res.status(500).json({ error: "internal_error", message: "the faucet could not complete this claim" });
    }
  });

  return router;
}
