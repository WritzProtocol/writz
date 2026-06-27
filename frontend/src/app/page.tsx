import {
  getMerkleRoot,
  getPoolState,
  type PoolState,
} from "@/lib/contracts/commitmentTree";

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

function truncate(hex: string): string {
  return hex.length > 18 ? `${hex.slice(0, 10)}…${hex.slice(-6)}` : hex;
}

export default async function Home() {
  let merkleRoot: string | null = null;
  let pool: PoolState | null = null;
  let error: string | null = null;

  try {
    [merkleRoot, pool] = await Promise.all([getMerkleRoot(), getPoolState()]);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-widest text-amber-600">
          Soroban Testnet
        </span>
        <h1 className="text-3xl font-semibold tracking-tight">Writz</h1>
        <p className="text-sm text-zinc-500">
          Trustless, ZK-private Bitcoin lending on Stellar. Frontend scaffold —
          live on-chain state from the <code>commitment-tree</code> contract
          below.
        </p>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          <p className="font-medium">Could not read contract state</p>
          <p className="mt-1 font-mono text-xs break-all">{error}</p>
        </div>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2">
          <Card
            label="Merkle root"
            value={merkleRoot ? truncate(merkleRoot) : "—"}
            title={merkleRoot ?? undefined}
            mono
          />
          <Card
            label="Available liquidity (USDC)"
            value={pool ? formatStroops(pool.available) : "—"}
          />
          <Card
            label="Total supplied (USDC)"
            value={pool ? formatStroops(pool.totalSupplied) : "—"}
          />
          <Card
            label="Total borrowed (USDC)"
            value={pool ? formatStroops(pool.totalBorrowed) : "—"}
          />
        </section>
      )}

      <footer className="mt-auto text-xs text-zinc-400">
        Read via generated contract bindings · no wallet required.
      </footer>
    </main>
  );
}

function Card({
  label,
  value,
  mono,
  title,
}: {
  label: string;
  value: string;
  mono?: boolean;
  title?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </p>
      <p
        className={`mt-1 text-lg ${mono ? "font-mono" : "font-semibold"}`}
        title={title}
      >
        {value}
      </p>
    </div>
  );
}
