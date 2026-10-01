"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useBitcoinWallet } from "@/lib/bitcoin/useBitcoinWallet";
import {
  deriveP2WSH,
  buildReleasePsbt,
  finalizePathA,
  estimateReleaseFee,
  isAddressForNetwork,
} from "@/lib/bitcoin/address";
import { borrow } from "@/lib/flows/borrow";
import { repay } from "@/lib/flows/repay";
import { recoverPositions } from "@/lib/flows/recover";
import { createDemoPosition } from "@/lib/flows/demo";
import { EnableTrustlineButton } from "./EnableTrustlineButton";
import { POOL_ASSET } from "@/lib/flows/trustline";
import { proveZeroDebt, type ZeroDebtInput } from "@/lib/prover";
import { stellarTxUrl, btcTxUrl } from "@/lib/explorer";
import { TxLink } from "./TxLink";
import { config, BTC_NETWORK_LABEL } from "@/config";
import { humanizeError } from "@/lib/errors";
import { GITHUB_ISSUES_URL, LIQUIDATION_DOCS_URL, RECLAIM_DOCS_URL } from "@/lib/links";
import {
  positionKeys,
  subscribePositions,
  positionsSnapshot,
  positionActions,
  positionStatusLabel,
  savePosition,
  EMPTY_POSITIONS,
  type Position,
} from "@/lib/position";
import { finishDeposit } from "@/lib/flows/deposit";
import { isInFlight, type Emit, type FlowState } from "@/lib/flow/engine";
import { useFlow, useTxLockState } from "@/lib/flow/useFlow";
import { locks } from "@/lib/flow/lock";
import { FlowOutcome, workingLabel } from "./FlowOutcome";

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
  // Reactive from the (localStorage-backed) positions list - a demo can only be
  // loaded once per wallet, since insert_commitment consumes its pending entry.
  const demoLoaded = positions.some((p) => p.demo);

  async function handleDemo() {
    if (!address || !seed) return;
    setDemoError(null);
    setDemoLoading(true);
    try {
      const used = positionsSnapshot(address).map((p) => p.index);
      const index = await locks().reservePositionIndex(address, used);
      try {
        await createDemoPosition({ owner: address, seed, index });
      } finally {
        await locks().releasePositionIndex(address, index);
      }
    } catch (e) {
      setDemoError(humanizeError(e));
    } finally {
      setDemoLoading(false);
    }
  }

  async function handleUnlock() {
    setUnlockError(null);
    setUnlocking(true);
    try {
      await unlock();
    } catch (e) {
      setUnlockError(humanizeError(e));
    } finally {
      setUnlocking(false);
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
      setRecoverError(humanizeError(e, { flow: "recover" }));
    } finally {
      setRecovering(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-serif text-2xl text-head">Your positions</h2>
        <span className="text-xs text-muted">Loaded from your Stellar wallet</span>
      </div>

      <EnableTrustlineButton asset={POOL_ASSET} reason="to receive borrowed funds" />

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
              Missing a loan? Load it again from your wallet.
            </span>
            <div className="flex items-center gap-3">
              {recoverMsg ? <span className="text-xs text-ok">{recoverMsg}</span> : null}
              <button
                type="button"
                onClick={handleDemo}
                disabled={demoLoading || recovering || demoLoaded}
                title={
                  demoLoaded
                    ? "A demo position has already been loaded for this wallet"
                    : "Insert a test position (no real BTC) to try borrow/repay"
                }
                className="shrink-0 rounded-full border border-dashed border-line-2 px-3 py-1 text-xs font-semibold text-muted transition-colors hover:border-amber hover:text-amber disabled:cursor-not-allowed disabled:opacity-40"
              >
                {demoLoaded ? "Demo loaded" : demoLoading ? "Adding…" : "Load demo position"}
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
        Borrow and repay amounts are public on Stellar testnet. Collateral ratio is
        your BTC&apos;s value divided by what you owe, at a fixed test price of
        $60,000 per BTC. Below 120%, a loan can be liquidated.
      </p>
    </section>
  );
}

function PositionCard({ position }: { position: Position }) {
  const { address, signTransaction, seed } = useWallet();
  const btcWallet = useBitcoinWallet();
  const router = useRouter();
  const actions = positionActions(position);
  const liquidated = position.status === "liquidated";
  const released = position.status === "released";
  const collateralSats = BigInt(position.collateralSats);
  const debtStroops = liquidated || released ? 0n : BigInt(position.debtStroops);
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
  const [message, setMessage] = useState<string | null>(null);
  const [borrowFlow, emitBorrow] = useFlow();

  const [repayAmount, setRepayAmount] = useState("");
  const [repayMessage, setRepayMessage] = useState<string | null>(null);
  const [repayFlow, emitRepay] = useFlow();

  const [releaseMessage, setReleaseMessage] = useState<string | null>(null);
  const [releaseFlow, emitRelease] = useFlow();
  const [releaseTx, setReleaseTx] = useState<string | null>(null);

  const [finishFlow, emitFinish] = useFlow();

  const busy =
    isInFlight(borrowFlow) ||
    isInFlight(repayFlow) ||
    isInFlight(releaseFlow) ||
    isInFlight(finishFlow);
  const txLock = useTxLockState(address);
  const otherTx = txLock === "elsewhere" || (txLock === "here" && !busy);

  /** Runs `fn` under the account's transaction lock, reporting a lock conflict like any other failure. */
  async function locked(emit: Emit, fn: () => Promise<unknown>) {
    if (!address) return;
    emit({ type: "start" });
    try {
      await locks().withTxLock(address, fn);
      router.refresh();
    } catch (e) {
      emit({ type: "failed", error: e });
    }
  }

  // Release always goes to the connected Xverse account that made the deposit.
  const releaseRecipient = btcWallet.btcAddress;
  const wrongBtcAccount =
    !!btcWallet.btcPubkey &&
    !!position.btcPubkey &&
    btcWallet.btcPubkey.toLowerCase() !== position.btcPubkey.toLowerCase();
  const wrongBtcNetwork = !!releaseRecipient && !isAddressForNetwork(releaseRecipient);

  async function handleBorrow() {
    setMessage(null);
    emitBorrow({ type: "reset" });
    if (!address || !seed) {
      setMessage("Unlock your positions first.");
      return;
    }
    const usdc = Number(amount);
    if (!Number.isFinite(usdc) || usdc <= 0) {
      setMessage("Enter an amount.");
      return;
    }
    const amountStroops = BigInt(Math.round(usdc * 1e7));
    if (amountStroops > maxBorrow) {
      setMessage(`Max borrow is ${fmtUsdc(maxBorrow)} USDC (keeps ≥150%).`);
      return;
    }
    await locked(emitBorrow, async () => {
      await borrow({ position, amountStroops, borrower: address, seed, signTransaction, emit: emitBorrow });
      setAmount("");
    });
  }

  async function handleRepay() {
    setRepayMessage(null);
    emitRepay({ type: "reset" });
    if (!address || !seed) {
      setRepayMessage("Unlock your positions first.");
      return;
    }
    const usdc = Number(repayAmount);
    if (!Number.isFinite(usdc) || usdc <= 0) {
      setRepayMessage("Enter an amount.");
      return;
    }
    const amountStroops = BigInt(Math.round(usdc * 1e7));
    if (amountStroops > debtStroops) {
      setRepayMessage(`You owe ${fmtUsdc(debtStroops)} USDC.`);
      return;
    }
    await locked(emitRepay, async () => {
      await repay({ position, amountStroops, repayer: address, seed, signTransaction, emit: emitRepay });
      setRepayAmount("");
    });
  }

  async function handleFinish() {
    if (!seed) return;
    await locked(emitFinish, () =>
      finishDeposit({ position, seed, signTransaction, emit: emitFinish }),
    );
  }

  async function handleRelease() {
    setReleaseMessage(null);
    emitRelease({ type: "reset" });
    if (!address || !seed) {
      setReleaseMessage("Unlock your positions first.");
      return;
    }
    if (!position.btcPubkey || !position.timelockHeight || !position.txid) {
      setReleaseMessage("Position is missing Bitcoin metadata needed for release.");
      return;
    }
    if (!releaseRecipient) {
      setReleaseMessage("Connect Xverse to sign the release.");
      return;
    }
    if (wrongBtcAccount || wrongBtcNetwork) return;
    if (!actions.release) {
      setReleaseMessage(`You still owe ${fmtUsdc(debtStroops)} USDC. Repay it first, then release.`);
      return;
    }
    const btcPubkey = position.btcPubkey;
    const timelockHeight = position.timelockHeight;
    const depositTxid = position.txid;

    setReleaseTx(null);
    await locked(emitRelease, async () => {
      emitRelease({ type: "preparing", step: "building" });
      const protocolPubkey = config.bitcoin.protocolPubkey;
      if (!protocolPubkey) throw new Error("NEXT_PUBLIC_PROTOCOL_BTC_PUBKEY not configured");

      const relayerUrl = config.services.relayerUrl;
      if (!relayerUrl) throw new Error("NEXT_PUBLIC_RELAYER_URL not configured");

      const p2wsh = deriveP2WSH(protocolPubkey, btcPubkey, timelockHeight);
      const collateralSatsNum = Number(BigInt(position.collateralSats));
      const feeSat = await estimateReleaseFee(config.bitcoin.apiUrl);

      const psbt = buildReleasePsbt({
        txidHex: depositTxid,
        vout: position.vout ?? 0,
        amountSat: collateralSatsNum,
        scriptPubKey: p2wsh.scriptPubKey,
        redeemScript: p2wsh.redeemScript,
        recipientAddress: releaseRecipient,
        feeSat,
      });

      emitRelease({ type: "preparing", step: "merkle_path" });
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

      // Zero-debt proof - keys derived from the session seed (never persisted).
      emitRelease({ type: "proving" });
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

      emitRelease({ type: "preparing", step: "cosign" });
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

      emitRelease({ type: "awaiting_signature", wallet: "bitcoin" });
      const userSignedPsbt = await btcWallet.signPsbt(psbt.toBase64());

      emitRelease({ type: "preparing", step: "broadcasting" });
      const txHex = finalizePathA(protocolSignedPsbt, userSignedPsbt, protocolPubkey, btcPubkey);
      const broadcastRes = await fetch(`${config.bitcoin.apiUrl}/tx`, { method: "POST", body: txHex });
      if (!broadcastRes.ok) {
        const errText = await broadcastRes.text().catch(() => String(broadcastRes.status));
        throw new Error(`Broadcast failed: ${errText}`);
      }
      const btcTxid = await broadcastRes.text();

      savePosition({ ...position, status: "released", releaseTxid: btcTxid, releaseAddress: releaseRecipient });
      setReleaseTx(btcTxid);
      emitRelease({ type: "settled" });
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <span className="font-mono text-xs text-muted" title={position.commitment}>
          {position.commitment.slice(0, 8)}…{position.commitment.slice(-6)}
        </span>
        <span
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
            liquidated
              ? "border-crit/40 bg-crit/10 text-crit"
              : released
                ? "border-ok/40 bg-ok/10 text-ok"
                : "border-line-2 text-body"
          }`}
        >
          {positionStatusLabel(position)}
        </span>
      </div>

      {liquidated ? (
        <div className="mb-4 rounded-lg border border-crit/30 bg-crit/5 p-3">
          <p className="text-xs font-semibold text-crit">This loan was liquidated.</p>
          <p className="mt-1 text-xs text-body">
            Its collateral ratio fell below 120%, so a liquidator repaid your USDC
            debt and the loan is closed. You owe nothing on it.{" "}
            <a
              href={LIQUIDATION_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-crit/40 underline-offset-2 hover:text-crit"
            >
              Read how liquidation works
            </a>
          </p>
        </div>
      ) : null}

      {released ? (
        <div className="mb-4 rounded-lg border border-ok/30 bg-ok/5 p-3">
          <p className="text-xs font-semibold text-ok">BTC released</p>
          <p className="mt-1 break-all text-xs text-body">
            {fmtBtc(collateralSats)} BTC sent
            {position.releaseAddress ? (
              <>
                {" "}to <span className="font-mono">{position.releaseAddress}</span>
              </>
            ) : null}
            . It arrives after 1 Bitcoin confirmation.{" "}
            {position.releaseTxid && (
              <TxLink url={btcTxUrl(position.releaseTxid)} hash={position.releaseTxid} />
            )}
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
        <Metric label="Collateral · BTC">
          {fmtBtc(collateralSats)}
        </Metric>
        <Metric label="You owe · USDC">{fmtUsdc(debtStroops)}</Metric>
        <Metric label="Collateral ratio">
          <span className={health.tone}>{health.label}</span>
        </Metric>
      </div>

      {position.status === "registering" ? (
        <div className="mt-5 flex flex-col gap-2 border-t border-line pt-4">
          <p className="text-xs text-body">
            Your deposit is recorded on Stellar. One more step adds your loan.{" "}
            {position.stellarTxHash && (
              <TxLink url={stellarTxUrl(position.stellarTxHash)} hash={position.stellarTxHash} />
            )}
          </p>
          <button
            type="button"
            onClick={handleFinish}
            disabled={busy || otherTx}
            className="self-start rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-[#1a1206] transition-colors hover:bg-[#eeb459] disabled:opacity-50"
          >
            {isInFlight(finishFlow) ? "Adding your loan…" : "Finish deposit"}
          </button>
          {finishFlow.phase === "needs_attention" && finishFlow.error ? (
            <p className="break-all text-xs text-crit">
              {humanizeError(finishFlow.error, { flow: "deposit" })}
            </p>
          ) : (
            <FlowOutcome
              flow={finishFlow}
              success="Deposit complete."
              errorContext={{ flow: "deposit" }}
              txUrl={stellarTxUrl}
            />
          )}
        </div>
      ) : null}

      {otherTx && (actions.borrow || actions.repay || actions.release) ? (
        <p className="mt-4 text-xs text-muted">Waiting for your other transaction.</p>
      ) : null}

      {actions.borrow ? (
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
              disabled={busy || otherTx || maxBorrow === 0n}
              className="shrink-0 rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-[#1a1206] transition-colors hover:bg-[#eeb459] disabled:opacity-50"
            >
              {workingLabel(borrowFlow, "Borrow")}
            </button>
          </div>
          <p className="text-xs text-muted">
            {maxBorrow === 0n
              ? "Can't borrow more: the ratio is below 150%. Repay some USDC to raise it."
              : `Max ${fmtUsdc(maxBorrow)} USDC · keeps a ≥150% collateral ratio`}
          </p>
          {message ? <p className="break-all text-xs text-crit">{message}</p> : null}
          <FlowOutcome
            flow={borrowFlow}
            success="Borrowed."
            errorContext={{ flow: "borrow" }}
            txUrl={stellarTxUrl}
          />
        </div>
      ) : null}

      {actions.repay ? (
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
              disabled={busy || otherTx}
              className="shrink-0 rounded-lg border border-line-2 px-4 py-2 text-sm font-semibold text-head transition-colors hover:border-amber disabled:opacity-50"
            >
              {workingLabel(repayFlow, "Repay")}
            </button>
          </div>
          <p className="text-xs text-muted">You owe {fmtUsdc(debtStroops)} USDC</p>
          {repayMessage ? <p className="break-all text-xs text-crit">{repayMessage}</p> : null}
          <FlowOutcome
            flow={repayFlow}
            success="Repaid."
            errorContext={{ flow: "repay" }}
            txUrl={stellarTxUrl}
          />
        </div>
      ) : null}

      {actions.release ? (
        <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
          {releaseFlow.phase !== "settled" && position.status === "closed" ? (
            <div className="mb-1 rounded-lg border border-amber/30 bg-amber/5 p-3">
              <p className="text-xs font-semibold text-amber">
                Loan repaid. Your BTC is still locked.
              </p>
              <p className="mt-1 text-xs text-body">
                Your loan is repaid, but your BTC stays locked until you release it.
              </p>
            </div>
          ) : null}
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Release BTC</p>
          {releaseFlow.phase === "settled" ? (
            <p className="break-all text-xs text-ok">
              BTC released. {fmtBtc(collateralSats)} BTC sent to {releaseRecipient}. It arrives
              after 1 Bitcoin confirmation.{" "}
              {releaseTx && <TxLink url={btcTxUrl(releaseTx)} hash={releaseTx} />}
            </p>
          ) : !releaseRecipient ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-xs text-body">Connect Xverse to sign the release.</p>
              <button
                type="button"
                onClick={btcWallet.connect}
                disabled={btcWallet.connecting}
                className="rounded-lg border border-line-2 px-4 py-2 text-sm font-semibold text-head transition-colors hover:border-amber disabled:opacity-60"
              >
                {btcWallet.connecting ? "Connecting…" : "Connect Xverse"}
              </button>
              {btcWallet.error && <p className="text-xs text-crit">{btcWallet.error}</p>}
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted">Send to your Xverse wallet</span>
                <div className="flex items-center gap-2">
                  <p className="w-full break-all rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-head">
                    {releaseRecipient}
                  </p>
                  <button
                    type="button"
                    onClick={handleRelease}
                    disabled={busy || otherTx || wrongBtcAccount || wrongBtcNetwork}
                    className="shrink-0 rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-[#1a1206] transition-colors hover:bg-[#eeb459] disabled:opacity-50"
                  >
                    {isInFlight(releaseFlow) ? "Releasing…" : "Release BTC"}
                  </button>
                </div>
              </div>
              {wrongBtcAccount ? (
                <p className="text-xs text-crit">
                  Connect the Bitcoin account that made this deposit.
                </p>
              ) : wrongBtcNetwork ? (
                <p className="text-xs text-crit">
                  This address isn&apos;t on {BTC_NETWORK_LABEL}. Switch Xverse to{" "}
                  {BTC_NETWORK_LABEL} and connect again.
                </p>
              ) : null}
              {isInFlight(releaseFlow) && (
                <p className="text-xs text-zk">{releaseStepLabel(releaseFlow)}</p>
              )}
              {releaseMessage && <p className="break-all text-xs text-crit">{releaseMessage}</p>}
              {releaseFlow.phase === "failed" && (
                <p className="break-all text-xs text-crit">
                  {humanizeError(releaseFlow.error, { flow: "release" })}
                </p>
              )}
              {releaseFlow.phase === "signature_cancelled" && (
                <p className="text-xs text-body">You declined in your wallet. Nothing was sent.</p>
              )}
              <p className="text-xs text-muted">
                You sign in Xverse and Writz co-signs. The Bitcoin network fee, about
                2 sat/vB, comes out of the released amount.
              </p>
            </>
          )}
        </div>
      ) : null}

      {actions.missingBtcDetails ? (
        <div className="mt-4 rounded-lg border border-line-2 bg-surface-2 p-3">
          <p className="text-xs font-semibold text-head">Release needs your deposit details</p>
          <p className="mt-1 text-xs text-muted">
            This device doesn&apos;t have the Bitcoin details for this loan, which
            happens after loading it on a new device. Open the device you deposited
            from, or{" "}
            <a
              href={GITHUB_ISSUES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-line-2 underline-offset-2 hover:text-head"
            >
              report it on GitHub
            </a>{" "}
            with your deposit&apos;s Bitcoin transaction ID. After Bitcoin block{" "}
            <span className="font-mono">
              {(position.timelockHeight ?? config.bitcoin.timelockHeight).toLocaleString("en-US")}
            </span>{" "}
            you can also reclaim the BTC alone.{" "}
            <a
              href={RECLAIM_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-line-2 underline-offset-2 hover:text-head"
            >
              How to reclaim BTC alone
            </a>
          </p>
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

function releaseStepLabel(flow: FlowState): string {
  if (flow.phase === "proving") return "Generating zero-debt proof (this may take ~30 s)…";
  if (flow.phase === "awaiting_signature") return "Sign the release transaction with your Bitcoin wallet…";
  if (flow.phase !== "preparing") return "";
  switch (flow.step) {
    case "merkle_path":
      return "Fetching Merkle inclusion path…";
    case "cosign":
      return "Requesting protocol co-signature…";
    case "broadcasting":
      return "Finalizing and broadcasting…";
    default:
      return "Building release transaction…";
  }
}
