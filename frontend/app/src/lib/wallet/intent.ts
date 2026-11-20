import type { ClassicAsset } from "@/lib/flows/trustline";
import { formatUsdc } from "@/lib/borrow/journey";
import { fmtUsdc } from "@/lib/earn/amount";

/**
 * What a signing call is for, declared by the flow that builds the
 * transaction. The embedded Pollar wallet signs with no window of its own, so
 * before it signs, the app decodes the transaction and checks it against this
 * (`checkIntent` in `verifyIntent.ts`). Amounts are stroops (7 decimals).
 */
export type SigningIntent =
  | { kind: "earn.deposit"; amount: bigint }
  | { kind: "earn.withdraw"; amount: bigint }
  | { kind: "trustline"; asset: ClassicAsset }
  | { kind: "writz-lend.deposit"; btcTxid: string }
  | { kind: "writz-lend.borrow"; txid: string; amount: bigint }
  | { kind: "writz-lend.repay"; txid: string; amount: bigint }
  | { kind: "writz-lend.supply"; amount: bigint }
  | { kind: "writz-lend.withdraw"; amount: bigint }
  | { kind: "swap.exact-in"; amountIn: bigint; minOut: bigint; path: string[] }
  | { kind: "swap.exact-out"; amountOut: bigint; maxIn: bigint; path: string[] }
  | { kind: "cctp.approve"; amount: bigint }
  | { kind: "cctp.burn"; amount: bigint; maxFee: bigint; recipient: string };

export type SigningIntentKind = SigningIntent["kind"];

/** Options a signing call can carry; the SDK's own (`networkPassphrase`, `address`) pass through. */
export interface SignOptions {
  intent?: SigningIntent;
  networkPassphrase?: string;
  address?: string;
}

type Signer<R> = (xdr: string, opts?: SignOptions) => Promise<R>;

/** `sign` with `intent` attached to every call, for code that only takes a plain signer (the contract bindings). */
export function withIntent<R>(sign: Signer<R>, intent: SigningIntent): Signer<R> {
  return (xdr, opts) => sign(xdr, { ...opts, intent });
}

/** Cents when the amount has none below them, every stroop otherwise, so a tiny remainder never reads as 0.00. */
export function usdcText(stroops: bigint): string {
  return stroops % 100_000n === 0n ? formatUsdc(stroops) : fmtUsdc(stroops);
}

/** The USDC this intent moves, for the large-amount confirmation; null when it moves none. */
export function intentUsdc(intent: SigningIntent): bigint | null {
  switch (intent.kind) {
    case "earn.deposit":
    case "earn.withdraw":
    case "writz-lend.borrow":
    case "writz-lend.repay":
    case "writz-lend.supply":
    case "writz-lend.withdraw":
    case "cctp.approve":
    case "cctp.burn":
      return intent.amount;
    case "swap.exact-in":
      return intent.amountIn;
    case "swap.exact-out":
      return intent.amountOut;
    case "trustline":
    case "writz-lend.deposit":
      return null;
  }
}

/** A short name for a token contract, from `names`, or its shortened id. */
export type TokenName = (contractId: string) => string;

/** The request in plain words, outcome first: "Deposit 10.00 USDC into the Earn vault". */
export function describeIntent(intent: SigningIntent, tokenName: TokenName): string {
  switch (intent.kind) {
    case "earn.deposit":
      return `Deposit ${usdcText(intent.amount)} USDC into the Earn vault`;
    case "earn.withdraw":
      return `Withdraw ${usdcText(intent.amount)} USDC from the Earn vault`;
    case "trustline":
      return `Add ${intent.asset.code} to your wallet`;
    case "writz-lend.deposit":
      return "Register your Bitcoin deposit on Stellar";
    case "writz-lend.borrow":
      return `Borrow ${usdcText(intent.amount)} USDC against your loan`;
    case "writz-lend.repay":
      return intent.amount === 0n
        ? "Close your loan so your BTC can be released"
        : `Repay ${usdcText(intent.amount)} USDC on your loan`;
    case "writz-lend.supply":
      return `Supply ${usdcText(intent.amount)} USDC to the lending pool`;
    case "writz-lend.withdraw":
      return `Withdraw ${usdcText(intent.amount)} USDC from the lending pool`;
    case "swap.exact-in": {
      const to = tokenName(intent.path[intent.path.length - 1] ?? "");
      return `Swap ${usdcText(intent.amountIn)} USDC for at least ${usdcText(intent.minOut)} ${to}`;
    }
    case "swap.exact-out": {
      const from = tokenName(intent.path[0] ?? "");
      return `Buy ${usdcText(intent.amountOut)} USDC with at most ${usdcText(intent.maxIn)} ${from}`;
    }
    case "cctp.approve":
      return `Let Circle's bridge move ${usdcText(intent.amount)} USDC from your wallet`;
    case "cctp.burn":
      return `Send ${usdcText(intent.amount)} USDC to ${shortHex(intent.recipient)} through Circle's bridge`;
  }
}

function shortHex(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
