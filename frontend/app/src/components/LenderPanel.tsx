"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { supply, withdraw } from "@/lib/flows/lend";
import { getPoolState, getSupplyBalance } from "@/lib/contracts/commitmentTree";
import { stellarTxUrl } from "@/lib/explorer";
import { isInFlight, type Emit } from "@/lib/flow/engine";
import { useFlow, useTxLockState } from "@/lib/flow/useFlow";
import { locks } from "@/lib/flow/lock";
import { FlowOutcome } from "./FlowOutcome";

// USDC uses 7 decimals (stroops).
const STROOP = 10_000_000n;

function fmtUsdc(stroops: bigint): string {
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const whole = (abs / STROOP).toLocaleString("en-US");
  const frac = (abs % STROOP).toString().padStart(7, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

function toStroops(usdc: string): bigint | null {
  const n = Number(usdc);
  if (!Number.isFinite(n) || n <= 0) return null;
  return BigInt(Math.round(n * 1e7));
}

export function LenderPanel() {
  const { address, signTransaction } = useWallet();
  const router = useRouter();

  const [balance, setBalance] = useState<bigint | null>(null);
  const [available, setAvailable] = useState<bigint | null>(null);

  // Reads only set state after an await (never synchronously inside the effect).
  // The panel is hidden while disconnected, so stale values are never shown.
  const reload = useCallback(async () => {
    if (!address) return;
    try {
      const [bal, pool] = await Promise.all([
        getSupplyBalance(address),
        getPoolState(),
      ]);
      setBalance(bal);
      setAvailable(pool.available);
    } catch {
      // leave previous values; the on-chain read may be momentarily unavailable
    }
  }, [address]);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    void (async () => {
      try {
        const [bal, pool] = await Promise.all([
          getSupplyBalance(address),
          getPoolState(),
        ]);
        if (!cancelled) {
          setBalance(bal);
          setAvailable(pool.available);
        }
      } catch {
        // ignore transient read errors
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  const [supplyAmount, setSupplyAmount] = useState("");
  const [supplyMessage, setSupplyMessage] = useState<string | null>(null);
  const [supplyFlow, emitSupply] = useFlow();

  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawMessage, setWithdrawMessage] = useState<string | null>(null);
  const [withdrawFlow, emitWithdraw] = useFlow();

  const busy = isInFlight(supplyFlow) || isInFlight(withdrawFlow);
  const txLock = useTxLockState(address);
  const otherTx = txLock === "elsewhere" || (txLock === "here" && !busy);

  async function locked(emit: Emit, fn: () => Promise<unknown>) {
    if (!address) return;
    emit({ type: "start" });
    try {
      await locks().withTxLock(address, fn);
      await reload();
      router.refresh();
    } catch (e) {
      emit({ type: "failed", error: e });
    }
  }

  const errorContext = {
    ownBalanceUsdc: fmtUsdc(balance ?? 0n),
    availableUsdc: fmtUsdc(available ?? 0n),
  };

  // Withdrawable = min(own balance, pool available liquidity).
  const maxWithdraw =
    balance !== null && available !== null
      ? balance < available
        ? balance
        : available
      : null;

  async function handleSupply() {
    setSupplyMessage(null);
    emitSupply({ type: "reset" });
    if (!address) {
      setSupplyMessage("Connect your Stellar wallet first.");
      return;
    }
    const amountStroops = toStroops(supplyAmount);
    if (amountStroops === null) {
      setSupplyMessage("Enter an amount.");
      return;
    }
    await locked(emitSupply, async () => {
      await supply({ amountStroops, supplier: address, signTransaction, emit: emitSupply });
      setSupplyAmount("");
    });
  }

  async function handleWithdraw() {
    setWithdrawMessage(null);
    emitWithdraw({ type: "reset" });
    if (!address) {
      setWithdrawMessage("Connect your Stellar wallet first.");
      return;
    }
    const amountStroops = toStroops(withdrawAmount);
    if (amountStroops === null) {
      setWithdrawMessage("Enter an amount.");
      return;
    }
    if (maxWithdraw !== null && amountStroops > maxWithdraw) {
      setWithdrawMessage(`You can withdraw at most ${fmtUsdc(maxWithdraw)} USDC.`);
      return;
    }
    await locked(emitWithdraw, async () => {
      await withdraw({ amountStroops, supplier: address, signTransaction, emit: emitWithdraw });
      setWithdrawAmount("");
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-serif text-2xl text-head">Lend USDC</h2>
        <span className="text-xs text-muted">No interest yet on Stellar testnet</span>
      </div>

      {!address ? (
        <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
          Connect your Stellar wallet to supply or withdraw USDC.
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-surface p-5">
          <div className="grid grid-cols-2 gap-5">
            <Metric label="Your supplied · USDC">
              {balance !== null ? fmtUsdc(balance) : "-"}
            </Metric>
            <Metric label="Pool available · USDC">
              {available !== null ? fmtUsdc(available) : "-"}
            </Metric>
          </div>

          {/* Supply */}
          <div className="mt-5 flex flex-col gap-2 border-t border-line pt-4">
            <div className="flex items-center gap-2">
              <input
                value={supplyAmount}
                onChange={(e) => setSupplyAmount(e.target.value)}
                inputMode="decimal"
                placeholder="USDC to supply"
                disabled={busy}
                className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-head outline-none focus:border-amber disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleSupply}
                disabled={busy || otherTx}
                className="shrink-0 rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-[#1a1206] transition-colors hover:bg-[#eeb459] disabled:opacity-50"
              >
                {isInFlight(supplyFlow) ? "Supplying…" : "Supply"}
              </button>
            </div>
            {supplyMessage ? <p className="break-all text-xs text-crit">{supplyMessage}</p> : null}
            <FlowOutcome
              flow={supplyFlow}
              success="Supplied."
              errorContext={{ flow: "lend", ...errorContext }}
              txUrl={stellarTxUrl}
            />
          </div>

          {/* Withdraw */}
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                inputMode="decimal"
                placeholder="USDC to withdraw"
                disabled={busy}
                className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-head outline-none focus:border-amber disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleWithdraw}
                disabled={busy || otherTx}
                className="shrink-0 rounded-lg border border-line-2 px-4 py-2 text-sm font-semibold text-head transition-colors hover:border-amber disabled:opacity-50"
              >
                {isInFlight(withdrawFlow) ? "Withdrawing…" : "Withdraw"}
              </button>
            </div>
            {balance === 0n ? (
              <p className="text-xs text-muted">You haven&apos;t supplied any USDC.</p>
            ) : maxWithdraw !== null ? (
              <p className="text-xs text-muted">
                You can withdraw {fmtUsdc(maxWithdraw)} USDC now. If borrowers are using the
                pool, this can be less than you supplied.
              </p>
            ) : null}
            {withdrawMessage ? <p className="break-all text-xs text-crit">{withdrawMessage}</p> : null}
            <FlowOutcome
              flow={withdrawFlow}
              success="Withdrew."
              errorContext={{ flow: "withdraw", ...errorContext }}
              txUrl={stellarTxUrl}
            />
            {otherTx ? (
              <p className="text-xs text-muted">Waiting for your other transaction.</p>
            ) : null}
          </div>
        </div>
      )}

      <p className="text-xs text-muted">
        The pool pays no interest yet on Stellar testnet, so you withdraw exactly
        what you supplied. Suppliers carry Bitcoin credit risk. When borrowers are
        using the pool, you may have to wait to withdraw.
      </p>
    </section>
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
