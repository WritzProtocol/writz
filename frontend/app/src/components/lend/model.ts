import { formatUsdc } from "@/lib/borrow/journey";
import { withdrawable } from "@/lib/funds/model";
import type { Read } from "@/lib/loan/model";
import type { FundsModel } from "@/components/funds/FundsCard";

export interface PoolTotals {
  totalSupplied: bigint;
  totalBorrowed: bigint;
  available: bigint;
}

export interface LendModel {
  connected: boolean;
  connecting: boolean;
  connect(): void;
  walletName: string;
  wrongNetwork: string | null;
  unfunded: boolean;
  pool: Read<PoolTotals>;
  supplied: Read<bigint>;
  /** Last good values after a failed read, and when they were read. */
  stale: { supplied: bigint; pool: PoolTotals; at: number } | null;
  retry(): void;
  funds: FundsModel | null;
}

const value = <T,>(r: Read<T>) => (r.kind === "ok" ? r.value : null);

/** Supply is capped by the wallet; withdraw by what you supplied and what the pool hasn't lent out. */
export function lendSides(
  wallet: Read<bigint>,
  supplied: Read<bigint>,
  pool: Read<PoolTotals>,
  initial?: { side: "in" | "out"; value: string },
): FundsModel["sides"] {
  const w = value(wallet);
  const s = value(supplied);
  const available = value(pool)?.available ?? null;
  const out = s === null ? null : withdrawable(s, available);
  return {
    in: {
      label: "Supply",
      fieldLabel: "Supply USDC",
      max: w,
      hint: w === null ? "Checking your wallet..." : `Wallet: ${formatUsdc(w)} USDC.`,
      over: (max) => `You have ${formatUsdc(max)} USDC in your wallet. Enter that or less.`,
      blocked: w === 0n ? "You have no test USDC. Borrow some, or get it from the faucet." : null,
      done: (amount) => `Supplied ${formatUsdc(amount)} USDC.`,
      action: (amount) => `Supply ${formatUsdc(amount)} USDC`,
      errorFlow: "lend",
      initial: initial?.side === "in" ? initial.value : undefined,
    },
    out: {
      label: "Withdraw",
      fieldLabel: "Withdraw USDC",
      max: out?.stroops ?? null,
      hint:
        out === null
          ? "Checking your balance..."
          : out.limitedByPool
            ? `You can withdraw ${formatUsdc(out.stroops)} USDC now. Borrowers are using the rest of the pool.`
            : `You supplied ${formatUsdc(out.stroops)} USDC.`,
      over: (max) =>
        out?.limitedByPool
          ? `You can withdraw ${formatUsdc(max)} USDC now. Enter that or less.`
          : `You supplied ${formatUsdc(max)} USDC. Enter that or less.`,
      blocked:
        s === 0n
          ? "You haven't supplied any USDC."
          : available === 0n
            ? "All pool USDC is lent out right now. Try again later."
            : null,
      done: (amount) => `Withdrawn ${formatUsdc(amount)} USDC. It's in your wallet.`,
      action: (amount) => `Withdraw ${formatUsdc(amount)} USDC`,
      errorFlow: "withdraw",
      initial: initial?.side === "out" ? initial.value : undefined,
    },
  };
}
