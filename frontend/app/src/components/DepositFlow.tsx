"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useBitcoinWallet } from "@/lib/bitcoin/useBitcoinWallet";
import { deriveP2WSH } from "@/lib/bitcoin/address";
import {
  finishDeposit,
  registerDeposit,
  startDepositBySending,
  startDepositFromTxid,
  trackDeposit,
} from "@/lib/flows/deposit";
import { positionsSnapshot, type Position } from "@/lib/position";
import { stellarTxUrl } from "@/lib/explorer";
import { TxLink } from "./TxLink";
import { config } from "@/config";
import { humanizeError } from "@/lib/errors";
import { hashOf, isInFlight, type FlowState } from "@/lib/flow/engine";
import { useFlow, useTxLockState } from "@/lib/flow/useFlow";
import { depositLockName, locks } from "@/lib/flow/lock";
import { pendingDeposits } from "@/lib/flow/pendingDeposit";

const MIN_DEPOSIT_BTC = 0.0001;
const MIN_DEPOSIT_SATS = 10_000n; // 0.0001 BTC

/**
 * Parses a decimal BTC string into satoshis without floating-point arithmetic.
 * "0.1" → 10_000_000n, "0.00000001" → 1n, "1.5" → 150_000_000n
 */
function parseBtcToSats(btcStr: string): bigint {
  const trimmed = btcStr.trim();
  const dotIdx = trimmed.indexOf(".");
  const whole = dotIdx === -1 ? trimmed : trimmed.slice(0, dotIdx);
  const frac = dotIdx === -1 ? "" : trimmed.slice(dotIdx + 1, dotIdx + 9).padEnd(8, "0");
  if (!/^\d+$/.test(whole) || !/^\d+$/.test(frac)) {
    throw new Error(`Invalid BTC amount: "${btcStr}"`);
  }
  return BigInt(whole) * 100_000_000n + BigInt(frac);
}

function etaLabel(remainingConfirmations: number): string {
  const minutes = remainingConfirmations * config.bitcoin.avgBlockMinutes;
  if (minutes <= 0) return "any moment now";
  if (minutes < 60) return `~${minutes} min remaining (average)`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `~${hours} hr remaining (average)`;
}

/** Bitcoin confirmation progress: a determinate bar with a count and a rough ETA. */
function ConfirmationProgress({
  confirmed,
  required,
  relayerReachable,
}: {
  confirmed: number;
  required: number;
  relayerReachable: boolean;
}) {
  if (!relayerReachable) {
    return (
      <p className="text-xs text-zk">
        Can&apos;t reach the Writz relayer. Retrying on its own. Your BTC is safe on Bitcoin.
      </p>
    );
  }

  const pct = Math.min(100, Math.round((confirmed / required) * 100));
  const remaining = Math.max(0, required - confirmed);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs text-zk">
        <span>
          {confirmed} of {required} confirmations
        </span>
        <span className="text-muted">{etaLabel(remaining)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-zk transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted">
        You can close this page. Your progress is saved in this browser for this Stellar wallet.
      </p>
    </div>
  );
}

/** Indeterminate progress treatment for steps with no countable denominator (ZK proving, Soroban submission). */
function IndeterminateProgress({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-zk">{label}</p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-zk" />
      </div>
    </div>
  );
}

function fmtBtc(sats: string): string {
  const v = BigInt(sats);
  return `${v / 100_000_000n}.${(v % 100_000_000n).toString().padStart(8, "0")}`;
}

