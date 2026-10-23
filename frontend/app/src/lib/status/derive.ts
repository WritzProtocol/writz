import type { PendingDeposit } from "@/lib/flow/pendingDeposit";
import type { Position } from "@/lib/position/types";
import type {
  DerivedStatus,
  PositionStatus,
  PositionStatusKind,
  StatusInput,
  StatusInputs,
  Timelock,
} from "./types";

/** Contract parameters (150% borrow limit, 120% liquidation); 130% is the founder's warning line. */
export const BORROW_LIMIT_BP = 15_000n;
export const AT_RISK_BP = 13_000n;
export const LIQUIDATION_BP = 12_000n;

export const BTC_UNSEEN_AFTER_MS = 10 * 60_000;

const SAT = 100_000_000n;

const checking = (...missing: StatusInput[]): PositionStatus => ({ kind: "checking", missing });

/** Collateral value over debt in basis points, or null when there is no debt. */
export function collateralRatioBp(
  collateralSats: bigint,
  debtStroops: bigint,
  priceStroopsPerBtc: bigint,
): bigint | null {
  if (debtStroops <= 0n) return null;
  return (collateralSats * priceStroopsPerBtc * 10_000n) / SAT / debtStroops;
}

export function healthStatus(ratioBp: bigint): PositionStatus {
  if (ratioBp < LIQUIDATION_BP) return { kind: "liquidatable", ratioBp };
  if (ratioBp < AT_RISK_BP) return { kind: "at_risk", ratioBp };
  return { kind: "active", ratioBp, band: ratioBp >= BORROW_LIMIT_BP ? "healthy" : "below_limit" };
}

function hasBtcDetails(p: Position): boolean {
  return Boolean(p.txid && p.vout !== undefined && p.btcPubkey && p.timelockHeight);
}

function depositStatus(inputs: StatusInputs, pd: PendingDeposit): PositionStatus {
  const { chain, relayer, params } = inputs;

  // On chain already: this device only has to save it (B32), or another device registered it.
  if (chain.position) return { kind: "registering" };
  const submitted = Boolean(pd.stellarTxHash) || pd.step === "submitted";
  if (submitted) return chain.position === undefined ? checking("position") : { kind: "registering" };

  const m = relayer?.minConfirmations ?? params.minConfirmations;
  const tx = chain.depositTx;
  if (tx && !tx.seen) {
    return params.now - pd.createdAt >= BTC_UNSEEN_AFTER_MS ? { kind: "btc_unseen" } : { kind: "btc_sent" };
  }

  let esploraN: number | undefined;
  if (tx?.seen && tx.blockHeight === null) esploraN = 0;
  else if (tx?.seen && tx.blockHeight !== null && chain.btcTipHeight !== undefined) {
    esploraN = Math.max(0, chain.btcTipHeight - tx.blockHeight + 1);
  }

  const relayerN = relayer?.confirmations;
  const n = esploraN ?? relayerN;
  if (n === undefined) return checking(tx === undefined ? "deposit_tx" : "btc_tip");
  if (n === 0) return { kind: "btc_sent" };

  if (relayerN !== undefined && esploraN !== undefined && relayerN < m && esploraN >= m) {
    return { kind: "confirming", n: m, m, relayerBehind: true };
  }
  if (n < m) return { kind: "confirming", n, m, relayerBehind: false };

  if (chain.position === undefined) return checking("position");
  return { kind: "ready_to_register" };
}

function releaseFromOutspend(inputs: StatusInputs): PositionStatus | null {
  const o = inputs.chain.lockOutspend;
  if (!o?.spent) return null;
  return o.confirmed ? { kind: "released", btcTxid: o.txid } : { kind: "releasing", btcTxid: o.txid };
}

function openStatus(inputs: StatusInputs, p: Position): PositionStatus {
  const { chain, relayer } = inputs;

  const outspend = chain.lockOutspend;
  if (outspend?.spent && p.releaseTxid && outspend.txid === p.releaseTxid) return releaseFromOutspend(inputs)!;

  // Null is a read that found nothing; right after a deposit that is RPC lag, so it stays unknown.
  const c = chain.position;
  if (!c) return checking("position");

  if (c.status === "liquidated") {
    const lookup = relayer?.liquidation;
    return { kind: "liquidated", txHash: lookup?.found ? lookup.txHash : null };
  }

  const released = releaseFromOutspend(inputs);
  if (released) return released;

  if (p.releaseTxid) {
    return outspend === undefined ? checking("outspend") : { kind: "releasing", btcTxid: p.releaseTxid };
  }

  // Closed on chain is repaid in full; an active loan with no debt never borrowed.
  if (c.status === "closed" || c.debtStroops === 0n) {
    const missingBtcDetails = !hasBtcDetails(p);
    if (!missingBtcDetails && outspend === undefined) return checking("outspend");
    return { kind: "repaid_locked", neverBorrowed: c.status === "active", missingBtcDetails };
  }

  if (chain.oraclePriceStroops === undefined) return checking("oracle_price");
  return healthStatus(collateralRatioBp(c.collateralSats, c.debtStroops, chain.oraclePriceStroops)!);
}

function coreStatus(inputs: StatusInputs): PositionStatus {
  const { position: p, pendingDeposit: pd } = inputs.local;
  if (p) return openStatus(inputs, p);
  if (pd) return depositStatus(inputs, pd);
  return checking("position");
}

const RECLAIM_OVERLAY: ReadonlySet<PositionStatusKind> = new Set(["active", "at_risk", "repaid_locked"]);

function timelockOf(inputs: StatusInputs): Timelock | null {
  const height = inputs.local.position?.timelockHeight ?? inputs.local.pendingDeposit?.timelockHeight;
  if (!height) return null;
  const tip = inputs.chain.btcTipHeight;
  return { height, blocksLeft: tip === undefined ? null : Math.max(0, height - tip) };
}

/** Pure: the same inputs always give the same status. */
export function derivePositionStatus(inputs: StatusInputs): DerivedStatus {
  const status = coreStatus(inputs);
  const timelock = timelockOf(inputs);
  const reclaimable =
    RECLAIM_OVERLAY.has(status.kind) &&
    timelock?.blocksLeft === 0 &&
    inputs.chain.lockOutspend?.spent === false;
  const c = inputs.chain.position;
  const syncing = status.kind === "repaid_locked" && c?.status === "closed" && inputs.chain.releasePsbtReady === false;
  const onChain = c && inputs.local.position ? { collateralSats: c.collateralSats, debtStroops: c.debtStroops } : null;
  return { status, reclaimable, timelock, syncing, onChain };
}
