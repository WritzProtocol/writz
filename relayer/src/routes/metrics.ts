import { Router, Request, Response } from "express";
import { config } from "../config.js";
import { defindexSdk, defindexNetwork } from "../defindex/client.js";
import { mapDefindexError } from "../defindex/errors.js";
import { computeTvlSummary } from "../vault-watcher/metrics.js";

export const metricsRouter = Router();

/**
 * GET /metrics/tvl
 * Success 200: { "tvlStroops": "200000000", "onChainTvlStroops": "200000000", "uniqueDepositors": 1 }
 *
 * `tvlStroops` is net deposits minus withdrawals, summed from
 * vault-watcher's (#114) indexed events - matches this issue's "aggregates
 * indexed events into current TVL" wording, and needs no network call.
 *
 * `onChainTvlStroops` is the vault's live `totalManagedFunds[0].total_amount`
 * from `@defindex/sdk`, included so the two numbers can be reconciled
 * (this issue's acceptance criterion). They can legitimately diverge:
 * `onChainTvlStroops` includes yield the Blend strategy has accrued, which
 * the events-derived figure doesn't model - a small gap is expected, not a
 * bug. A gap too large for yield to plausibly explain (more than 20% of
 * the events-derived figure) is logged as a warning rather than failing
 * the request - a stale/missing indexer run shouldn't take metrics
 * offline, just get flagged for a human to look at.
 */
metricsRouter.get("/tvl", async (_req: Request, res: Response): Promise<void> => {
  if (!config.defindexVaultId) {
    res.status(500).json({ error: "DEFINDEX_VAULT_ID not configured" });
    return;
  }

  const { netDepositedStroops, uniqueDepositors } = computeTvlSummary();

  try {
    const info = await defindexSdk.getVaultInfo(config.defindexVaultId, defindexNetwork);
    const onChainTvlStroops = info.totalManagedFunds[0]?.total_amount ?? "0";

    const diff = BigInt(onChainTvlStroops) - netDepositedStroops;
    const diffAbs = diff < 0n ? -diff : diff;
    if (netDepositedStroops > 0n && diffAbs * 100n > netDepositedStroops * 20n) {
      console.warn(
        `[metrics] TVL divergence beyond plausible yield: events say ${netDepositedStroops}, on-chain says ${onChainTvlStroops}`,
      );
    }

    res.json({
      tvlStroops: netDepositedStroops.toString(),
      onChainTvlStroops,
      uniqueDepositors,
    });
  } catch (err) {
    const { status, error } = mapDefindexError(err);
    res.status(status).json({ error });
  }
});
