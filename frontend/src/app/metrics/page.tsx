import { getTvlMetrics, getRetentionCohorts, type RetentionCohort } from "@/lib/metrics/api";
import { fmtUsdc } from "@/lib/earn/amount";
import { humanizeError } from "@/lib/errors";

// Reads the relayer's live metrics at request time - never statically
// prerendered, so this always reflects the latest indexed events.
export const dynamic = "force-dynamic";

function retentionRate(cohort: RetentionCohort): string {
  if (cohort.eligible === 0) return "—";
  return `${Math.round((cohort.retained / cohort.eligible) * 100)}%`;
}

export default async function MetricsPage() {
  let tvlStroops: bigint | null = null;
  let uniqueDepositors: number | null = null;
  let cohorts: RetentionCohort[] = [];
  let error: string | null = null;

  try {
    const [tvl, retention] = await Promise.all([getTvlMetrics(), getRetentionCohorts()]);
    tvlStroops = tvl.onChainTvlStroops;
    uniqueDepositors = tvl.uniqueDepositors;
    cohorts = retention;
  } catch (e) {
    error = humanizeError(e);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-12 px-6 py-20 sm:py-28">
      <header className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <span className="inline-block h-4 w-4 rotate-45 border border-amber" />
          <span className="font-serif text-xl text-hi">Writz</span>
        </div>
        <div>
          <h1 className="font-serif text-3xl text-head">Earn metrics</h1>
          <p className="mt-2 text-sm text-body">
            Live totals from the Writz DeFindex USDC vault, aggregated from indexed deposit and
            withdraw events.
          </p>
        </div>
      </header>

      {error ? (
        <p className="text-sm text-crit">{error}</p>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Total value locked
              </p>
              <p className="mt-2 font-mono text-2xl tabular-nums text-hi">
                {tvlStroops !== null ? `${fmtUsdc(tvlStroops)} USDC` : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-line bg-surface p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Unique depositors
              </p>
              <p className="mt-2 font-mono text-2xl tabular-nums text-hi">
                {uniqueDepositors ?? "—"}
              </p>
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="font-serif text-xl text-head">30-day retention cohorts</h2>
            {cohorts.length === 0 ? (
              <p className="text-sm text-muted">No cohorts yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs font-semibold uppercase tracking-wider text-muted">
                      <th className="px-4 py-3">First deposit</th>
                      <th className="px-4 py-3">Depositors</th>
                      <th className="px-4 py-3">Eligible</th>
                      <th className="px-4 py-3">Retained</th>
                      <th className="px-4 py-3">Retention</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cohorts.map((cohort) => (
                      <tr key={cohort.cohort} className="border-b border-line last:border-0">
                        <td className="px-4 py-3 font-mono text-body">{cohort.cohort}</td>
                        <td className="px-4 py-3 font-mono tabular-nums text-body">
                          {cohort.depositors}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-body">
                          {cohort.eligible}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-body">
                          {cohort.retained}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-hi">
                          {retentionRate(cohort)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted">
              A cohort younger than 30 days shows fewer eligible depositors than its total - too
              early to tell whether they stayed.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
