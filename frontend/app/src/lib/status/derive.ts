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

type Registration = PositionStatus | "registered" | "not_submitted";

function registration(
  { local, chain }: StatusInputs,
  { submitted, needsCommitment }: { submitted: boolean; needsCommitment: boolean },
): Registration {
  if (needsCommitment) {
    if (chain.commitmentForTxid === undefined) return checking("commitment");
    if (chain.commitmentForTxid === null) return submitted ? { kind: "registering", step: 1 } : "not_submitted";
  }
  if (chain.commitmentPending === undefined) return checking("commitment_pending");
  if (!chain.commitmentPending) return "registered";
  return local.insertFailed ? { kind: "register_failed" } : { kind: "registering", step: 2 };
}

function depositStatus(inputs: StatusInputs, pd: PendingDeposit): PositionStatus {
  const { local, chain, relayer, params } = inputs;
  if (local.proving) return { kind: "proving" };

  const submitted = Boolean(pd.stellarTxHash) || pd.step === "submitted" || pd.step === "registering";
  if (submitted || chain.commitmentForTxid) {
    const r = registration(inputs, { submitted, needsCommitment: true });
    if (r === "registered") return { kind: "registering", step: 2 };
    if (r !== "not_submitted") return r;
  }

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

  if (chain.commitmentForTxid === undefined) return checking("commitment");
  return { kind: "ready_to_register" };
}

function releaseFromOutspend(inputs: StatusInputs): PositionStatus | null {
  const o = inputs.chain.lockOutspend;
  if (!o?.spent) return null;
  return o.confirmed ? { kind: "released", btcTxid: o.txid } : { kind: "releasing", btcTxid: o.txid };
}

function spentNullifierStatus(inputs: StatusInputs, p: Position): PositionStatus {
  const { local, relayer } = inputs;
  const explainedLocally = (local.pendingTxs ?? []).some((t) => t.positionUpdate?.removeId === p.id);
  if (explainedLocally) return checking("local_tx");

  const lookup = relayer?.liquidation;
  if (!lookup) return checking("liquidation");
  if (lookup.found) return { kind: "liquidated", txHash: lookup.txHash };

  const released = releaseFromOutspend(inputs);
  if (released) return released;

  const complete = lookup.complete && !relayer?.catchingUp;
  return complete ? { kind: "changed_elsewhere" } : { kind: "closed_on_chain" };
}

function openStatus(inputs: StatusInputs, p: Position): PositionStatus {
  const { chain } = inputs;

  if (p.status === "registering") {
    const r = registration(inputs, { submitted: true, needsCommitment: false });
    if (r !== "registered" && r !== "not_submitted") return r;
  }

  const outspend = chain.lockOutspend;
  if (outspend?.spent && p.releaseTxid && outspend.txid === p.releaseTxid) return releaseFromOutspend(inputs)!;

  if (chain.nullifierSpent === undefined) return checking("nullifier");
  if (chain.nullifierSpent) return spentNullifierStatus(inputs, p);

  const released = releaseFromOutspend(inputs);
  if (released) return released;

  if (p.releaseTxid) {
    return outspend === undefined ? checking("outspend") : { kind: "releasing", btcTxid: p.releaseTxid };
  }

  const debt = BigInt(p.debtStroops);
  if (debt === 0n) {
    const missingBtcDetails = !hasBtcDetails(p);
    if (!missingBtcDetails && outspend === undefined) return checking("outspend");
    return { kind: "repaid_locked", neverBorrowed: p.version === 0, missingBtcDetails };
  }

  if (chain.oraclePriceStroops === undefined) return checking("oracle_price");
  return healthStatus(collateralRatioBp(BigInt(p.collateralSats), debt, chain.oraclePriceStroops)!);
}

function coreStatus(inputs: StatusInputs): PositionStatus {
  const { position: p, pendingDeposit: pd } = inputs.local;
  if (p && p.status !== "pending") return openStatus(inputs, p);
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

/** ux-spec 7.1. Pure: the same inputs always give the same status. */
export function derivePositionStatus(inputs: StatusInputs): DerivedStatus {
  const status = coreStatus(inputs);
  const timelock = timelockOf(inputs);
  const reclaimable =
    RECLAIM_OVERLAY.has(status.kind) &&
    timelock?.blocksLeft === 0 &&
    inputs.chain.lockOutspend?.spent === false;
  return { status, reclaimable, timelock, syncing: inputs.relayer?.catchingUp === true };
}
