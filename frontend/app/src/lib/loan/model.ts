import { AT_RISK_BP, BORROW_LIMIT_BP, LIQUIDATION_BP, collateralRatioBp } from "@/lib/status/derive";
import type { FlowState } from "@/lib/flow/engine";
import type { PendingTx } from "@/lib/flow/pendingTx";
import type { DerivedStatus, PositionStatus } from "@/lib/status/types";

const SAT = 100_000_000n;
const STROOP = 10_000_000n;

export type LoanTab = "borrow" | "repay" | "release";
export const LOAN_TABS: readonly LoanTab[] = ["borrow", "repay", "release"];

export type Read<T> = { kind: "checking" } | { kind: "failed" } | { kind: "ok"; value: T };

export const readValue = <T>(r: Read<T>): T | null => (r.kind === "ok" ? r.value : null);

// ── Amounts ──────────────────────────────────────────────────────────────

/** Most USDC debt this collateral supports at the 150% borrow limit. */
export function ratioLimitStroops(collateralSats: bigint, priceStroops: bigint): bigint {
  return (collateralSats * priceStroops * 10_000n) / SAT / BORROW_LIMIT_BP;
}

export interface Available {
  stroops: bigint;
  /** Pool liquidity, not the ratio, is what caps it. */
  limitedByPool: boolean;
}

/** USDC that can still be borrowed: the smaller of the ratio headroom and the pool's liquidity. */
export function availableToBorrow(
  collateralSats: bigint,
  debtStroops: bigint,
  priceStroops: bigint,
  poolStroops: bigint | null,
): Available {
  const limit = ratioLimitStroops(collateralSats, priceStroops);
  const headroom = limit > debtStroops ? limit - debtStroops : 0n;
  if (poolStroops === null || poolStroops >= headroom) return { stroops: headroom, limitedByPool: false };
  return { stroops: poolStroops > 0n ? poolStroops : 0n, limitedByPool: true };
}

/** USDC to repay so the ratio is back at 150%, rounded up to the cent; 0 when already there. */
export function repayToSafeStroops(collateralSats: bigint, debtStroops: bigint, priceStroops: bigint): bigint {
  const limit = ratioLimitStroops(collateralSats, priceStroops);
  if (debtStroops <= limit) return 0n;
  const cent = STROOP / 100n;
  const raw = debtStroops - limit;
  return ((raw + cent - 1n) / cent) * cent;
}

/** BTC price, in stroops per BTC, at which this debt reaches the 120% liquidation line. */
export function liquidationPriceFor(collateralSats: bigint, debtStroops: bigint): bigint | null {
  if (debtStroops <= 0n || collateralSats <= 0n) return null;
  return (debtStroops * LIQUIDATION_BP * SAT) / 10_000n / collateralSats;
}

export type AfterState = { repaid: true } | { repaid: false; ratioBp: bigint; liquidationPrice: bigint };

/** What the loan looks like once a borrow or repay leaves it at `newDebt`. */
export function afterState(collateralSats: bigint, newDebtStroops: bigint, priceStroops: bigint): AfterState {
  if (newDebtStroops <= 0n) return { repaid: true };
  return {
    repaid: false,
    ratioBp: collateralRatioBp(collateralSats, newDebtStroops, priceStroops)!,
    liquidationPrice: liquidationPriceFor(collateralSats, newDebtStroops)!,
  };
}

export type UsdcParse = { ok: true; stroops: bigint } | { ok: false; error: string };

/** Strict USDC parsing: no exponents, thousands commas allowed, at most 7 decimals. */
export function parseUsdcAmount(input: string): UsdcParse {
  let v = input.trim().replace(/\s/g, "");
  if (!v) return { ok: false, error: "Enter an amount." };
  if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(v)) v = v.replace(/,/g, "");
  else v = v.replace(",", ".");
  if (!/^\d*\.?\d*$/.test(v) || v === ".") return { ok: false, error: "Enter a number, like 200." };
  const [whole = "", frac = ""] = v.split(".");
  if (frac.length > 7) return { ok: false, error: "USDC has at most 7 decimals." };
  const stroops = BigInt(whole || "0") * STROOP + BigInt(frac.padEnd(7, "0") || "0");
  if (stroops <= 0n) return { ok: false, error: "Enter an amount above 0." };
  return { ok: true, stroops };
}

