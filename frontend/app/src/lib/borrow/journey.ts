import type { FlowState } from "@/lib/flow/engine";
import type { PendingDeposit } from "@/lib/flow/pendingDeposit";
import type { PositionStatusKind } from "@/lib/status/types";

export type StepId = "amount" | "stellar" | "bitcoin" | "review" | "wait" | "register";
export type JourneyStep = StepId | "done";
export type EditableStep = "amount" | "stellar" | "bitcoin";

export const STEPS: readonly { id: StepId; label: string }[] = [
  { id: "amount", label: "Amount" },
  { id: "stellar", label: "Stellar wallet" },
  { id: "bitcoin", label: "Bitcoin wallet" },
  { id: "review", label: "Review and send" },
  { id: "wait", label: "Wait for Bitcoin" },
  { id: "register", label: "Register on Stellar" },
];

export const stepIndex = (step: StepId): number => STEPS.findIndex((s) => s.id === step);

const SATS_PER_BTC = 100_000_000n;
const STROOPS_PER_UNIT = 10_000_000n;
const BORROW_LIMIT_BP = 15_000n;
const LIQUIDATION_BP = 12_000n;

/** Must match the contract's `min_deposit_satoshis`. */
export const MIN_DEPOSIT_SATS = 10_000n;
/** Below this a new deposit's own reclaim path would open almost immediately. */
export const TIMELOCK_MIN_BLOCKS_LEFT = 4_320;
/** "Keep at least 2 XLM for fees and the USDC deposit." */
export const LOW_XLM_STROOPS = 2n * STROOPS_PER_UNIT;
/** A one-input, two-output P2WPKH send, the shape of an Xverse transfer to the lock. */
const SEND_VBYTES = 141;

// ── Amounts ──────────────────────────────────────────────────────────────

/** 5_000_000n to "0.05000000". */
export function formatBtc(sats: bigint): string {
  const neg = sats < 0n;
  const abs = neg ? -sats : sats;
  return `${neg ? "-" : ""}${abs / SATS_PER_BTC}.${(abs % SATS_PER_BTC).toString().padStart(8, "0")}`;
}

