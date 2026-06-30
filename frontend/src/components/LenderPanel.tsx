"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { supply, withdraw } from "@/lib/flows/lend";
import { getPoolState, getSupplyBalance } from "@/lib/contracts/commitmentTree";
import { stellarTxUrl } from "@/lib/explorer";
import { TxLink } from "./TxLink";

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

/** Map the contract's typed errors to plain-language guidance. */
function friendlyError(raw: string, limits: { balance: bigint; available: bigint }): string {
  if (/WithdrawExceedsBalance/.test(raw)) {
    return `You can withdraw at most ${fmtUsdc(limits.balance)} USDC (your supplied balance).`;
  }
  if (/InsufficientLiquidity/.test(raw)) {
    return `Only ${fmtUsdc(limits.available)} USDC is available — the rest is currently borrowed.`;
  }
  return raw;
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
  const [supplyStatus, setSupplyStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [supplyMessage, setSupplyMessage] = useState<string | null>(null);
  const [supplyTx, setSupplyTx] = useState<string | null>(null);

  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawStatus, setWithdrawStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [withdrawMessage, setWithdrawMessage] = useState<string | null>(null);
  const [withdrawTx, setWithdrawTx] = useState<string | null>(null);

  // One transaction per account per ledger — lock both actions while in flight.
  const busy = supplyStatus === "working" || withdrawStatus === "working";

  // Withdrawable = min(own balance, pool available liquidity).
  const maxWithdraw =
    balance !== null && available !== null
      ? balance < available
        ? balance
        : available
      : null;

  async function handleSupply() {
    setSupplyMessage(null);
    setSupplyTx(null);
    if (!address) {
      setSupplyStatus("error");
      setSupplyMessage("Connect your Stellar wallet first.");
      return;
    }
    const amountStroops = toStroops(supplyAmount);
    if (amountStroops === null) {
      setSupplyStatus("error");
      setSupplyMessage("Enter an amount.");
      return;
    }
    setSupplyStatus("working");
    try {
      const { txHash } = await supply({ amountStroops, supplier: address, signTransaction });
      setSupplyStatus("done");
      setSupplyMessage("Supplied.");
      setSupplyTx(txHash ?? null);
      setSupplyAmount("");
      await reload();
      router.refresh();
    } catch (e) {
      setSupplyStatus("error");
      setSupplyMessage(
        friendlyError(e instanceof Error ? e.message : String(e), {
          balance: balance ?? 0n,
          available: available ?? 0n,
        }),
      );
    }
  }

  async function handleWithdraw() {
    setWithdrawMessage(null);
    setWithdrawTx(null);
    if (!address) {
      setWithdrawStatus("error");
      setWithdrawMessage("Connect your Stellar wallet first.");
      return;
    }
    const amountStroops = toStroops(withdrawAmount);
    if (amountStroops === null) {
      setWithdrawStatus("error");
      setWithdrawMessage("Enter an amount.");
      return;
    }
    if (maxWithdraw !== null && amountStroops > maxWithdraw) {
      setWithdrawStatus("error");
      setWithdrawMessage(`You can withdraw at most ${fmtUsdc(maxWithdraw)} USDC.`);
      return;
    }
    setWithdrawStatus("working");
    try {
      const { txHash } = await withdraw({ amountStroops, supplier: address, signTransaction });
      setWithdrawStatus("done");
      setWithdrawMessage("Withdrew.");
      setWithdrawTx(txHash ?? null);
      setWithdrawAmount("");
      await reload();
      router.refresh();
    } catch (e) {
      setWithdrawStatus("error");
      setWithdrawMessage(
        friendlyError(e instanceof Error ? e.message : String(e), {
          balance: balance ?? 0n,
          available: available ?? 0n,
        }),
      );
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-serif text-2xl text-head">Lend liquidity</h2>
        <span className="text-xs text-muted">earn from borrower demand</span>
      </div>

      {!address ? (
        <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
          Connect your Stellar wallet to supply or withdraw USDC.
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-surface p-5">
          <div className="grid grid-cols-2 gap-5">
            <Metric label="Your supplied · USDC">
              {balance !== null ? fmtUsdc(balance) : "—"}
            </Metric>
            <Metric label="Pool available · USDC">
              {available !== null ? fmtUsdc(available) : "—"}
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
                disabled={busy}
                className="shrink-0 rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-[#1a1206] transition-colors hover:bg-[#eeb459] disabled:opacity-50"
              >
                {supplyStatus === "working" ? "Supplying…" : "Supply"}
              </button>
            </div>
            {supplyMessage ? (
              <p className={`break-all text-xs ${supplyStatus === "error" ? "text-crit" : "text-ok"}`}>
                {supplyMessage}{" "}
                {supplyTx && <TxLink url={stellarTxUrl(supplyTx)} hash={supplyTx} />}
              </p>
            ) : null}
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
                disabled={busy}
                className="shrink-0 rounded-lg border border-line-2 px-4 py-2 text-sm font-semibold text-head transition-colors hover:border-amber disabled:opacity-50"
              >
                {withdrawStatus === "working" ? "Withdrawing…" : "Withdraw"}
              </button>
            </div>
            <p className="text-xs text-muted">
              {maxWithdraw !== null
                ? `Withdrawable now: ${fmtUsdc(maxWithdraw)} USDC (your balance, capped by available liquidity)`
                : "Supply USDC to start earning from borrowers."}
            </p>
            {withdrawMessage ? (
              <p className={`break-all text-xs ${withdrawStatus === "error" ? "text-crit" : "text-ok"}`}>
                {withdrawMessage}{" "}
                {withdrawTx && <TxLink url={stellarTxUrl(withdrawTx)} hash={withdrawTx} />}
              </p>
            ) : null}
          </div>
        </div>
      )}

      <p className="text-xs text-muted">
        No yield figure is shown — interest accrual is not yet wired into this
        pool. You supply and withdraw at par.
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