/** Stroops to the plain decimal a field accepts back, e.g. "402.67". */
export function toFieldValue(stroops: bigint): string {
  const cents = stroops / (STROOP / 100n);
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

// ── Status ───────────────────────────────────────────────────────────────

export type Health = "none" | "healthy" | "below_limit" | "at_risk" | "liquidatable";

export function healthOf(status: PositionStatus): Health | null {
  switch (status.kind) {
    case "active":
      return status.band;
    case "at_risk":
      return "at_risk";
    case "liquidatable":
      return "liquidatable";
    case "repaid_locked":
      return status.neverBorrowed ? "none" : null;
    default:
      return null;
  }
}

/** Health band for a ratio, used by the after-state preview. */
export function healthOfRatio(ratioBp: bigint | null): Health {
  if (ratioBp === null) return "none";
  if (ratioBp >= BORROW_LIMIT_BP) return "healthy";
  if (ratioBp >= AT_RISK_BP) return "below_limit";
  if (ratioBp >= LIQUIDATION_BP) return "at_risk";
  return "liquidatable";
}

/** The risk block applies: the loan can carry debt, or its state is still being read. */
export function showsRisk(status: PositionStatus): boolean {
  return healthOf(status) !== null || status.kind === "checking";
}

/** The loan still takes actions from this page. */
export function isOpen(status: PositionStatus): boolean {
  return healthOf(status) !== null || status.kind === "repaid_locked";
}

/** Nothing more can happen to this loan from this page. */
export function isClosed(status: PositionStatus): boolean {
  return (
    status.kind === "releasing" ||
    status.kind === "released" ||
    status.kind === "liquidated" ||
    status.kind === "closed_on_chain" ||
    status.kind === "changed_elsewhere"
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────

export type TabState = { enabled: true } | { enabled: false; reason: string };
export type Tabs = Record<LoanTab, TabState>;

export interface TabFacts {
  status: DerivedStatus;
  debtStroops: bigint;
  price: Read<bigint>;
  available: Available | null;
  /** A transaction from this page is running, on the `busy` tab. */
  busy: LoanTab | null;
  otherTx: boolean;
  catchingUp: boolean;
}

export const REASONS = {
  checking: "Checking this loan.",
  busy: "Waiting for your transaction.",
  otherTx: "Waiting for your other transaction (in another tab).",
  catchingUp: "Writz is catching up with the chain. Your funds are safe. Try again in a minute.",
  priceUnavailable: "BTC price unavailable. Try again in a minute.",
  priceChecking: "Checking the BTC price.",
  belowLimit: "Can't borrow more: the ratio is below 150%. Repay some USDC to raise it.",
  poolEmpty: "The pool has no USDC available right now. Try again later.",
  repaidClosed: "This loan is repaid, so it can't borrow again. Release your BTC.",
  nothingToRepay: "Nothing to repay.",
  repayFirst: "Repay the loan first, then release your BTC.",
  missingDetails: "This device doesn't have the Bitcoin details for this loan.",
  closed: "This loan is closed.",
} as const;

const off = (reason: string): TabState => ({ enabled: false, reason });
const ON: TabState = { enabled: true };

/** Which actions the loan's derived status allows right now, each disabled one with its reason. */
export function loanTabs(f: TabFacts): Tabs {
  const s = f.status.status;
  if (s.kind === "checking") return { borrow: off(REASONS.checking), repay: off(REASONS.checking), release: off(REASONS.checking) };
  if (!isOpen(s)) return { borrow: off(REASONS.closed), repay: off(REASONS.closed), release: off(REASONS.closed) };

  const blocker = f.otherTx ? REASONS.otherTx : f.catchingUp ? REASONS.catchingUp : null;
  const gate = (tab: LoanTab, own: TabState): TabState => {
    if (f.busy) return f.busy === tab ? ON : off(REASONS.busy);
    if (blocker) return off(blocker);
    return own;
  };

  const health = healthOf(s);
  let borrow: TabState;
  if (s.kind === "repaid_locked" && !s.neverBorrowed) borrow = off(REASONS.repaidClosed);
  else if (health === "below_limit" || health === "at_risk" || health === "liquidatable") borrow = off(REASONS.belowLimit);
  else if (f.price.kind === "failed") borrow = off(REASONS.priceUnavailable);
  else if (f.price.kind === "checking") borrow = off(REASONS.priceChecking);
  else if (f.available && f.available.stroops <= 0n) borrow = off(f.available.limitedByPool ? REASONS.poolEmpty : REASONS.belowLimit);
  else borrow = ON;

  const repay = f.debtStroops > 0n ? ON : off(REASONS.nothingToRepay);

  let release: TabState;
  if (s.kind !== "repaid_locked") release = off(REASONS.repayFirst);
  else if (s.missingBtcDetails) release = off(REASONS.missingDetails);
  else release = ON;

  return { borrow: gate("borrow", borrow), repay: gate("repay", repay), release: gate("release", release) };
}

/** The panel to open first: the busy one, then the requested one, then what the state calls for; none when nothing is allowed. */
export function defaultTab(tabs: Tabs, status: PositionStatus, requested: LoanTab | null, busy: LoanTab | null): LoanTab | null {
  if (busy) return busy;
  if (requested && tabs[requested].enabled) return requested;
  if ((status.kind === "at_risk" || status.kind === "liquidatable") && tabs.repay.enabled) return "repay";
  if (status.kind === "repaid_locked" && !status.neverBorrowed && tabs.release.enabled) return "release";
  return LOAN_TABS.find((t) => tabs[t].enabled) ?? null;
}

/** Distinct reasons of the disabled tabs, in tab order, for the visible caption. */
export function disabledReasons(tabs: Tabs): string[] {
  const out: string[] = [];
  for (const t of LOAN_TABS) {
    const s = tabs[t];
    if (!s.enabled && !out.includes(s.reason)) out.push(s.reason);
  }
  return out;
}

export const parsePanel = (v: string | null | undefined): LoanTab | null =>
  v === "borrow" || v === "repay" || v === "release" ? v : null;

/** `/loans/[n]` takes the 1-based local loan number; anything else is not a loan. */
export function parseLoanNumber(raw: string): number | null {
  if (!/^[1-9]\d{0,5}$/.test(raw)) return null;
  return Number(raw);
}

export const loanHref = (index: number, panel?: LoanTab) => `/loans/${index + 1}${panel ? `?panel=${panel}` : ""}`;

// ── Release steps ────────────────────────────────────────────────────────

export const RELEASE_STEPS = [
  "Checking your loan on Stellar",
  "Confirming the loan is repaid (about 30 seconds)",
  "Getting Writz's signature",
  "Confirm in Xverse",
  "Sending to Bitcoin",
] as const;

/** Which release step a running release flow is on, or null when it is not running. */
export function releaseStepOf(flow: FlowState): number | null {
  switch (flow.phase) {
    case "preparing":
      if (flow.step === "cosign") return 2;
      if (flow.step === "broadcasting") return 4;
      return 0;
    case "proving":
      return 1;
    case "awaiting_signature":
      return 3;
    default:
      return null;
  }
}

// ── On this device ───────────────────────────────────────────────────────

export interface ActivityItem {
  hash: string;
  chain: "stellar" | "bitcoin";
  label: string;
  state: "pending" | "done";
  at: number | null;
}

export interface RecentTx {
  hash: string;
  chain: "stellar" | "bitcoin";
  label: string;
  at: number;
}

const PENDING_LABEL: Partial<Record<PendingTx["kind"], string>> = { borrow: "Borrow", repay: "Repay", deposit: "Deposit" };

/** This loan's transactions known to this device: pending ones first, then this session's, then the loan's own. */
export function loanActivity(args: {
  index: number;
  pending: readonly PendingTx[];
  recent: readonly RecentTx[];
  stellarTxHash?: string;
  releaseTxid?: string;
  createdAt?: number;
}): ActivityItem[] {
  const items: ActivityItem[] = [];
  const seen = new Set<string>();
  const add = (i: ActivityItem) => {
    if (seen.has(i.hash)) return;
    seen.add(i.hash);
    items.push(i);
  };
  for (const t of args.pending) {
    if (t.positionUpdate?.save.index !== args.index) continue;
    add({ hash: t.hash, chain: "stellar", label: PENDING_LABEL[t.kind] ?? "Transaction", state: "pending", at: t.createdAt });
  }
  for (const r of [...args.recent].sort((a, b) => b.at - a.at)) add({ ...r, state: "done" });
  if (args.releaseTxid) add({ hash: args.releaseTxid, chain: "bitcoin", label: "Release sent to Bitcoin", state: "done", at: null });
  if (args.stellarTxHash) {
    add({ hash: args.stellarTxHash, chain: "stellar", label: "Deposit registered on Stellar", state: "done", at: args.createdAt ?? null });
  }
  return items;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "24 Sep 2026" in UTC, the same in every browser locale. */
export function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The date of a block `blocksLeft` blocks after `now`, at ten minutes a block. */
export const blockDate = (blocksLeft: number, now: number) => shortDate(now + blocksLeft * 600_000);