/** Stroops (7 decimals) to "2,000.00", rounded down. */
export function formatUsdc(stroops: bigint): string {
  const cents = stroops / (STROOPS_PER_UNIT / 100n);
  const whole = (cents / 100n).toLocaleString("en-US");
  return `${whole}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** Stroops per BTC to "$60,000". */
export function formatUsd(stroops: bigint): string {
  return `$${(stroops / STROOPS_PER_UNIT).toLocaleString("en-US")}`;
}

export type AmountParse = { ok: true; sats: bigint } | { ok: false; error: string };

/** Strict decimal BTC parsing: no exponents, at most 8 decimals, at least the contract minimum. */
export function parseBtcAmount(input: string): AmountParse {
  const v = input.trim().replace(",", ".");
  if (!v) return { ok: false, error: "Enter an amount." };
  if (!/^\d*\.?\d*$/.test(v) || v === ".") return { ok: false, error: "Enter a number, like 0.05." };
  const [whole = "", frac = ""] = v.split(".");
  if (frac.length > 8) return { ok: false, error: "BTC has at most 8 decimals." };
  const sats = BigInt(whole || "0") * SATS_PER_BTC + BigInt(frac.padEnd(8, "0") || "0");
  if (sats <= 0n) return { ok: false, error: "Enter an amount above 0." };
  if (sats < MIN_DEPOSIT_SATS) return { ok: false, error: `Minimum ${formatBtc(MIN_DEPOSIT_SATS)} BTC.` };
  return { ok: true, sats };
}

/** USDC stroops borrowable at the 150% borrow limit. */
export function maxBorrowStroops(sats: bigint, priceStroops: bigint): bigint {
  return (sats * priceStroops * 10_000n) / SATS_PER_BTC / BORROW_LIMIT_BP;
}

/** BTC price at which a loan borrowed to the limit reaches 120%. */
export function liquidationPriceStroops(priceStroops: bigint): bigint {
  return (priceStroops * LIQUIDATION_BP) / BORROW_LIMIT_BP;
}

// ── Time ─────────────────────────────────────────────────────────────────

/** "14 Oct 2028" for a block `blocksLeft` blocks from `now`. */
export function exitDate(blocksLeft: number, now: number, blockMinutes = 10): string {
  return new Date(now + blocksLeft * blockMinutes * 60_000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "About 20 min left", or "Any moment now" once nothing is left. */
export function timeLeft(remainingBlocks: number, blockMinutes = 10): string {
  const minutes = Math.max(0, remainingBlocks) * blockMinutes;
  if (minutes <= 0) return "Any moment now";
  if (minutes < 60) return `About ${minutes} min left`;
  const hours = Math.round(minutes / 6) / 10;
  return `About ${hours} ${hours === 1 ? "hour" : "hours"} left`;
}

/** The whole journey: m blocks plus about five minutes of the user's own time. */
export function journeyMinutes(m: number, blockMinutes = 10): number {
  return m * blockMinutes + 5;
}

export function estimateFeeSats(satsPerVbyte: number): number {
  return Math.ceil(satsPerVbyte * SEND_VBYTES);
}

// ── Reads ────────────────────────────────────────────────────────────────

export type Funding = { kind: "ok" } | { kind: "unfunded" } | { kind: "low"; xlm: string };

/** Native balance from a Horizon account record, `null` when the account does not exist. */
export function fundingOf(account: { balances: { asset_type: string; balance: string }[] } | null): Funding {
  if (!account) return { kind: "unfunded" };
  const native = account.balances.find((b) => b.asset_type === "native");
  const [whole = "0", frac = ""] = (native?.balance ?? "0").split(".");
  const stroops = BigInt(whole) * STROOPS_PER_UNIT + BigInt(frac.padEnd(7, "0").slice(0, 7) || "0");
  if (stroops >= LOW_XLM_STROOPS) return { kind: "ok" };
  return { kind: "low", xlm: formatUsdc(stroops) };
}

interface EsploraAddress {
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
  mempool_stats?: { funded_txo_sum: number; spent_txo_sum: number };
}

/** Spendable sats from an Esplora `/address/:addr` record, counting unconfirmed coins. */
export function btcBalanceOf(a: EsploraAddress): bigint {
  const c = a.chain_stats;
  const m = a.mempool_stats ?? { funded_txo_sum: 0, spent_txo_sum: 0 };
  return BigInt(c.funded_txo_sum - c.spent_txo_sum + m.funded_txo_sum - m.spent_txo_sum);
}

// ── Routing ──────────────────────────────────────────────────────────────

const REGISTER_PHASES: ReadonlySet<FlowState["phase"]> = new Set([
  "proving",
  "submitted",
  "post_processing",
  "needs_attention",
  "timed_out",
]);
const REGISTER_STATUS: ReadonlySet<PositionStatusKind> = new Set([
  "ready_to_register",
  "proving",
  "registering",
  "register_failed",
]);

/** Whether a deposit that already sent BTC is still waiting for Bitcoin or ready for its Stellar signature. */
export function depositStage(
  pd: Pick<PendingDeposit, "step">,
  status: PositionStatusKind,
  flow: FlowState,
): "wait" | "register" {
  if (REGISTER_PHASES.has(flow.phase) || flow.phase === "ready") return "register";
  if ((flow.phase === "awaiting_signature" || flow.phase === "signature_cancelled") && flow.wallet === "stellar") {
    return "register";
  }
  if (flow.phase === "preparing" && flow.step === "building") return "register";
  if (REGISTER_STATUS.has(status)) return "register";
  return pd.step === "sent" || pd.step === "confirming" ? "wait" : "register";
}

export interface RouteFacts {
  done: boolean;
  /** Set once BTC is sent; from here the deposit only moves forward. */
  stage: "wait" | "register" | null;
  /** The Xverse prompt is open, or was just declined or failed. */
  sending: boolean;
  amountConfirmed: boolean;
  editing: EditableStep | null;
  stellarReady: boolean;
  bitcoinReady: boolean;
}

/** The one screen to show. Earlier steps can be revisited with Edit until BTC is sent. */
export function routeStep(f: RouteFacts): JourneyStep {
  if (f.done) return "done";
  if (f.stage) return f.stage;
  if (f.sending) return "review";
  if (f.editing) return f.editing;
  if (!f.amountConfirmed) return "amount";
  if (!f.stellarReady) return "stellar";
  if (!f.bitcoinReady) return "bitcoin";
  return "review";
}

const EDITABLE: readonly EditableStep[] = ["amount", "stellar", "bitcoin"];

/** Edit is offered on amount and both wallets, for steps already passed, until the BTC is sent. */
export function canEdit(target: EditableStep, current: JourneyStep, f: Pick<RouteFacts, "stage" | "sending" | "done">): boolean {
  if (f.done || f.stage || f.sending || current === "done") return false;
  if (current === "wait" || current === "register") return false;
  return stepIndex(target) < stepIndex(current);
}

/** Where Back goes from the current step, or null when there is no way back. */
export function backTarget(current: JourneyStep, f: Pick<RouteFacts, "stage" | "sending" | "done">): EditableStep | null {
  if (current === "done" || current === "amount") return null;
  const prev = EDITABLE[stepIndex(current) - 1];
  return prev && canEdit(prev, current, f) ? prev : null;
}

export const isEditable = (step: JourneyStep): step is EditableStep =>
  (EDITABLE as readonly string[]).includes(step);

// ── Summary ──────────────────────────────────────────────────────────────

export interface SummaryValues {
  locking: string | null;
  borrowUpTo: string | null;
}

/** The two labelled values in the collapsed summary bar. */
export function summaryValues(sats: bigint | null, priceStroops: bigint | null): SummaryValues {
  return {
    locking: sats ? `${formatBtc(sats)} BTC` : null,
    borrowUpTo: sats && priceStroops ? `${formatUsdc(maxBorrowStroops(sats, priceStroops))} USDC` : null,
  };
}

/** "GDQP…4W37": middle truncation for addresses in tight places. */
export function shortAddress(address: string, head = 4, tail = 4): string {
  return address.length <= head + tail + 1 ? address : `${address.slice(0, head)}…${address.slice(-tail)}`;
}
