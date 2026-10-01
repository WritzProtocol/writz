import type { Position } from "./types";

export interface PositionActions {
  borrow: boolean;
  repay: boolean;
  release: boolean;
  /** Debt is 0 but this device lacks the Bitcoin details needed to build the release. */
  missingBtcDetails: boolean;
}

const NONE: PositionActions = { borrow: false, repay: false, release: false, missingBtcDetails: false };

/** Which actions a position card may offer, from its local status and debt. */
export function positionActions(p: Position): PositionActions {
  if (p.status !== "active" && p.status !== "closed") return NONE;
  if (BigInt(p.debtStroops) > 0n) return { ...NONE, borrow: true, repay: true };
  if (p.demo) return { ...NONE, borrow: p.status === "active" };
  const hasBtcDetails = Boolean(p.btcPubkey && p.timelockHeight && p.txid);
  return {
    ...NONE,
    borrow: p.status === "active",
    release: hasBtcDetails,
    missingBtcDetails: !hasBtcDetails,
  };
}

export function positionStatusLabel(p: Position): string {
  switch (p.status) {
    case "liquidated":
      return "Liquidated";
    case "released":
      return "BTC released";
    case "closed":
      return p.demo ? "Repaid" : "Repaid, BTC still locked";
    case "pending":
      return "Pending";
    default:
      return "Active";
  }
}
