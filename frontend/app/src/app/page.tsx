import { getPoolState, type PoolState } from "@/lib/contracts/commitmentTree";
import { AppTabs } from "@/components/AppTabs";
import { DashboardLayout } from "@/components/DashboardLayout";
import { humanizeError } from "@/lib/errors";

// Read on-chain state at request time; never statically prerendered.
export const dynamic = "force-dynamic";

const STROOP = 10_000_000n; // USDC uses 7 decimals

function formatStroops(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = (abs / STROOP).toLocaleString("en-US");
  const frac = (abs % STROOP).toString().padStart(7, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export default async function AppDashboardPage() {
  let pool: PoolState | null = null;
  let error: string | null = null;

  try {
    pool = await getPoolState();
  } catch (e) {
    error = humanizeError(e);
  }

  return (
    <DashboardLayout
      breadcrumbs={[
        { label: "WRITZ COMMAND", href: "/" },
        { label: "OVERVIEW", active: true },
      ]}
    >
      <div className="flex flex-col gap-8">
        {/* Editorial Section Headline */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 font-mono text-xs text-amber tracking-wider uppercase">
            <span className="h-1.5 w-1.5 rounded-full bg-amber" />
            <span>Bitcoin-backed lending on Stellar testnet</span>
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl text-hi leading-tight">
            Lock Bitcoin.{" "}
            <span className="italic text-amber">Borrow dollars.</span>
          </h1>
          <p className="text-sm text-body max-w-2xl leading-relaxed">
            Lock BTC on Bitcoin and borrow USDC on Stellar. Repay and your BTC
            comes back. No bridge, no custodian, no wrapped token. Test funds only.
          </p>
        </div>

        {/* Contract State Stats Grid */}
        {error ? (
          <div className="rounded-xl border border-crit/40 bg-crit/10 p-5 text-sm text-crit">
            <p className="font-semibold">Could not read contract state</p>
            <p className="mt-1 font-mono text-xs break-all">{error}</p>
          </div>
        ) : (
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Stat
              label="Available liquidity · USDC"
              value={pool ? formatStroops(pool.available) : "-"}
              sub="supplied − borrowed"
            />
            <Stat
              label="Total supplied · USDC"
              value={pool ? formatStroops(pool.totalSupplied) : "-"}
              sub="active pool deposits"
            />
            <Stat
              label="Total borrowed · USDC"
              value={pool ? formatStroops(pool.totalBorrowed) : "-"}
              sub="active debt positions"
            />
          </section>
        )}

        {/* The Action Flows */}
        <AppTabs />
      </div>
    </DashboardLayout>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5 transition-colors hover:border-line-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted font-mono">
        {label}
      </p>
      <p className="mt-3 font-mono text-2xl tabular-nums text-hi">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted font-mono">{sub}</p> : null}
    </div>
  );
}
