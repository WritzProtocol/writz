"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { borrow } from "@/lib/flows/borrow";
import { repay } from "@/lib/flows/repay";
import {
  savePosition,
  subscribePositions,
  positionsSnapshot,
  EMPTY_POSITIONS,
  computeCommitment,
  computeNullifier,
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

  // Loads the position seeded on-chain by the demo-prep script (#3): same
  // secret/nonce/collateral, debt 0. This makes the commitment match the
  // on-chain tree so a borrow succeeds. Replaced by the deposit flow (#7).
  const addSample = useCallback(() => {
    if (!address) return;
    const secret = BigInt("0xdeadbeef12345678");
    const nonce = BigInt("0x8765432112345678");
    const collateralSats = 1_000_000n; // 0.01 BTC
    const debtStroops = 0n;
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
            + Load demo position
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
  const { address, signTransaction } = useWallet();
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

  // Max additional borrow that keeps the collateral ratio at >= 150%.
  const collateralStroops = (collateralSats * BTC_PRICE_STROOPS_PER_BTC) / SAT;
  const maxDebt = (collateralStroops * 10_000n) / 15_000n;
  const maxBorrow = maxDebt > debtStroops ? maxDebt - debtStroops : 0n;

  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const [repayAmount, setRepayAmount] = useState("");
  const [repayStatus, setRepayStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [repayMessage, setRepayMessage] = useState<string | null>(null);

  async function handleBorrow() {
    setMessage(null);
    if (!address) {
      setStatus("error");
      setMessage("Connect your wallet first.");
      return;
    }
    const usdc = Number(amount);
    if (!Number.isFinite(usdc) || usdc <= 0) {
      setStatus("error");
      setMessage("Enter an amount.");
      return;
    }
    const amountStroops = BigInt(Math.round(usdc * 1e7));
    if (amountStroops > maxBorrow) {
      setStatus("error");
      setMessage(`Max borrow is ${fmtUsdc(maxBorrow)} USDC (keeps ≥150%).`);
      return;
    }
    setStatus("working");
    try {
      const { txHash } = await borrow({ position, amountStroops, borrower: address, signTransaction });
      setStatus("done");
      setMessage(txHash ? `Borrowed — tx ${txHash.slice(0, 10)}…` : "Borrowed.");
      setAmount("");
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRepay() {
    setRepayMessage(null);
    if (!address) {
      setRepayStatus("error");
      setRepayMessage("Connect your wallet first.");
      return;
    }
    const usdc = Number(repayAmount);
    if (!Number.isFinite(usdc) || usdc <= 0) {
      setRepayStatus("error");
      setRepayMessage("Enter an amount.");
      return;
    }
    const amountStroops = BigInt(Math.round(usdc * 1e7));
    if (amountStroops > debtStroops) {
      setRepayStatus("error");
      setRepayMessage(`You owe ${fmtUsdc(debtStroops)} USDC.`);
      return;
    }
    setRepayStatus("working");
    try {
      const { txHash } = await repay({ position, amountStroops, repayer: address, signTransaction });
      setRepayStatus("done");
      setRepayMessage(txHash ? `Repaid — tx ${txHash.slice(0, 10)}…` : "Repaid.");
      setRepayAmount("");
    } catch (e) {
      setRepayStatus("error");
      setRepayMessage(e instanceof Error ? e.message : String(e));
    }
  }

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

      <div className="mt-5 flex flex-col gap-2 border-t border-line pt-4">
        <div className="flex items-center gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="USDC amount"
            className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-head outline-none focus:border-amber"
          />
          <button
            type="button"
            onClick={handleBorrow}
            disabled={status === "working"}
            className="shrink-0 rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-[#1a1206] transition-colors hover:bg-[#eeb459] disabled:opacity-50"
          >
            {status === "working" ? "Proving…" : "Borrow"}
          </button>
        </div>
        <p className="text-xs text-muted">
          Max {fmtUsdc(maxBorrow)} USDC · keeps a ≥150% collateral ratio
        </p>
        {message ? (
          <p
            className={`break-all text-xs ${status === "error" ? "text-crit" : "text-ok"}`}
          >
            {message}
          </p>
        ) : null}
      </div>

      {debtStroops > 0n ? (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              value={repayAmount}
              onChange={(e) => setRepayAmount(e.target.value)}
              inputMode="decimal"
              placeholder="Repay USDC"
              className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-head outline-none focus:border-amber"
            />
            <button
              type="button"
              onClick={handleRepay}
              disabled={repayStatus === "working"}
              className="shrink-0 rounded-lg border border-line-2 px-4 py-2 text-sm font-semibold text-head transition-colors hover:border-amber disabled:opacity-50"
            >
              {repayStatus === "working" ? "Proving…" : "Repay"}
            </button>
          </div>
          <p className="text-xs text-muted">You owe {fmtUsdc(debtStroops)} USDC</p>
          {repayMessage ? (
            <p
              className={`break-all text-xs ${repayStatus === "error" ? "text-crit" : "text-ok"}`}
            >
              {repayMessage}
            </p>
          ) : null}
        </div>
      ) : null}
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
