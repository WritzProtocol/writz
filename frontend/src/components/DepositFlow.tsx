"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { deposit } from "@/lib/flows/deposit";

const SAT = 100_000_000n;
const MIN_DEPOSIT_BTC = 0.001; // 0.001 BTC = 100_000 sats

type Step =
  | "idle"
  | "polling"
  | "proving"
  | "depositing"
  | "inserting"
  | "done"
  | "error";

function stepLabel(step: Step, statusMsg: string): string {
  switch (step) {
    case "polling":
    case "proving":
    case "depositing":
    case "inserting":
      return statusMsg;
    default:
      return "";
  }
}

export function DepositFlow() {
  const { address, signTransaction } = useWallet();
  const router = useRouter();

  const [txid, setTxid] = useState("");
  const [btcAmount, setBtcAmount] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const busy = step !== "idle" && step !== "done" && step !== "error";

  const depositAddress = process.env.NEXT_PUBLIC_DEPOSIT_ADDRESS ?? null;

  function validate(): string | null {
    if (!txid.trim() || !/^[0-9a-f]{64}$/i.test(txid.trim())) {
      return "Enter a valid 64-character Bitcoin txid.";
    }
    const amount = parseFloat(btcAmount);
    if (!Number.isFinite(amount) || amount < MIN_DEPOSIT_BTC) {
      return `Minimum deposit is ${MIN_DEPOSIT_BTC} BTC.`;
    }
    return null;
  }

  async function handleDeposit() {
    if (!address) return;
    const validationError = validate();
    if (validationError) {
      setStep("error");
      setErrorMsg(validationError);
      return;
    }

    setErrorMsg(null);
    setStep("polling");

    const collateralSats = BigInt(Math.round(parseFloat(btcAmount) * 1e8));

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
        signTransaction,
        onStatus,
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
    setBtcAmount("");
    setTxHash(null);
    setStatusMsg("");
  }

  if (!address) return null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-serif text-2xl text-head">Deposit BTC</h2>
        <span className="text-xs text-muted">testnet · P2WSH</span>
      </div>

      <div className="rounded-xl border border-line bg-surface p-5">
        {/* P2WSH deposit address */}
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Send BTC to this address
          </p>
          {depositAddress ? (
            <p
              className="mt-2 break-all font-mono text-sm text-head"
              title={depositAddress}
            >
              {depositAddress}
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted italic">
              Set{" "}
              <span className="font-mono text-head">NEXT_PUBLIC_DEPOSIT_ADDRESS</span>{" "}
              to show the testnet P2WSH address.
            </p>
          )}
          <p className="mt-2 text-xs text-muted">
            Minimum {MIN_DEPOSIT_BTC} BTC · 6 confirmations required · Bitcoin wallet integration (Xverse) coming in a follow-up.
          </p>
        </div>

        <div className="border-t border-line pt-4">
          {step === "done" ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-ok font-semibold">
                Deposit complete — position created.
              </p>
              {txHash && (
                <p className="text-xs text-muted">
                  Tx{" "}
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-amber underline-offset-2 hover:underline"
                  >
                    {txHash.slice(0, 10)}…{txHash.slice(-6)}
                  </a>
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
              {/* Bitcoin txid input */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Bitcoin txid (after sending)
                </label>
                <input
                  value={txid}
                  onChange={(e) => setTxid(e.target.value)}
                  placeholder="64-character hex"
                  disabled={busy}
                  spellCheck={false}
                  className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-head outline-none focus:border-amber disabled:opacity-60"
                />
              </div>

              {/* BTC amount input */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Amount sent (BTC)
                </label>
                <input
                  value={btcAmount}
                  onChange={(e) => setBtcAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder={`e.g. 0.01`}
                  disabled={busy}
                  className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-head outline-none focus:border-amber disabled:opacity-60"
                />
                {btcAmount && Number.isFinite(parseFloat(btcAmount)) && (
                  <p className="text-xs text-muted">
                    ={" "}
                    {(BigInt(Math.round(parseFloat(btcAmount) * 1e8)) * 1n).toLocaleString()} sats
                  </p>
                )}
              </div>

              {/* Step progress */}
              {busy && (
                <p className="text-xs text-zk">{stepLabel(step, statusMsg)}</p>
              )}

              {/* Error */}
              {step === "error" && errorMsg && (
                <p className="break-all text-xs text-crit">{errorMsg}</p>
              )}

              <button
                type="button"
                onClick={handleDeposit}
                disabled={busy}
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
      </div>

      <p className="text-xs text-muted">
        Your secret and nonce are generated locally and stored only on this
        device. Back them up via the position export if you clear browser data.
      </p>
    </section>
  );
}
