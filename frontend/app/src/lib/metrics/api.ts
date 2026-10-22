/**
 * Client for the relayer's metrics routes (#114-#117).
 *
 * Separate from `@/lib/earn/api.ts`'s DeFindex client on purpose: that file
 * is the wire contract for epic #101's transaction flows, this one is for
 * epic #113's read-only aggregates - mirrors the relayer's own split between
 * `routes/defindex.ts` and `routes/metrics.ts`. No wallet, no signing, no
 * per-user data - these numbers are protocol-wide, not gated behind a
 * connected address.
 */
import { config } from "@/config";

export interface TvlMetrics {
  /** Net deposits minus withdrawals, from indexed events, in USDC stroops. */
  tvlStroops: bigint;
  /** The vault's live on-chain total (includes accrued yield), in USDC
   * stroops - what's actually shown as "TVL", since it's the true current
   * figure rather than the events-derived approximation. */
  onChainTvlStroops: bigint;
  uniqueDepositors: number;
}

export interface RetentionCohort {
  /** UTC calendar day of this cohort's first deposit, `YYYY-MM-DD`. */
  cohort: string;
  depositors: number;
  /** How many of this cohort's depositors have reached their individual
   * 30-day mark - a cohort younger than 30 days has depositors who are
   * neither retained nor churned yet. */
  eligible: number;
  /** Of the eligible depositors, how many still held a positive balance at
   * their 30-day mark. */
  retained: number;
}

function relayerBase(): string {
  const url = config.services.relayerUrl;
  if (!url) throw new Error("NEXT_PUBLIC_RELAYER_URL is not configured");
  return url.replace(/\/$/, "");
}

async function request<T>(path: string): Promise<T> {
  // Deliberately outside the try/catch below: relayerBase()'s "not
  // configured" error must propagate as-is, not get relabeled as "Relayer
  // unreachable" - the two map to different, non-interchangeable messages
  // in humanizeError (a deployment misconfiguration vs. a transient network
  // failure), and conflating them showed a misleading Bitcoin-confirmation
  // message on this metrics page for what was actually a missing env var.
  const base = relayerBase();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { cache: "no-store" });
  } catch {
    throw new Error("Relayer unreachable");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Relayer error ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * GET /metrics/tvl -> { tvlStroops: string, onChainTvlStroops: string, uniqueDepositors: number }
 */
export async function getTvlMetrics(): Promise<TvlMetrics> {
  const raw = await request<{ tvlStroops: string; onChainTvlStroops: string; uniqueDepositors: number }>(
    "/metrics/tvl",
  );
  return {
    tvlStroops: BigInt(raw.tvlStroops),
    onChainTvlStroops: BigInt(raw.onChainTvlStroops),
    uniqueDepositors: raw.uniqueDepositors,
  };
}

/**
 * GET /metrics/retention -> { cohorts: RetentionCohort[] }
 */
export async function getRetentionCohorts(): Promise<RetentionCohort[]> {
  const raw = await request<{ cohorts: RetentionCohort[] }>("/metrics/retention");
  return raw.cohorts;
}
