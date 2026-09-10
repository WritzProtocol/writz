"use client";

import { useState } from "react";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { withdrawFromVault } from "@/lib/flows/earn";
import { fmtUsdc, toStroops } from "@/lib/earn/amount";
import { EARN_ASSET } from "@/lib/flows/trustline";
import { stellarTxUrl } from "@/lib/explorer";
import { humanizeError } from "@/lib/errors";
import { TxLink } from "./TxLink";

/**
 * Earn withdraw flow (#111). Takes USDC back out of the Writz DeFindex vault:
 * the relayer builds the transaction, the wallet signs it, the browser submits.
 *
 * The cap here is the vault position, not the wallet balance - the opposite of
 * the deposit flow. `available` is passed in from `EarnPanel`, which is the
 * same value the position display above renders, so the number shown and the
 * number enforced cannot drift apart.
 */
export function EarnWithdraw({
  available,
  onWithdrawn,
}: {
  /** Withdrawable balance in stroops, or null when it could not be read. */
  available: bigint | null;
  /** Called once a withdrawal has landed, so the position above re-reads. */
  onWithdrawn?: () => void;
}) {
  const { address, signTransaction } = useWallet();

  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Nothing to show signed out, unlike the APY above: a withdraw form with no
  // position behind it is noise, and the deposit panel already carries the
  // sign-in call to action.
  if (!address) return null;

  const busy = status === "working";
  const nothingToWithdraw = available === 0n;

  async function handleWithdraw() {
    setMessage(null);
    setTxHash(null);

    // Re-checked inside the handler rather than relying on the early return
    // above: TypeScript cannot carry that narrowing into a closure, and the
    // wallet can disconnect between render and click.
    if (!address) {
      setStatus("error");
      setMessage("Sign in to withdraw.");
      return;
    }

    const parsed = toStroops(amount);
    if (parsed === null) {
      setStatus("error");
      setMessage(`Enter an amount in ${EARN_ASSET.code}, up to 7 decimal places.`);
      return;
    }
    // Checked before asking for a signature: the position is already on screen,
    // so a request certain to be rejected by the vault is worth refusing here.
    // Skipped when the read failed, since refusing on a number we do not have
    // would block a withdrawal the user is entitled to make.
    if (available !== null && parsed > available) {
      setStatus("error");
      setMessage(
        `You can withdraw at most ${fmtUsdc(available)} ${EARN_ASSET.code}, which is your full position.`,
      );
      return;
    }

    setStatus("working");
    try {
      const { txHash: hash } = await withdrawFromVault({
        amountStroops: parsed,
        caller: address,
        signTransaction,
      });
      setStatus("done");
      setMessage("Withdrawn.");
      setTxHash(hash);
      setAmount("");
      onWithdrawn?.();
    } catch (e) {
      setStatus("error");
      setMessage(
        humanizeError(e, {
          flow: "earn-withdraw",
          ownBalanceUsdc: available !== null ? fmtUsdc(available) : undefined,
        }),
      );
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-serif text-2xl text-head">Withdraw from Earn</h2>
        <span className="text-xs text-muted">
          {EARN_ASSET.code} back to your wallet
        </span>
      </div>

      <div className="rounded-xl border border-line bg-surface p-5">
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-muted">
            Withdrawable · {EARN_ASSET.code}
          </span>
          <span className="font-mono text-lg tabular-nums text-hi">
            {available !== null ? fmtUsdc(available) : "-"}
          </span>
        </div>

        <div className="mt-5 flex flex-col gap-2 border-t border-line pt-4">
          <div className="flex items-center gap-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder={`${EARN_ASSET.code} to withdraw`}
              disabled={busy || nothingToWithdraw}
              className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-head outline-none focus:border-amber disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => available !== null && setAmount(fmtUsdc(available))}
              disabled={busy || available === null || nothingToWithdraw}
              className="shrink-0 rounded-lg border border-line-2 px-3 py-2 text-xs font-semibold text-muted transition-colors hover:border-amber hover:text-head disabled:opacity-50"
            >
              Max
            </button>
            <button
              type="button"
              onClick={handleWithdraw}
              disabled={busy || nothingToWithdraw}
              className="shrink-0 rounded-lg border border-line-2 px-4 py-2 text-sm font-semibold text-head transition-colors hover:border-amber disabled:opacity-50"
            >
              {busy ? "Withdrawing…" : "Withdraw"}
            </button>
          </div>

          {message ? (
            <p
              className={`break-all text-xs ${
                status === "error" ? "text-crit" : "text-ok"
              }`}
            >
              {message} {txHash && <TxLink url={stellarTxUrl(txHash)} hash={txHash} />}
            </p>
          ) : nothingToWithdraw ? (
            <p className="text-xs text-muted">
              Nothing to withdraw yet. Deposit above to open a position.
            </p>
          ) : (
            <p className="text-xs text-muted">
              Withdrawing burns the matching vault shares and returns{" "}
              {EARN_ASSET.code} to your wallet. Partial withdrawals are fine, the
              rest keeps earning.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
