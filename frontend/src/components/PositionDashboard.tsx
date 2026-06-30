"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useBitcoinWallet } from "@/lib/bitcoin/useBitcoinWallet";
import { deriveP2WSH, buildReleasePsbt, finalizePathA, estimateReleaseFee } from "@/lib/bitcoin/address";
import { borrow } from "@/lib/flows/borrow";
import { repay } from "@/lib/flows/repay";
import { recoverPositions } from "@/lib/flows/recover";
import { createDemoPosition } from "@/lib/flows/demo";
import { proveZeroDebt, type ZeroDebtInput } from "@/lib/prover";
import { config } from "@/config";
import {
  positionKeys,
  subscribePositions,
  positionsSnapshot,
  EMPTY_POSITIONS,
  type Position,
} from "@/lib/position";

// USDC = 7 decimals (stroops), BTC = 8 decimals (sats).
const STROOP = 10_000_000n;
const SAT = 100_000_000n;
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
  const { address, seed, unlocked, unlock } = useWallet();
  const positions = useSyncExternalStore(
    subscribePositions,
    () => (address ? positionsSnapshot(address) : EMPTY_POSITIONS),
    () => EMPTY_POSITIONS,
  );

  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const [recovering, setRecovering] = useState(false);
  const [recoverMsg, setRecoverMsg] = useState<string | null>(null);
  const [recoverError, setRecoverError] = useState<string | null>(null);

  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  async function handleUnlock() {
    setUnlockError(null);
    setUnlocking(true);
    try {
      await unlock();
    } catch (e) {
      setUnlockError(e instanceof Error ? e.message : String(e));
    } finally {
      setUnlocking(false);
    }
  }

  async function handleDemo() {
    if (!address || !seed) return;
    setDemoError(null);
    setDemoLoading(true);
    try {
      await createDemoPosition({ owner: address, seed, index: positionsSnapshot(address).length });
    } catch (e) {
      setDemoError(e instanceof Error ? e.message : String(e));
    } finally {
      setDemoLoading(false);
    }
  }

  async function handleRecover() {
    if (!address || !seed) return;
    setRecoverError(null);
    setRecoverMsg(null);
    setRecovering(true);
    try {
      const { recovered, scanned } = await recoverPositions({ owner: address, seed });
      setRecoverMsg(
        recovered > 0
          ? `Recovered ${recovered} position${recovered === 1 ? "" : "s"}.`
          : `No positions for this wallet (scanned ${scanned}).`,
      );
    } catch (e) {
      setRecoverError(e instanceof Error ? e.message : String(e));
    } finally {
      setRecovering(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-serif text-2xl text-head">Your positions</h2>
        <span className="text-xs text-muted">private · keys derived from your wallet</span>
      </div>

      {!address ? (
        <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
          Connect your Stellar wallet to view your positions.
        </div>
      ) : !unlocked ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-line bg-surface p-6">
          <p className="text-sm text-muted">
            Unlock to derive your position keys from your wallet. This signs a
            message (no transaction, no fee) and works on any device.
          </p>
          <button
            type="button"
            onClick={handleUnlock}
            disabled={unlocking}
            className="rounded-full border border-line-2 px-3 py-1 text-xs font-semibold text-amber transition-colors hover:border-amber disabled:opacity-50"
          >
            {unlocking ? "Waiting for signature…" : "Unlock positions"}
          </button>
          {unlockError ? <p className="break-all text-xs text-crit">{unlockError}</p> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
            <span className="text-xs text-muted">
              Restore positions on this device — keys come from your wallet, no backup needed.
            </span>
            <div className="flex items-center gap-3">
              {recoverMsg ? <span className="text-xs text-ok">{recoverMsg}</span> : null}
              <button
                type="button"
                onClick={handleDemo}
                disabled={demoLoading || recovering}
                title="Insert a test position (no real BTC) to try borrow/repay"
                className="shrink-0 rounded-full border border-dashed border-line-2 px-3 py-1 text-xs font-semibold text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-50"
              >
                {demoLoading ? "Adding…" : "Load demo position"}
              </button>
              <button
                type="button"
                onClick={handleRecover}
                disabled={recovering || demoLoading}
                className="shrink-0 rounded-full border border-line-2 px-3 py-1 text-xs font-semibold text-amber transition-colors hover:border-amber disabled:opacity-50"
              >
                {recovering ? "Recovering…" : "Recover positions"}
              </button>
            </div>
          </div>
          {recoverError ? <p className="break-all text-xs text-crit">{recoverError}</p> : null}
          {demoError ? <p className="break-all text-xs text-crit">{demoError}</p> : null}
          {positions.length === 0 ? (
            <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
              No positions yet. Deposit BTC above to open one, or recover existing ones.
            </div>
          ) : (
            <div className="grid gap-4">
              {positions.map((p) => (
                <PositionCard key={p.id} position={p} />
              ))}
            </div>
          )}
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
  const { address, signTransaction, seed } = useWallet();
  const btcWallet = useBitcoinWallet();
  const router = useRouter();
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

  const collateralStroops = (collateralSats * BTC_PRICE_STROOPS_PER_BTC) / SAT;
  const maxDebt = (collateralStroops * 10_000n) / 15_000n;
  const maxBorrow = maxDebt > debtStroops ? maxDebt - debtStroops : 0n;

  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const [repayAmount, setRepayAmount] = useState("");
  const [repayStatus, setRepayStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [repayMessage, setRepayMessage] = useState<string | null>(null);

  const [releaseRecipient, setReleaseRecipient] = useState("");
  const [releaseStatus, setReleaseStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [releaseMessage, setReleaseMessage] = useState<string | null>(null);

  const busy = status === "working" || repayStatus === "working" || releaseStatus === "working";

  async function handleBorrow() {
    setMessage(null);
    if (!address || !seed) {
      setStatus("error");
      setMessage("Unlock your positions first.");
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
      const { txHash } = await borrow({ position, amountStroops, borrower: address, seed, signTransaction });
      setStatus("done");
      setMessage(txHash ? `Borrowed — tx ${txHash.slice(0, 10)}…` : "Borrowed.");
      setAmount("");
      router.refresh();
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRepay() {
    setRepayMessage(null);
    if (!address || !seed) {
      setRepayStatus("error");
      setRepayMessage("Unlock your positions first.");
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
      const { txHash } = await repay({ position, amountStroops, repayer: address, seed, signTransaction });
      setRepayStatus("done");
      setRepayMessage(txHash ? `Repaid — tx ${txHash.slice(0, 10)}…` : "Repaid.");
      setRepayAmount("");
      router.refresh();
    } catch (e) {
      setRepayStatus("error");
      setRepayMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRelease() {
    if (!address || !seed) {
      setReleaseStatus("error");
      setReleaseMessage("Unlock your positions first.");
      return;
    }
    if (!position.btcPubkey || !position.timelockHeight || !position.txid) {
      setReleaseStatus("error");
      setReleaseMessage("Position is missing Bitcoin metadata needed for release.");
      return;
    }
    if (!releaseRecipient.trim()) {
      setReleaseStatus("error");
      setReleaseMessage("Enter the Bitcoin address to receive the released funds.");
      return;
    }
    if (!btcWallet.btcAddress) {
      setReleaseStatus("error");
      setReleaseMessage("Connect your Bitcoin wallet to sign the release transaction.");
      return;
    }
    if (debtStroops !== 0n) {
      setReleaseStatus("error");
      setReleaseMessage(`Outstanding debt of ${fmtUsdc(debtStroops)} USDC — repay before releasing.`);
      return;
    }

    setReleaseStatus("working");
    setReleaseMessage("Building release transaction…");
    try {
      const protocolPubkey = config.bitcoin.protocolPubkey;
      if (!protocolPubkey) throw new Error("NEXT_PUBLIC_PROTOCOL_BTC_PUBKEY not configured");

      const relayerUrl = config.services.relayerUrl;
      if (!relayerUrl) throw new Error("NEXT_PUBLIC_RELAYER_URL not configured");

      const p2wsh = deriveP2WSH(protocolPubkey, position.btcPubkey, position.timelockHeight);
      const collateralSatsNum = Number(BigInt(position.collateralSats));
      const feeSat = await estimateReleaseFee(config.bitcoin.apiUrl);

      const psbt = buildReleasePsbt({
        txidHex: position.txid,
        vout: position.vout ?? 0,
        amountSat: collateralSatsNum,
        scriptPubKey: p2wsh.scriptPubKey,
        redeemScript: p2wsh.redeemScript,
        recipientAddress: releaseRecipient.trim(),
        feeSat,
      });

      setReleaseMessage("Fetching Merkle inclusion path…");
      const commitmentHex = BigInt(position.commitment).toString(16).padStart(64, "0");
      const qs =
        position.leafIndex !== undefined
          ? `?leafIndex=${position.leafIndex}&commitment=${commitmentHex}`
          : `?commitment=${commitmentHex}`;
      const pathRes = await fetch(`${relayerUrl}/merkle-path${qs}`);
      if (!pathRes.ok) {
        const pb = (await pathRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(`Merkle path fetch failed: ${pb.error ?? pathRes.status}`);
      }
      const { pathElements, pathIndices, root: merkleRoot } = (await pathRes.json()) as {
        pathElements: string[];
        pathIndices: number[];
        root: string;
      };

      // Zero-debt proof — keys derived from the session seed (never persisted).
      setReleaseMessage("Generating zero-debt proof (this may take ~30 s)…");
      const { secret, nonce } = positionKeys(seed, position);
      const zeroDebtInput: ZeroDebtInput = {
        collateral_satoshis: position.collateralSats,
        secret: secret.toString(),
        nonce: nonce.toString(),
        path_elements: pathElements,
        path_indices: pathIndices,
        merkle_root: merkleRoot,
      };
      const { raw: zkRaw } = await proveZeroDebt(zeroDebtInput);

      setReleaseMessage("Requesting protocol co-signature…");
      const cosignRes = await fetch("/api/cosign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          psbt: psbt.toBase64(),
          commitment: commitmentHex,
          zkProof: { proof: zkRaw.proof, publicSignals: zkRaw.publicSignals },
        }),
      });
      if (!cosignRes.ok) {
        const cbody = (await cosignRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(`Co-sign failed: ${cbody.error ?? cosignRes.status}`);
      }
      const { signedPsbt: protocolSignedPsbt } = (await cosignRes.json()) as { signedPsbt: string };

      setReleaseMessage("Sign the release transaction with your Bitcoin wallet…");
      const userSignedPsbt = await btcWallet.signPsbt(psbt.toBase64());

      setReleaseMessage("Finalizing and broadcasting…");
      const txHex = finalizePathA(protocolSignedPsbt, userSignedPsbt, protocolPubkey, position.btcPubkey);
      const broadcastRes = await fetch(`${config.bitcoin.apiUrl}/tx`, { method: "POST", body: txHex });
      if (!broadcastRes.ok) {
        const errText = await broadcastRes.text().catch(() => String(broadcastRes.status));
        throw new Error(`Broadcast failed: ${errText}`);
      }
      const btcTxid = await broadcastRes.text();

      setReleaseStatus("done");
      setReleaseMessage(`BTC released — txid ${btcTxid.slice(0, 10)}…`);
      router.refresh();
    } catch (e) {
      setReleaseStatus("error");
      setReleaseMessage(e instanceof Error ? e.message : String(e));
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
            disabled={busy}
            className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-head outline-none focus:border-amber disabled:opacity-60"
          />
          <button
            type="button"
            onClick={handleBorrow}
            disabled={busy}
            className="shrink-0 rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-[#1a1206] transition-colors hover:bg-[#eeb459] disabled:opacity-50"
          >
            {status === "working" ? "Proving…" : "Borrow"}
          </button>
        </div>
        <p className="text-xs text-muted">
          Max {fmtUsdc(maxBorrow)} USDC · keeps a ≥150% collateral ratio
        </p>
        {message ? (
          <p className={`break-all text-xs ${status === "error" ? "text-crit" : "text-ok"}`}>
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
              disabled={busy}
              className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-head outline-none focus:border-amber disabled:opacity-60"
            />
            <button
              type="button"
              onClick={handleRepay}
              disabled={busy}
              className="shrink-0 rounded-lg border border-line-2 px-4 py-2 text-sm font-semibold text-head transition-colors hover:border-amber disabled:opacity-50"
            >
              {repayStatus === "working" ? "Proving…" : "Repay"}
            </button>
          </div>
          <p className="text-xs text-muted">You owe {fmtUsdc(debtStroops)} USDC</p>
          {repayMessage ? (
            <p className={`break-all text-xs ${repayStatus === "error" ? "text-crit" : "text-ok"}`}>
              {repayMessage}
            </p>
          ) : null}
        </div>
      ) : null}

      {position.status === "closed" && position.btcPubkey ? (
        <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Release BTC</p>
          {releaseStatus === "done" ? (
            <p className="text-xs text-ok">{releaseMessage}</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <input
                  value={releaseRecipient}
                  onChange={(e) => setReleaseRecipient(e.target.value)}
                  placeholder="Your Bitcoin receive address"
                  disabled={busy}
                  spellCheck={false}
                  className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-head outline-none focus:border-amber disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={handleRelease}
                  disabled={busy}
                  className="shrink-0 rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-[#1a1206] transition-colors hover:bg-[#eeb459] disabled:opacity-50"
                >
                  {releaseStatus === "working" ? "Releasing…" : "Release"}
                </button>
              </div>
              {releaseStatus === "working" && releaseMessage && (
                <p className="text-xs text-zk">{releaseMessage}</p>
              )}
              {releaseStatus === "error" && releaseMessage && (
                <p className="break-all text-xs text-crit">{releaseMessage}</p>
              )}
              <p className="text-xs text-muted">
                Requires Bitcoin wallet signature + protocol co-signature. Fee ≈2 sat/vbyte.
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className="font-mono text-lg tabular-nums text-hi">{children}</span>
    </div>
  );
}
