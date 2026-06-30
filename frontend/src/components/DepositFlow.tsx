"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useBitcoinWallet } from "@/lib/bitcoin/useBitcoinWallet";
import { deriveP2WSH } from "@/lib/bitcoin/address";
import { deposit } from "@/lib/flows/deposit";
import { resolveVout } from "@/lib/bitcoin/address";
import { positionsSnapshot } from "@/lib/position";
import { stellarTxUrl } from "@/lib/explorer";
import { TxLink } from "./TxLink";
import { config } from "@/config";

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

type Step =
  | "idle"
  | "sending"
  | "polling"
  | "proving"
  | "depositing"
  | "inserting"
  | "done"
  | "error";

function stepLabel(step: Step, statusMsg: string): string {
  switch (step) {
    case "sending":    return "Waiting for Bitcoin wallet…";
    case "polling":
    case "proving":
    case "depositing":
    case "inserting":  return statusMsg;
    default:           return "";
  }
}

export function DepositFlow() {
  const { address, signTransaction, seed, unlocked, unlock } = useWallet();
  const btcWallet = useBitcoinWallet();
  const router = useRouter();

  const [txid, setTxid] = useState("");
  const [sentVout, setSentVout] = useState<number | null>(null);
  const [btcAmount, setBtcAmount] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const busy = step !== "idle" && step !== "done" && step !== "error";

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

  const depositAddress = p2wsh?.address ?? null;

  function validate(): string | null {
    if (!txid.trim() || !/^[0-9a-f]{64}$/i.test(txid.trim())) {
      return "Enter a valid 64-character Bitcoin txid.";
    }
    try {
      const sats = parseBtcToSats(btcAmount);
      if (sats < MIN_DEPOSIT_SATS) {
        return `Minimum deposit is ${MIN_DEPOSIT_BTC} BTC.`;
      }
    } catch {
      return `Invalid BTC amount.`;
    }
    return null;
  }

  async function handleSendBtc() {
    if (!depositAddress) return;
    let amountSats: bigint;
    try {
      amountSats = parseBtcToSats(btcAmount);
    } catch {
      setStep("error");
      setErrorMsg("Invalid BTC amount.");
      return;
    }
    if (amountSats < MIN_DEPOSIT_SATS) {
      setStep("error");
      setErrorMsg(`Minimum deposit is ${MIN_DEPOSIT_BTC} BTC.`);
      return;
    }
    setErrorMsg(null);
    setStep("sending");
    try {
      const sentTxid = await btcWallet.sendBtc(depositAddress, Number(amountSats));
      setTxid(sentTxid);
      setStep("sending");
      setStatusMsg("Locating output in transaction…");
      const vout = await resolveVout(sentTxid, depositAddress, config.bitcoin.apiUrl);
      setSentVout(vout);
      setStep("idle");
    } catch (e) {
      setStep("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDeposit() {
    if (!address) return;
    if (!seed) {
      setStep("error");
      setErrorMsg("Unlock your positions first.");
      return;
    }
    const validationError = validate();
    if (validationError) {
      setStep("error");
      setErrorMsg(validationError);
      return;
    }

    setErrorMsg(null);
    setStep("polling");

    const collateralSats = parseBtcToSats(btcAmount);

    const onStatus = (msg: string) => {
      if (msg.toLowerCase().includes("zk proof")) setStep("proving");
      else if (msg.includes("1/2")) setStep("depositing");
      else if (msg.includes("2/2")) setStep("inserting");
      setStatusMsg(msg);
    };

    try {
      const result = await deposit({
        txid: txid.trim().toLowerCase(),
        collateralSats,
        depositor: address,
        seed,
        index: positionsSnapshot(address).length,
        signTransaction,
        onStatus,
        btcPubkey: btcWallet.btcPubkey ?? undefined,
        timelockHeight: config.bitcoin.timelockHeight,
        vout: sentVout ?? 0,
      });
      setTxHash(result.txHash ?? null);
      setStep("done");
      router.refresh();
    } catch (e) {
      setStep("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  }

  function reset() {
    setStep("idle");
    setErrorMsg(null);
    setTxid("");
    setSentVout(null);
    setBtcAmount("");
    setTxHash(null);
    setStatusMsg("");
  }

  if (!address) return null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-serif text-2xl text-head">Deposit BTC</h2>
        <span className="text-xs text-muted">{config.bitcoin.network} · P2WSH</span>
      </div>

      <div className="rounded-xl border border-line bg-surface p-5">
        {/* Bitcoin wallet connection */}
        {!btcWallet.btcAddress ? (
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
                  <p
                    className="mt-2 break-all font-mono text-sm text-head"
                    title={depositAddress}
                  >
                    {depositAddress}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Derived from your Bitcoin pubkey · timelock block{" "}
                    <span className="font-mono">{config.bitcoin.timelockHeight.toLocaleString()}</span>
                  </p>
                </>
              ) : (
                <p className="mt-2 text-xs text-muted italic">
                  Set{" "}
                  <span className="font-mono text-head">NEXT_PUBLIC_PROTOCOL_BTC_PUBKEY</span>{" "}
                  to derive the address.
                </p>
              )}
              <p className="mt-2 text-xs text-muted">
                Minimum {MIN_DEPOSIT_BTC} BTC · 1 confirmation required
              </p>
            </div>

            <div className="border-t border-line pt-4">
              {step === "done" ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm font-semibold text-ok">
                    Deposit complete — position created.
                  </p>
                  {txHash && (
                    <p className="text-xs text-muted">
                      Tx <TxLink url={stellarTxUrl(txHash)} hash={txHash} />
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
                        value={btcAmount}
                        onChange={(e) => setBtcAmount(e.target.value)}
                        inputMode="decimal"
                        placeholder="e.g. 0.01"
                        disabled={busy}
                        className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-head outline-none focus:border-amber disabled:opacity-60"
                      />
                      {depositAddress && (
                        <button
                          type="button"
                          onClick={handleSendBtc}
                          disabled={busy}
                          className="shrink-0 rounded-lg border border-line-2 px-3 py-2 text-sm font-semibold text-head transition-colors hover:border-amber disabled:opacity-50"
                        >
                          Send BTC
                        </button>
                      )}
                    </div>
                    {btcAmount && (() => { try { return parseBtcToSats(btcAmount); } catch { return null; } })() !== null && (
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
                      value={txid}
                      onChange={(e) => setTxid(e.target.value)}
                      placeholder="64-character hex (auto-filled when using Send BTC)"
                      disabled={busy}
                      spellCheck={false}
                      className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-head outline-none focus:border-amber disabled:opacity-60"
                    />
                  </div>

                  {/* Step progress */}
                  {busy && (
                    <p className="text-xs text-zk">{stepLabel(step, statusMsg)}</p>
                  )}

                  {step === "error" && errorMsg && (
                    <p className="break-all text-xs text-crit">{errorMsg}</p>
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

                  <button
                    type="button"
                    onClick={handleDeposit}
                    disabled={busy || !unlocked}
                    className="self-start rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-[#1a1206] transition-colors hover:bg-[#eeb459] disabled:opacity-50"
                  >
                    {busy
                      ? step === "polling"
                        ? "Waiting for confirmations…"
                        : step === "proving"
                          ? "Proving…"
                          : "Submitting…"
                      : "Deposit"}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <p className="text-xs text-muted">
        Your position keys are derived from your wallet signature — no secret to
        back up. Recover positions on any device by unlocking with the same wallet.
      </p>
    </section>
  );
}
