/**
 * Aggregates vault-watcher's (#114) indexed events into the raw numbers
 * `GET /metrics/tvl` (#115) serves. Pure function over `VaultEvent[]` -
 * no I/O, no sqlite, no network - so it's trivially unit-testable and can
 * be recomputed from scratch at any time from `readAllVaultEvents()`.
 */
import { readAllVaultEvents, type VaultEvent } from "./event-store.js";

export interface TvlSummary {
  /** Sum of all deposit amounts minus all withdraw amounts, in USDC
   * stroops. Reflects money in vs. money out - it does NOT include yield
   * accrued in the underlying Blend strategy, which only shows up in the
   * vault's own on-chain `totalManagedFunds` (see routes/metrics.ts's
   * reconciliation against that). */
  netDepositedStroops: bigint;
  /** Count of distinct depositor addresses across the vault's lifetime
   * (anyone who ever deposited), not currently-active depositors - the
   * simpler, more common "unique depositors" metric, and what #116's
   * retention cohorts key off next. */
  uniqueDepositors: number;
}

/** Defaults to reading every persisted event; accepts an explicit list so
 * callers (and tests) can compute a summary without touching sqlite. */
export function computeTvlSummary(events: VaultEvent[] = readAllVaultEvents()): TvlSummary {
  let netDepositedStroops = 0n;
  const depositors = new Set<string>();

  for (const event of events) {
    const amount = BigInt(event.amountStroops);
    if (event.kind === "deposit") {
      netDepositedStroops += amount;
      depositors.add(event.depositor);
    } else {
      netDepositedStroops -= amount;
    }
  }

  return { netDepositedStroops, uniqueDepositors: depositors.size };
}