/** The inline progress line for the current deposit state. */
function DepositProgress({ flow }: { flow: FlowState }) {
  const hash = hashOf(flow);
  const link = hash ? <TxLink url={stellarTxUrl(hash)} hash={hash} /> : null;
  switch (flow.phase) {
    case "waiting_btc":
      return (
        <ConfirmationProgress
          confirmed={flow.confirmations}
          required={flow.required}
          relayerReachable={flow.relayerReachable}
        />
      );
    case "preparing":
      if (flow.step === "locating_output") {
        return <p className="text-xs text-zk">Locating output in transaction…</p>;
      }
      return <IndeterminateProgress label="Preparing your deposit…" />;
    case "awaiting_signature":
      return flow.wallet === "bitcoin" ? (
        <p className="text-xs text-zk">Waiting for Bitcoin wallet…</p>
      ) : (
        <IndeterminateProgress label="Confirm in your Stellar wallet." />
      );
    case "ready":
      return <p className="text-xs text-zk">Your BTC is locked. One signature left.</p>;
    case "proving":
      return <IndeterminateProgress label="Generating ZK proof in your browser… usually ~10 seconds" />;
    case "submitted":
      return (
        <div className="flex flex-col gap-1.5">
          <IndeterminateProgress label="Recording your deposit on Stellar (step 1 of 2)" />
          <p className="text-xs text-muted">Tx {link}</p>
        </div>
      );
    case "post_processing":
      return (
        <div className="flex flex-col gap-1.5">
          <IndeterminateProgress label="Adding your loan (step 2 of 2)" />
          {link && <p className="text-xs text-muted">Tx {link}</p>}
        </div>
      );
    case "timed_out":
      return (
        <p className="break-all text-xs text-amber">
          Your transaction was sent but isn&apos;t confirmed yet. It may still go through.
          Don&apos;t send it again. {link}
        </p>
      );
    case "signature_cancelled":
      return <p className="text-xs text-body">You declined in your wallet. Nothing was sent.</p>;
    case "needs_attention":
      return (
        <p className="break-all text-xs text-amber">
          {flow.error
            ? humanizeError(flow.error, { flow: "deposit" })
            : "Your deposit is recorded on Stellar. One more step adds your loan."}{" "}
          {link}
        </p>
      );
    case "failed":
      return (
        <p className="break-all text-xs text-crit">
          {humanizeError(flow.error, { flow: "deposit" })} {link}
        </p>
      );
    default:
      return null;
  }
}

