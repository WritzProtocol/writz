import {
  getMerkleRoot,
  getPoolState,
  type PoolState,
} from "@/lib/contracts/commitmentTree";
import { WalletButton } from "@/components/WalletButton";
import { BitcoinWalletButton } from "@/components/BitcoinWalletButton";
import { AppTabs } from "@/components/AppTabs";
import { config } from "@/config";

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
  const btcNetworkLabel =
    config.bitcoin.network.charAt(0).toUpperCase() + config.bitcoin.network.slice(1);

  let merkleRoot: string | null = null;
  let pool: PoolState | null = null;
  let error: string | null = null;

  try {
    [merkleRoot, pool] = await Promise.all([getMerkleRoot(), getPoolState()]);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-12 px-6 py-20 sm:py-28">
      <header className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <span className="inline-block h-4 w-4 rotate-45 border border-amber" />
          <span className="font-serif text-xl text-hi">Writz</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-medium tracking-wide text-muted sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-zk" />
              Stellar Testnet
            </span>
            <span className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-medium tracking-wide text-muted sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-amber" />
              Bitcoin {btcNetworkLabel}
            </span>
            <BitcoinWalletButton />
            <WalletButton />
          </div>
        </div>
        <h1 className="font-serif text-4xl leading-[1.05] text-hi sm:text-5xl">
          Bitcoin was built to be yours.
          <br />
          <span className="italic text-amber">Your loans should be too.</span>
        </h1>
        <p className="max-w-prose text-body">
          Trustless, ZK-private Bitcoin lending on Stellar. Live on-chain state
          from the <span className="font-mono text-head">commitment-tree</span>{" "}
          contract.
        </p>
      </header>

      {error ? (
        <div className="rounded-xl border border-crit/40 bg-crit/10 p-5 text-sm text-crit">
          <p className="font-semibold">Could not read contract state</p>
          <p className="mt-1 font-mono text-xs break-all">{error}</p>
        </div>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2">
          <Stat
            label="Merkle root"
            value={merkleRoot ? truncate(merkleRoot) : "—"}
            title={merkleRoot ?? undefined}
            sub="empty-tree root"
          />
          <Stat
            label="Available liquidity · USDC"
            value={pool ? formatStroops(pool.available) : "—"}
            sub="supplied − borrowed"
          />
          <Stat
            label="Total supplied · USDC"
            value={pool ? formatStroops(pool.totalSupplied) : "—"}
          />
          <Stat
            label="Total borrowed · USDC"
            value={pool ? formatStroops(pool.totalBorrowed) : "—"}
          />
        </section>
      )}

      <AppTabs />

      <footer className="mt-auto border-t border-line pt-6 text-xs text-muted">
        Read via generated contract bindings · no wallet required.
      </footer>
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  title?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5 transition-colors hover:border-line-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">
        {label}
      </p>
      <p
        className="mt-3 font-mono text-2xl tabular-nums text-hi"
        title={title}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-muted">{sub}</p> : null}
    </div>
  );
}
