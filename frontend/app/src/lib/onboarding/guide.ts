import { isFunded, type ClaimState } from "./autoClaim";
import type { Milestones } from "./funnel";

/**
 * The five steps of the guided loop on Home, ticked from the chain where it
 * can tell (a loan, its debt, its status) and from this browser's milestones
 * where it cannot (a loan repaid and closed looks the same whether or not it
 * was ever borrowed against).
 */
export type GuideStepId = "fund" | "deposit" | "borrow" | "repay" | "release";
export type GuideStepState = "done" | "now" | "next";

export const GUIDE_STEPS: readonly GuideStepId[] = ["fund", "deposit", "borrow", "repay", "release"];

export interface GuideLoan {
  index: number;
  txid: string;
  status: "active" | "closed" | "released" | "liquidated";
  debtStroops: bigint;
}

export interface GuideFacts {
  claim: ClaimState;
  /** The test key's spendable balance, when read. */
  balanceSats: bigint | null;
  /** A deposit sent and not yet registered on Stellar. */
  depositPending: boolean;
  /** The loan the guide follows: the newest one. */
  loan: GuideLoan | null;
  milestones: Milestones;
}

export interface GuideProgress {
  done: Record<GuideStepId, boolean>;
  /** The first step not done, or null when the whole loop is done. */
  current: GuideStepId | null;
  state(id: GuideStepId): GuideStepState;
}

export function guideProgress(f: GuideFacts): GuideProgress {
  const loan = f.loan;
  const closed = loan !== null && (loan.status === "closed" || loan.status === "released");
  const borrowed = Boolean(f.milestones.borrow) || (loan !== null && loan.debtStroops > 0n);
  const done: Record<GuideStepId, boolean> = {
    fund: isFunded(f.claim) || (f.balanceSats !== null && f.balanceSats > 0n) || f.depositPending || loan !== null,
    deposit: loan !== null,
    borrow: borrowed || (closed && Boolean(f.milestones.repay)),
    repay: Boolean(f.milestones.repay) || (closed && borrowed),
    release: Boolean(f.milestones.release) || loan?.status === "released",
  };
  // A later step done implies the earlier ones (a loan released on another device).
  for (let i = GUIDE_STEPS.length - 1; i > 0; i--) {
    if (done[GUIDE_STEPS[i]]) done[GUIDE_STEPS[i - 1]] = true;
  }
  const current = GUIDE_STEPS.find((id) => !done[id]) ?? null;
  return {
    done,
    current,
    state: (id) => (done[id] ? "done" : id === current ? "now" : "next"),
  };
}

/** The newest loan, which the guide follows. */
export function guideLoan<T extends { position: { index: number } }>(loans: readonly T[]): T | null {
  return loans.reduce<T | null>((best, l) => (!best || l.position.index > best.position.index ? l : best), null);
}
