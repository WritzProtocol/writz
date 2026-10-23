import type { PendingDeposit } from "@/lib/flow/pendingDeposit";
import type { Position } from "@/lib/position/types";
import type { DerivedStatus, PositionStatus } from "@/lib/status/types";

export interface HomeLoan {
  position: Position;
  derived: DerivedStatus;
}

export interface HomeDeposit {
  pd: PendingDeposit;
  derived: DerivedStatus;
}

export type Urgent =
  | { kind: "liquidatable"; loan: HomeLoan }
  | { kind: "at_risk"; loan: HomeLoan }
  | { kind: "deposit"; status: PositionStatus; deposit: HomeDeposit | null; loan: HomeLoan | null }
  | { kind: "repaid"; loan: HomeLoan }
  | { kind: "reclaimable"; loan: HomeLoan };

const DEPOSIT_KINDS: ReadonlySet<PositionStatus["kind"]> = new Set([
  "btc_sent",
  "btc_unseen",
  "confirming",
  "ready_to_register",
  "registering",
]);

export const isDepositStatus = (s: PositionStatus) => DEPOSIT_KINDS.has(s.kind);

const CLOSED_KINDS: ReadonlySet<PositionStatus["kind"]> = new Set(["released", "liquidated"]);

export const isClosedLoan = (l: HomeLoan) => CLOSED_KINDS.has(l.derived.status.kind);

function rank(s: PositionStatus): number {
  switch (s.kind) {
    case "liquidatable":
      return 0;
    case "at_risk":
      return 1;
    case "repaid_locked":
      return s.neverBorrowed ? 2 : 3;
    case "releasing":
      return 4;
    default:
      return 2;
  }
}

export function sortLoans(loans: readonly HomeLoan[]): { open: HomeLoan[]; closed: HomeLoan[] } {
  const byRank = (a: HomeLoan, b: HomeLoan) =>
    rank(a.derived.status) - rank(b.derived.status) || a.position.index - b.position.index;
  return {
    open: loans.filter((l) => !isClosedLoan(l)).sort(byRank),
    closed: loans.filter(isClosedLoan).sort((a, b) => b.position.createdAt - a.position.createdAt),
  };
}

/** At most one urgent item: money at risk, then a deposit waiting, then the exit path, then housekeeping. */
export function pickUrgent(loans: readonly HomeLoan[], deposit: HomeDeposit | null): Urgent | null {
  const find = (kind: PositionStatus["kind"]) => loans.find((l) => l.derived.status.kind === kind);

  const liquidatable = find("liquidatable");
  if (liquidatable) return { kind: "liquidatable", loan: liquidatable };
  const atRisk = find("at_risk");
  if (atRisk) return { kind: "at_risk", loan: atRisk };

  if (deposit && (isDepositStatus(deposit.derived.status) || deposit.derived.status.kind === "checking")) {
    return { kind: "deposit", status: deposit.derived.status, deposit, loan: null };
  }
  const registering = loans.find((l) => isDepositStatus(l.derived.status));
  if (registering) return { kind: "deposit", status: registering.derived.status, deposit: null, loan: registering };

  const reclaimable = loans.find((l) => l.derived.reclaimable);
  if (reclaimable) return { kind: "reclaimable", loan: reclaimable };
  const repaid = loans.find((l) => l.derived.status.kind === "repaid_locked" && !l.derived.status.neverBorrowed);
  if (repaid) return { kind: "repaid", loan: repaid };
  return null;
}

export interface HeadlineFacts {
  urgent: Urgent | null;
  openLoans: number;
  onlyLoan: PositionStatus | null;
  lender: "earn" | "lend" | null;
  findingLoans: boolean;
}

export function homeHeadline(f: HeadlineFacts): string {
  switch (f.urgent?.kind) {
    case "liquidatable":
      return "Your loan can be liquidated now.";
    case "at_risk":
      return "Your loan is close to liquidation.";
    case "deposit":
      return "Your deposit is on its way.";
    case "repaid":
      return "Your loan is repaid.";
    case "reclaimable":
      return "You can reclaim your BTC without Writz.";
  }
  if (f.onlyLoan?.kind === "active" && f.onlyLoan.band === "healthy") return "Your loan is healthy.";
  if (f.onlyLoan?.kind === "releasing") return "Your BTC is on its way back.";
  if (f.openLoans === 1) return "Your loan is open.";
  if (f.openLoans > 1) return "Your loans.";
  if (f.findingLoans) return "Your loans.";
  if (f.lender === "earn") return "Your USDC is earning.";
  if (f.lender === "lend") return "Your USDC is in the borrow pool.";
  return "Lock Bitcoin. Borrow dollars.";
}
