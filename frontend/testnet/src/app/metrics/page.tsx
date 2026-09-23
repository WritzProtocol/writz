import Link from "next/link";
import { getTvlMetrics, getRetentionCohorts, type RetentionCohort, type TvlMetrics } from "@/lib/metrics/api";
import { analyzeCohort, summarizeCohorts } from "@/lib/metrics/cohort";
import { fmtUsdc } from "@/lib/earn/amount";
import { humanizeError } from "@/lib/errors";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ExternalLink } from "lucide-react";

// Read live metrics at request time - never statically prerendered.
export const dynamic = "force-dynamic";

/**
 * Real, permanent DeFindex vault contract ID (testnet). Not "mock data" -
 * this is a fixed on-chain address, same category as the literal contract
 * addresses documented in the root CLAUDE.md's testnet table. Source of
 * truth: contracts/deployments/defindex-vault-testnet.md.
 */
const VAULT_CONTRACT_ADDRESS = "CBMHGL7GGGHODEDDJ5H2LKJEFHJWBRSQUKOXMC4FKOFDZK5HBKW6PI2S";

export default async function MetricsPage() {
  let tvl: TvlMetrics;
  let cohorts: RetentionCohort[];
  try {
    [tvl, cohorts] = await Promise.all([getTvlMetrics(), getRetentionCohorts()]);
  } catch (e) {
    return (
      <DashboardLayout
        breadcrumbs={[
          { label: "WRITZ COMMAND", href: "/" },
          { label: "EARN METRICS", active: true },
        ]}
      >
        <div className="rounded-xl border border-crit/40 bg-crit/10 p-5 text-sm text-crit">
          <p className="font-semibold">Could not read live metrics</p>
          <p className="mt-1 font-mono text-xs break-all">{humanizeError(e)}</p>
        </div>
      </DashboardLayout>
    );
  }

  const formattedTvl = fmtUsdc(tvl.onChainTvlStroops);
  const formattedNet = fmtUsdc(tvl.tvlStroops);

  const yieldStroops = tvl.onChainTvlStroops - tvl.tvlStroops;
  const formattedYield =
    yieldStroops > 0n ? `+${fmtUsdc(yieldStroops)}` : "0.00";

  const summary = summarizeCohorts(cohorts);
  const retentionLabel =
    summary.aggregateRetentionPercent === null
      ? "TOO EARLY TO TELL"
      : `${summary.aggregateRetentionPercent}% RETENTION`;
  const firstDepositLabel = cohorts[0]?.cohort ?? "—";

  return (
    <DashboardLayout
      breadcrumbs={[
        { label: "WRITZ COMMAND", href: "/" },
        { label: "EARN METRICS", active: true },
      ]}
    >
      <div className="flex flex-col gap-6">
        {/* ── Top Row: 3 Practical Metric Cards ──────────────────────── */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {/* Card 1: Total Value Locked */}
          <div className="rounded-lg border border-line bg-surface p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-line pb-3">
                <span className="font-mono text-xs font-bold tracking-widest uppercase text-head">
                  TOTAL VALUE LOCKED
                </span>
                <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted">
                  On-Chain SAC
                </span>
              </div>

              <div className="mt-4">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono text-3xl sm:text-4xl font-bold text-hi tabular-nums">
                    ${formattedTvl}
                  </span>
                  <span className="font-mono text-xs text-muted uppercase">
                    USDC
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted font-mono">
                  Live balance in DeFindex USDC Vault
                </p>
              </div>

              <div className="mt-5 space-y-2 border-t border-line pt-3 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-muted">Net Indexed Deposits:</span>
                  <span className="text-body font-medium">${formattedNet} USDC</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Accrued Yield:</span>
                  <span className="text-ok font-medium">{formattedYield} USDC</span>
                </div>
              </div>
            </div>

            <div className="mt-4 border-t border-line pt-2.5 text-[11px] font-mono text-muted flex justify-between">
              <span>PRECISION: 7 DECIMALS</span>
              <span className="text-ok">SYNCED</span>
            </div>
          </div>

          {/* Card 2: Unique Depositors */}
          <div className="rounded-lg border border-line bg-surface p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-line pb-3">
                <span className="font-mono text-xs font-bold tracking-widest uppercase text-head">
                  UNIQUE DEPOSITORS
                </span>
                <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted">
                  Wallets
                </span>
              </div>

              <div className="mt-4">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-3xl sm:text-4xl font-bold text-hi tabular-nums">
                    {tvl.uniqueDepositors}
                  </span>
                  <span className="font-mono text-xs text-muted uppercase">
                    {tvl.uniqueDepositors === 1 ? "participant" : "participants"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted font-mono">
                  Distinct funded accounts since genesis
                </p>
              </div>

              <div className="mt-5 space-y-2 border-t border-line pt-3 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-muted">Vault Stage:</span>
                  <span className="text-body font-medium">Genesis Testnet</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">First Depositor:</span>
                  <span className="text-body font-medium">{firstDepositLabel}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 border-t border-line pt-2.5 text-[11px] font-mono text-muted flex justify-between">
              <span>{tvl.uniqueDepositors > 0 ? "STATUS: ACTIVE" : "STATUS: NO DEPOSITS YET"}</span>
              <span className="text-hi font-bold">{retentionLabel}</span>
            </div>
          </div>

          {/* Card 3: Vault Parameters & Strategy */}
          <div className="rounded-lg border border-line bg-surface p-5 flex flex-col justify-between md:col-span-2 lg:col-span-1">
            <div>
              <div className="flex items-center justify-between border-b border-line pb-3">
                <span className="font-mono text-xs font-bold tracking-widest uppercase text-head">
                  VAULT PARAMETERS
                </span>
                <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted">
                  Soroban 22
                </span>
              </div>

              <div className="mt-4 space-y-3 font-mono text-xs">
                <div>
                  <span className="text-muted block text-[11px]">Vault Contract:</span>
                  <a
                    href={`https://stellar.expert/explorer/testnet/contract/${VAULT_CONTRACT_ADDRESS}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amber hover:underline flex items-center gap-1 mt-0.5 truncate"
                  >
                    <span className="truncate">{VAULT_CONTRACT_ADDRESS}</span>
                    <ExternalLink size={11} className="shrink-0" />
                  </a>
                </div>

                <div className="flex justify-between border-t border-line/60 pt-2">
                  <span className="text-muted">Underlying Asset:</span>
                  <span className="text-head">BlendUSDC</span>
                </div>

                <div className="flex justify-between border-t border-line/60 pt-2">
                  <span className="text-muted">Strategy:</span>
                  <span className="text-head">Blend Lending Pool</span>
                </div>

                <div className="flex justify-between border-t border-line/60 pt-2">
                  <span className="text-muted">Vault Fee:</span>
                  <span className="text-amber font-medium">100 bps (1% on yield)</span>
                </div>
              </div>
            </div>

            <div className="mt-4 border-t border-line pt-2.5 text-[11px] font-mono text-muted flex justify-between">
              <span>FACTORY: DEFINDEX</span>
              <span className="text-ok">NON-CUSTODIAL</span>
            </div>
          </div>
        </div>

        {/* ── Main Section: 30-Day Retention Cohorts Table ──────────── */}
        <div className="rounded-lg border border-line bg-surface p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-3">
            <div>
              <h2 className="font-mono text-xs font-bold tracking-widest uppercase text-head">
                30-DAY RETENTION COHORTS
              </h2>
              <p className="text-xs text-muted mt-0.5 font-sans">
                Tracking whether depositors keep funds in the vault 30 days after their first deposit.
              </p>
            </div>
            <span className="font-mono text-xs text-amber font-medium">
              30-Day Horizon
            </span>
          </div>

          {/* Cohort Table */}
          {cohorts.length === 0 ? (
            <p className="py-8 text-center text-xs font-mono text-muted">
              No deposit cohorts recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-left font-mono text-xs" role="table">
                <thead>
                  <tr className="border-b border-line text-muted uppercase text-[11px] tracking-wider">
                    <th scope="col" className="pb-3 pr-4 font-semibold whitespace-nowrap">
                      Cohort (First Deposit)
                    </th>
                    <th scope="col" className="pb-3 px-4 text-right font-semibold whitespace-nowrap">
                      Depositors
                    </th>
                    <th scope="col" className="pb-3 px-4 text-right font-semibold whitespace-nowrap">
                      Eligible (30d)
                    </th>
                    <th scope="col" className="pb-3 px-4 text-right font-semibold whitespace-nowrap">
                      Retained
                    </th>
                    <th scope="col" className="pb-3 px-4 font-semibold min-w-[180px]">
                      Retention Trajectory
                    </th>
                    <th scope="col" className="pb-3 pl-4 text-right font-semibold whitespace-nowrap">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {cohorts.map((cohort) => {
                    const analysis = analyzeCohort(cohort);
                    const isSeasoning = analysis.state === "seasoning";
                    const seasoningDays = analysis.seasoningDays;
                    const retainedPct = analysis.retentionPercent ?? 0;
                    const churnedPct = analysis.eligible > 0 ? 100 - retainedPct : 0;

                    return (
                      <tr key={cohort.cohort} className="hover:bg-surface-2/30 transition-colors">
                        {/* Cohort Date */}
                        <td className="py-3.5 pr-4 text-hi font-medium whitespace-nowrap">
                          {cohort.cohort}
                        </td>

                        {/* Total Depositors */}
                        <td className="py-3.5 px-4 text-right text-body tabular-nums">
                          {cohort.depositors}
                        </td>

                        {/* Eligible */}
                        <td className="py-3.5 px-4 text-right text-body tabular-nums">
                          {cohort.eligible}
                        </td>

                        {/* Retained */}
                        <td className="py-3.5 px-4 text-right text-body tabular-nums">
                          {cohort.retained}
                        </td>

                        {/* Retention Visual Trajectory Bar */}
                        <td className="py-3.5 px-4 align-middle">
                          <div className="flex items-center gap-3">
                            <div
                              className="h-2 w-28 overflow-hidden rounded-full border border-line bg-surface-2"
                              aria-hidden="true"
                            >
                              {isSeasoning ? (
                                <div className="h-full w-full bg-amber/40 animate-pulse" />
                              ) : (
                                <div className="flex h-full w-full">
                                  {retainedPct > 0 && (
                                    <div
                                      className="bg-ok h-full"
                                      style={{ width: `${retainedPct}%` }}
                                    />
                                  )}
                                  {churnedPct > 0 && (
                                    <div
                                      className="bg-crit/70 h-full"
                                      style={{ width: `${churnedPct}%` }}
                                    />
                                  )}
                                </div>
                              )}
                            </div>

                            <span className="text-[11px] text-muted whitespace-nowrap">
                              {isSeasoning ? `Day ${seasoningDays}/30` : `${retainedPct}%`}
                            </span>
                          </div>
                        </td>

                        {/* Status Badge */}
                        <td className="py-3.5 pl-4 text-right whitespace-nowrap">
                          {isSeasoning ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber/30 bg-amber/10 px-2.5 py-0.5 text-[11px] text-amber">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber" />
                              Seasoning (&lt;30d)
                            </span>
                          ) : retainedPct === 100 ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/30 bg-ok/10 px-2.5 py-0.5 text-[11px] text-ok">
                              <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                              100% Retained
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-surface-2 px-2.5 py-0.5 text-[11px] text-hi">
                              {retainedPct}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Explanatory Caption */}
          <div className="mt-4 pt-3 border-t border-line flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-[11px] font-mono text-muted">
            <span>
              A cohort younger than 30 days displays 0 eligible depositors — outcome is in flight until day 30.
            </span>
            <Link href="/" className="text-amber hover:underline shrink-0">
              Enter Vault →
            </Link>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
