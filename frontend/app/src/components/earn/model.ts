import { formatUsdc } from "@/lib/borrow/journey";
import { EARN_COPY } from "./copy";
import type { Read } from "@/lib/loan/model";
import type { FundsModel } from "@/components/funds/FundsCard";

export interface EarnModel {
  connected: boolean;
  connecting: boolean;
  connect(): void;
  walletName: string;
  wrongNetwork: string | null;
  unfunded: boolean;
  apy: { value: number | null; at: number | null; failed: boolean };
  balance: Read<bigint>;
  earned: bigint | null;
  /** The last good balance after a failed read, and when it was read. */
  stale: { value: bigint; at: number } | null;
  retry(): void;
  wallet: Read<bigint>;
  paused: boolean;
  funds: FundsModel | null;
}

export const UNIT = EARN_COPY.unit;
export const PAUSED = "The vault's Blend strategy is paused, so it can't take deposits right now. Your balance is safe.";

const value = (r: Read<bigint>) => (r.kind === "ok" ? r.value : null);

/** Deposit is capped by the wallet, withdraw by the vault balance. */
export function earnSides(wallet: Read<bigint>, balance: Read<bigint>, paused: boolean): FundsModel["sides"] {
  const w = value(wallet);
  const b = value(balance);
  return {
    in: {
      label: "Deposit",
      fieldLabel: `Deposit ${UNIT}`,
      max: w,
      hint: w === null ? "Checking your wallet..." : `Wallet: ${formatUsdc(w)} ${UNIT}.`,
      over: (max) => `You have ${formatUsdc(max)} ${UNIT} in your wallet. Enter that or less.`,
      blocked: paused ? PAUSED : w === 0n ? EARN_COPY.noFunds : null,
      done: (amount) => `Deposited ${formatUsdc(amount)} ${UNIT}.`,
      action: (amount) => `Deposit ${formatUsdc(amount)} USDC`,
      errorFlow: "earn-deposit",
    },
    out: {
      label: "Withdraw",
      fieldLabel: `Withdraw ${UNIT}`,
      max: b,
      hint: b === null ? "Checking your balance..." : `In the vault: ${formatUsdc(b)} ${UNIT}.`,
      over: (max) => `You have ${formatUsdc(max)} ${UNIT} in the vault. Enter that or less.`,
      blocked: b === 0n ? "Nothing in the vault yet." : null,
      done: (amount) => `Withdrawn ${formatUsdc(amount)} ${UNIT}. It's in your wallet.`,
      action: (amount) => `Withdraw ${formatUsdc(amount)} USDC`,
      errorFlow: "earn-withdraw",
    },
  };
}
