"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { useWallet } from "@/lib/wallet/WalletProvider";
import {
  savePosition,
  subscribePositions,
  positionsSnapshot,
  EMPTY_POSITIONS,
  computeCommitment,
  computeNullifier,
  randomFieldElement,
  type Position,
} from "@/lib/position";

// USDC = 7 decimals (stroops), BTC = 8 decimals (sats).
const STROOP = 10_000_000n;
const SAT = 100_000_000n;
// Testnet oracle stub: BTC/USD is a fixed value on-chain.
const BTC_PRICE_STROOPS_PER_BTC = 60_000n * STROOP;

function fmtUsdc(stroops: bigint): string {
  const whole = (stroops / STROOP).toLocaleString("en-US");
  const frac = (stroops % STROOP).toString().padStart(7, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

function fmtBtc(sats: bigint): string {
  const whole = sats / SAT;
  const frac = (sats % SAT).toString().padStart(8, "0");
  return `${whole}.${frac}`;
}

/** Collateral ratio in basis points (collateral value / debt), or null if no debt. */
function healthBp(collateralSats: bigint, debtStroops: bigint): bigint | null {
  if (debtStroops <= 0n) return null;
  const collateralStroops = (collateralSats * BTC_PRICE_STROOPS_PER_BTC) / SAT;
  return (collateralStroops * 10_000n) / debtStroops;
}

function Private({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      role="button"
      tabIndex={0}
      title={revealed ? "Hide" : "Reveal"}
      className={`private${revealed ? " revealed" : ""}`}
      onClick={() => setRevealed((r) => !r)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setRevealed((r) => !r);
        }
      }}
    >
      {children}
    </span>
  );
}

export function PositionDashboard() {
  const { address } = useWallet();
  const positions = useSyncExternalStore(
    subscribePositions,
    () => (address ? positionsSnapshot(address) : EMPTY_POSITIONS),
    () => EMPTY_POSITIONS,
  );

  // Temporary seed until the deposit flow (#7) creates real positions.
  const addSample = useCallback(() => {
    if (!address) return;
    const secret = randomFieldElement();
    const nonce = randomFieldElement();
    const collateralSats = 5_000_000n; // 0.05 BTC
    const debtStroops = 15_000_000_000n; // 1,500 USDC
    const commitment = computeCommitment(collateralSats, debtStroops, secret, nonce);
    const nullifier = computeNullifier(secret, nonce);
    savePosition({
      id: commitment.toString(),
      owner: address,
      txid: null,
      collateralSats: collateralSats.toString(),
      debtStroops: debtStroops.toString(),
      secret: secret.toString(),
      nonce: nonce.toString(),
      commitment: commitment.toString(),
      nullifier: nullifier.toString(),
      status: "active",
      createdAt: Date.now(),
    });
  }, [address]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-serif text-2xl text-head">Your positions</h2>
        <span className="text-xs text-muted">private · stored on this device</span>
      </div>

      {!address ? (
        <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
          Connect your wallet to view your positions.
        </div>
      ) : positions.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-line bg-surface p-6">
          <p className="text-sm text-muted">No positions yet.</p>
          <button
            type="button"
            onClick={addSample}
            className="rounded-full border border-line-2 px-3 py-1 text-xs font-semibold text-amber transition-colors hover:border-amber"
          >
            + Add sample position (local, dev)
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {positions.map((p) => (
            <PositionCard key={p.id} position={p} />
          ))}
        </div>
      )}

      <p className="text-xs text-muted">
        Amounts are private — they never leave this device. Health uses the fixed
        testnet BTC price ($60,000). Click a value to reveal it.
      </p>
    </section>
  );
}

function PositionCard({ position }: { position: Position }) {
  const collateralSats = BigInt(position.collateralSats);
  const debtStroops = BigInt(position.debtStroops);
  const bp = healthBp(collateralSats, debtStroops);

  const health =
    bp === null
      ? { label: "No debt", tone: "text-muted" }
      : bp >= 15_000n
        ? { label: `${Number(bp) / 100}%`, tone: "text-ok" }
        : bp >= 12_000n
          ? { label: `${Number(bp) / 100}%`, tone: "text-amber" }
          : { label: `${Number(bp) / 100}%`, tone: "text-crit" };

  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <span className="font-mono text-xs text-muted" title={position.commitment}>
          {position.commitment.slice(0, 8)}…{position.commitment.slice(-6)}
        </span>
        <span className="inline-flex items-center gap-2 rounded-full border border-line-2 px-3 py-1 text-xs font-semibold capitalize text-body">
          {position.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
        <Metric label="Collateral · BTC">
          <Private>{fmtBtc(collateralSats)}</Private>
        </Metric>
        <Metric label="Debt · USDC">
          <Private>{fmtUsdc(debtStroops)}</Private>
        </Metric>
        <Metric label="Health factor">
          <span className={health.tone}>{health.label}</span>
        </Metric>
      </div>
    </div>
  );
}

function Metric({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className="font-mono text-lg tabular-nums text-hi">{children}</span>
    </div>
  );
}
