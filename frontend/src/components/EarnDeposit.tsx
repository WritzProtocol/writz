"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { depositToVault } from "@/lib/flows/earn";
import { getUsdcBalance } from "@/lib/flows/trustline";
import { stellarTxUrl } from "@/lib/explorer";
import { humanizeError } from "@/lib/errors";
import { config } from "@/config";
import { fmtUsdc, toStroops } from "@/lib/earn/amount";
import { EnableUsdcButton } from "./EnableUsdcButton";
import { TxLink } from "./TxLink";

/**
 * Earn deposit flow (#109). Deposits USDC from the connected account into the
 * Writz DeFindex vault: the relayer builds the transaction, the wallet signs
 * it, the browser submits it.
 *
 * The vault position itself (live balance and APY) is #110 and the withdrawal
 * is #111 - this component owns the deposit and nothing else. It does read the
 * account's own USDC balance, which is a wallet fact rather than a vault one,
 * so a deposit larger than the user holds is refused before any signature is
 * requested.
 */
export function EarnDeposit() {
  const { address, signTransaction } = useWallet();

  // Balance is stored with the address it was read for, so a wallet switch
  // shows "-" until the new account's balance arrives rather than briefly
  // showing the previous account's.
  const [read, setRead] = useState<{ address: string; balance: bigint | null } | null>(
    null,
  );
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const walletBalance = read && read.address === address ? read.balance : null;

  // A failed read leaves the last known balance in place. Blanking it would be
  // worse than showing a slightly stale number: it happens right after a
  // successful deposit, exactly when the user is checking that their money
  // arrived somewhere.
  const reloadBalance = useCallback(async () => {
    if (!address) return;
    try {
      setRead({ address, balance: await getUsdcBalance(address) });
    } catch {
      // keep the previous value; Horizon may be momentarily unavailable
    }
  }, [address]);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    void (async () => {
      try {
        const balance = await getUsdcBalance(address);
        if (!cancelled) setRead({ address, balance });
      } catch {
        // keep the previous value
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  const busy = status === "working";
  const parsed = toStroops(amount);

  async function handleDeposit() {
    setMessage(null);
    setTxHash(null);

    if (!address) {
      setStatus("error");
      setMessage("Sign in to deposit USDC.");
      return;
    }
    if (parsed === null) {
      setStatus("error");
      setMessage("Enter an amount in USDC, up to 7 decimal places.");
      return;
    }
    // Checked here rather than left to the vault: the wallet balance is known
    // client-side, and asking for a signature that is certain to fail is worse
    // UX than refusing it outright.
    if (walletBalance !== null && parsed > walletBalance) {
      setStatus("error");
      setMessage(
        `You have ${fmtUsdc(walletBalance)} USDC available. Enter that or less.`,
      );
      return;
    }

    setStatus("working");
    try {
      const { txHash: hash } = await depositToVault({
        amountStroops: parsed,
        caller: address,
        signTransaction,
      });
      setStatus("done");
      setMessage(
        hash ? "Deposited." : "Deposited (mock mode - no transaction was submitted).",
      );
      setTxHash(hash);
      setAmount("");
      await reloadBalance();
    } catch (e) {
      setStatus("error");
      setMessage(
        humanizeError(e, {
          flow: "earn-deposit",
          walletUsdc: walletBalance !== null ? fmtUsdc(walletBalance) : undefined,
        }),
      );
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-serif text-2xl text-head">Deposit to Earn</h2>
        <span className="text-xs text-muted">USDC into the Writz vault</span>
      </div>

      {config.earn.mock ? (
        <p className="rounded-xl border border-amber/40 bg-amber/5 px-4 py-3 text-xs text-amber">
          Mock mode. Amounts are held in memory for this tab only, no
          transaction is built, signed or submitted, and nothing here is real.
        </p>
      ) : null}

      {!address ? (
        <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
          Sign in with email, social login, or a Stellar wallet to deposit USDC
          and start earning.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <EnableUsdcButton />

          <div className="rounded-xl border border-line bg-surface p-5">
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-muted">
                Available to deposit · USDC
              </span>
              <span className="font-mono text-lg tabular-nums text-hi">
                {walletBalance !== null ? fmtUsdc(walletBalance) : "-"}
              </span>
            </div>

            <div className="mt-5 flex flex-col gap-2 border-t border-line pt-4">
              <div className="flex items-center gap-2">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="USDC to deposit"
                  disabled={busy}
                  className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-head outline-none focus:border-amber disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() =>
                    walletBalance !== null && setAmount(fmtUsdc(walletBalance))
                  }
                  disabled={busy || walletBalance === null || walletBalance === 0n}
                  className="shrink-0 rounded-lg border border-line-2 px-3 py-2 text-xs font-semibold text-muted transition-colors hover:border-amber hover:text-head disabled:opacity-50"
                >
                  Max
                </button>
                <button
                  type="button"
                  onClick={handleDeposit}
                  disabled={busy}
                  className="shrink-0 rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-[#1a1206] transition-colors hover:bg-[#eeb459] disabled:opacity-50"
                >
                  {busy ? "Depositing…" : "Deposit"}
                </button>
              </div>

              {message ? (
                <p
                  className={`break-all text-xs ${
                    status === "error" ? "text-crit" : "text-ok"
                  }`}
                >
                  {message}{" "}
                  {txHash && <TxLink url={stellarTxUrl(txHash)} hash={txHash} />}
                </p>
              ) : (
                <p className="text-xs text-muted">
                  One signature. Your funds stay yours - the vault issues shares
                  to your own account, and Writz never takes custody.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