export function DepositFlow() {
  const { address, signTransaction, seed, unlocked, unlock } = useWallet();
  const btcWallet = useBitcoinWallet();
  const router = useRouter();

  const [txid, setTxid] = useState("");
  const [btcAmount, setBtcAmount] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);
  const [flow, emit] = useFlow();
  const [drivenElsewhere, setDrivenElsewhere] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const [registering, setRegistering] = useState<Position | null>(null);
  const autoContinue = useRef(false);
  const signalRef = useRef<AbortSignal | undefined>(undefined);

  const pending = useSyncExternalStore(
    pendingDeposits.subscribe,
    () => (address ? pendingDeposits.snapshot(address) : null),
    () => null,
  );
  const pendingTxid = pending?.btcTxid ?? null;
  const txLock = useTxLockState(address);

  const busy = isInFlight(flow);
  const isMainnet = config.bitcoin.network === "mainnet";

  async function handleCopyAddress() {
    if (!depositAddress) return;
    try {
      await navigator.clipboard.writeText(depositAddress);
      setAddressCopied(true);
      setTimeout(() => setAddressCopied(false), 2000);
    } catch {
      // clipboard API unavailable - address is still selectable/visible
    }
  }

  // Derive P2WSH address from the user's BTC pubkey when available.
  const p2wsh = useMemo(() => {
    const protocolPubkey = config.bitcoin.protocolPubkey;
    if (!protocolPubkey || !btcWallet.btcPubkey) return null;
    try {
      return deriveP2WSH(protocolPubkey, btcWallet.btcPubkey, config.bitcoin.timelockHeight);
    } catch {
      return null;
    }
  }, [btcWallet.btcPubkey]);

  const depositAddress = pending?.p2wsh ?? p2wsh?.address ?? null;

  const runRegister = useCallback(async () => {
    if (!address || !seed) return;
    autoContinue.current = false;
    emit({ type: "start" });
    try {
      await locks().withTxLock(address, () =>
        registerDeposit({ owner: address, seed, signTransaction, emit, signal: signalRef.current }),
      );
      router.refresh();
    } catch (e) {
      emit({ type: "failed", error: e });
    }
  }, [address, seed, signTransaction, emit, router]);

  const runRegisterRef = useRef(runRegister);
  useEffect(() => {
    runRegisterRef.current = runRegister;
  }, [runRegister]);

  useEffect(() => {
    emit({ type: "reset" });
  }, [address, emit]);

  // One tab drives a pending deposit; the others wait for its lock and take
  // over if that tab closes.
  useEffect(() => {
    if (!address || !pendingTxid) return;
    const controller = new AbortController();
    signalRef.current = controller.signal;
    let release: (() => void) | null = null;

    void (async () => {
      try {
        release = await locks().holdLock(depositLockName(address), { ifAvailable: true });
        if (!release) {
          setDrivenElsewhere(true);
          release = await locks().holdLock(depositLockName(address), { signal: controller.signal });
        }
        if (controller.signal.aborted) return;
        setDrivenElsewhere(false);
        const result = await trackDeposit(address, { emit, signal: controller.signal });
        if (result.status === "ready") {
          if (autoContinue.current) await runRegisterRef.current();
        } else if (result.status === "registering") {
          setRegistering(result.position);
          emit({
            type: "needs_attention",
            action: "finish_deposit",
            hash: result.position.stellarTxHash,
          });
        } else {
          emit({ type: "settled", hash: result.position.stellarTxHash });
        }
      } catch (e) {
        if (!controller.signal.aborted) emit({ type: "failed", error: e });
      }
    })();

    return () => {
      controller.abort();
      release?.();
      setDrivenElsewhere(false);
    };
  }, [address, pendingTxid, runKey, emit]);

  function validateTxid(): string | null {
    if (!txid.trim() || !/^[0-9a-f]{64}$/i.test(txid.trim())) {
      return "Enter a valid 64-character Bitcoin txid.";
    }
    return null;
  }

  function usedIndices(): number[] {
    return address ? positionsSnapshot(address).map((p) => p.index) : [];
  }

  async function handleSendBtc() {
    if (!depositAddress || !address || !btcWallet.btcPubkey || pending) return;
    let amountSats: bigint;
    try {
      amountSats = parseBtcToSats(btcAmount);
    } catch {
      setInputError("Invalid BTC amount.");
      return;
    }
    if (amountSats < MIN_DEPOSIT_SATS) {
      setInputError(`Minimum deposit is ${MIN_DEPOSIT_BTC} BTC.`);
      return;
    }
    setInputError(null);
    emit({ type: "start" });
    try {
      await startDepositBySending({
        owner: address,
        p2wsh: depositAddress,
        btcPubkey: btcWallet.btcPubkey,
        usedIndices: usedIndices(),
        emit,
        sats: amountSats,
        send: btcWallet.sendBtc,
      });
    } catch (e) {
      emit({ type: "failed", error: e });
    }
  }

  async function handleDeposit() {
    if (!address) return;
    if (!seed) {
      setInputError("Unlock your positions first.");
      return;
    }
    setInputError(null);

    if (pending) {
      autoContinue.current = true;
      if (flow.phase === "ready") await runRegister();
      else if (!isInFlight(flow)) setRunKey((k) => k + 1);
      return;
    }

    const validationError = validateTxid();
    if (validationError) {
      setInputError(validationError);
      return;
    }
    if (!depositAddress || !btcWallet.btcPubkey) return;
    autoContinue.current = true;
    emit({ type: "start" });
    try {
      await startDepositFromTxid({
        owner: address,
        p2wsh: depositAddress,
        btcPubkey: btcWallet.btcPubkey,
        usedIndices: usedIndices(),
        emit,
        txid,
      });
    } catch (e) {
      autoContinue.current = false;
      emit({ type: "failed", error: e });
    }
  }

  async function handleFinish() {
    if (!address || !seed) return;
    const position =
      registering ??
      positionsSnapshot(address).find((p) => p.status === "registering" && p.txid === pendingTxid);
    if (!position) return;
    emit({ type: "start" });
    try {
      await locks().withTxLock(address, () =>
        finishDeposit({ position, seed, signTransaction, emit }),
      );
      router.refresh();
    } catch (e) {
      emit({ type: "failed", error: e });
    }
  }

  function reset() {
    emit({ type: "reset" });
    setInputError(null);
    setTxid("");
    setBtcAmount("");
    setRegistering(null);
  }

  const otherTx = txLock === "elsewhere" || (txLock === "here" && !busy);
  const needsFinish = flow.phase === "needs_attention";

  if (!address) return null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-serif text-2xl text-head">Deposit BTC</h2>
        <span className="text-xs text-muted">{config.bitcoin.network} · P2WSH</span>
      </div>

      <div className="rounded-xl border border-line bg-surface p-5">
        {/* Bitcoin wallet connection */}
        {!btcWallet.btcAddress && !pending && flow.phase !== "settled" ? (
          <div className="mb-5">
            <p className="text-sm text-body">
              Connect a Bitcoin wallet to derive your personal P2WSH deposit address.
            </p>
            <button
              type="button"
              onClick={btcWallet.connect}
              disabled={btcWallet.connecting}
              className="mt-3 rounded-lg border border-line-2 px-4 py-2 text-sm font-semibold text-head transition-colors hover:border-amber disabled:opacity-60"
            >
              {btcWallet.connecting ? "Connecting…" : "Connect Bitcoin Wallet (Xverse)"}
            </button>
            {btcWallet.error && (
              <p className="mt-2 text-xs text-crit">{btcWallet.error}</p>
            )}
          </div>
        ) : (
          <>
            {/* Derived P2WSH address */}
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Your P2WSH deposit address
              </p>
              {depositAddress ? (
                <>
                  <div className="mt-2 flex items-start gap-2">
                    <p
                      className="break-all font-mono text-sm text-head"
                      title={depositAddress}
                    >
                      {depositAddress}
                    </p>
                    <button
                      type="button"
                      onClick={handleCopyAddress}
                      className="shrink-0 rounded-md border border-line-2 px-2 py-0.5 text-xs font-semibold text-body transition-colors hover:border-amber"
                    >
                      {addressCopied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Derived from your Bitcoin pubkey · timelock block{" "}
                    <span className="font-mono">{config.bitcoin.timelockHeight.toLocaleString()}</span>
                  </p>
                  {!isMainnet && (
                    <div className="mt-3 rounded-lg border border-line-2 bg-surface-2 p-3">
                      <p className="text-xs font-semibold text-head">
                        Need test BTC?
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        Get free {config.bitcoin.network} BTC from a faucet into your
                        Xverse wallet, then come back and select Send BTC.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-3">
                        <a
                          href="https://bitcoinsignetfaucet.com/"
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-semibold text-amber underline-offset-2 hover:underline"
                        >
                          bitcoinsignetfaucet.com ↗
                        </a>
                        <a
                          href="https://signet.dcorral.com/"
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-semibold text-amber underline-offset-2 hover:underline"
                        >
                          signet.dcorral.com ↗
                        </a>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="mt-2 text-xs text-muted italic">
                  Set{" "}
                  <span className="font-mono text-head">NEXT_PUBLIC_PROTOCOL_BTC_PUBKEY</span>{" "}
                  to derive the address.
                </p>
              )}
              <p className="mt-2 text-xs text-muted">
                Minimum {MIN_DEPOSIT_BTC} BTC · {config.bitcoin.minConfirmations} confirmation
                {config.bitcoin.minConfirmations === 1 ? "" : "s"} required
              </p>
            </div>

            <div className="border-t border-line pt-4">
              {flow.phase === "settled" ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm font-semibold text-ok">
                    Deposit complete - position created.
                  </p>
                  {flow.hash && (
                    <p className="text-xs text-muted">
                      Tx <TxLink url={stellarTxUrl(flow.hash)} hash={flow.hash} />
                    </p>
                  )}
                  <p className="text-xs text-muted">
                    Your position is now borrowable. Scroll down to view it.
                  </p>
                  <button
                    type="button"
                    onClick={reset}
                    className="self-start rounded-full border border-line-2 px-3 py-1 text-xs font-semibold text-body transition-colors hover:border-amber"
                  >
                    New deposit
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {/* Amount input */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted">
                      Amount (BTC)
                    </label>
                    <div className="flex gap-2">
                      <input
                        value={pending ? fmtBtc(pending.sats) : btcAmount}
                        onChange={(e) => setBtcAmount(e.target.value)}
                        inputMode="decimal"
                        placeholder="e.g. 0.01"
                        disabled={busy || !!pending}
                        className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-head outline-none focus:border-amber disabled:opacity-60"
                      />
                      {depositAddress && (
                        <button
                          type="button"
                          onClick={handleSendBtc}
                          disabled={busy || !!pending || otherTx}
                          className="shrink-0 rounded-lg border border-line-2 px-3 py-2 text-sm font-semibold text-head transition-colors hover:border-amber disabled:opacity-50"
                        >
                          Send BTC
                        </button>
                      )}
                    </div>
                    {!pending && btcAmount && (() => { try { return parseBtcToSats(btcAmount); } catch { return null; } })() !== null && (
                      <p className="text-xs text-muted">
                        = {(() => { try { return parseBtcToSats(btcAmount).toLocaleString(); } catch { return ""; } })()} sats
                      </p>
                    )}
                  </div>

                  {/* Txid input */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted">
                      Bitcoin txid
                    </label>
                    <input
                      value={pending ? pending.btcTxid : txid}
                      onChange={(e) => setTxid(e.target.value)}
                      placeholder="64-character hex (auto-filled when using Send BTC)"
                      disabled={busy || !!pending}
                      spellCheck={false}
                      className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-head outline-none focus:border-amber disabled:opacity-60"
                    />
                  </div>

                  {/* Step progress */}
                  {drivenElsewhere ? (
                    <div className="flex flex-col gap-1.5">
                      <p className="text-xs text-zk">This deposit is running in another tab.</p>
                      {pending?.confirmations !== undefined && (
                        <ConfirmationProgress
                          confirmed={pending.confirmations}
                          required={pending.required ?? config.bitcoin.minConfirmations}
                          relayerReachable
                        />
                      )}
                    </div>
                  ) : (
                    <DepositProgress flow={flow} />
                  )}

                  {inputError && <p className="break-all text-xs text-crit">{inputError}</p>}

                  {otherTx && !drivenElsewhere && (
                    <p className="text-xs text-muted">Waiting for your other transaction.</p>
                  )}

                  {!unlocked && (
                    <button
                      type="button"
                      onClick={() => unlock().catch(() => {})}
                      className="self-start rounded-full border border-line-2 px-3 py-1 text-xs font-semibold text-amber transition-colors hover:border-amber"
                    >
                      Unlock to derive your keys
                    </button>
                  )}

                  {needsFinish ? (
                    <button
                      type="button"
                      onClick={handleFinish}
                      disabled={!unlocked || otherTx}
                      className="self-start rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-[#1a1206] transition-colors hover:bg-[#eeb459] disabled:opacity-50"
                    >
                      Finish deposit
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleDeposit}
                      disabled={busy || !unlocked || drivenElsewhere || otherTx}
                      className="self-start rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-[#1a1206] transition-colors hover:bg-[#eeb459] disabled:opacity-50"
                    >
                      {busy
                        ? flow.phase === "waiting_btc"
                          ? "Waiting for confirmations…"
                          : flow.phase === "proving"
                            ? "Proving…"
                            : "Submitting…"
                        : "Deposit"}
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <p className="text-xs text-muted">
        Your positions come from your Stellar wallet, so you can load them on any
        device. To release your BTC from another device, you also need this
        deposit&apos;s Bitcoin transaction ID. Keep a copy.
      </p>
    </section>
  );
}
