import { Router, type Request, type Response } from "express";
import { rateLimit, clientKey } from "../rate-limit.js";
import { FaucetError, PUBLIC_SIGNET_FAUCETS, SOCIAL_LOGIN_ONLY_MESSAGE, type SignetFaucet } from "../faucet/service.js";

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
 * The Signet faucet funds accounts created through the Writz testnet app's
 * social login, once each. It is not a public faucet.
 *
 * GET  /faucet/signet        status: who can claim, amount, daily cap left, whether it is funded
 * GET  /faucet/signet/nonce  a single-use challenge, valid five minutes
 * POST /faucet/signet        { pollarAccessToken, stellarAddress, signetAddress, signetPubkey, nonce, keySig }
 *                            pays the configured amount to signetAddress (see ClaimRequest in faucet/service.ts)
 */
export function createFaucetRouter(deps: FaucetRouterDeps): Router {
  const router = Router();

  // A burst limit on attempts, on top of the per-claim limits: invalid or
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

  // Challenges are cheap but kept in memory: a separate budget of the same size.
  const nonceRequests = rateLimit({
    name: "faucet-nonce",
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
      reason: deps.disabledReason,
      publicFaucets: PUBLIC_SIGNET_FAUCETS,
    });

  router.get("/signet", async (_req: Request, res: Response) => {
    if (!deps.faucet) {
      res.json({
        enabled: false,
        network: "signet",
        access: "testnet_app_social_login",
        message: SOCIAL_LOGIN_ONLY_MESSAGE,
        reason: deps.disabledReason,
        publicFaucets: PUBLIC_SIGNET_FAUCETS,
      });
      return;
    }
    res.json(await deps.faucet.status());
  });

  router.get("/signet/nonce", nonceRequests, (_req: Request, res: Response) => {
    if (!deps.faucet) {
      disabled(res);
      return;
    }
    const { nonce, expiresAt } = deps.faucet.issueNonce();
    res.json({ nonce, expiresAt: new Date(expiresAt).toISOString() });
  });

  router.post("/signet", attempts, async (req: Request, res: Response) => {
    if (!deps.faucet) {
      disabled(res);
      return;
    }
    try {
      const result = await deps.faucet.claim(req.body, clientKey(req));
      res.json({ ...result, explorerUrl: `https://mempool.space/signet/tx/${result.txid}` });
    } catch (e) {
      if (e instanceof FaucetError) {
        if (e.retryAfterSeconds !== undefined) res.setHeader("Retry-After", String(e.retryAfterSeconds));
        res.status(e.httpStatus).json({
          error: e.code,
          message: e.message,
          ...(e.retryAfterSeconds !== undefined ? { retryAfterSeconds: e.retryAfterSeconds } : {}),
          ...(e.code === "faucet_empty" || e.code === "upstream_unavailable" || e.code === "daily_cap_reached"
            ? { publicFaucets: PUBLIC_SIGNET_FAUCETS }
            : {}),
        });
        return;
      }
      console.error(JSON.stringify({ evt: "faucet_error", message: e instanceof Error ? e.message : String(e) }));
      res.status(500).json({ error: "internal_error", message: "the faucet could not complete this claim" });
    }
  });

  return router;
}
