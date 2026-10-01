import type { PendingDeposit } from "@/lib/flow/pendingDeposit";
import type { PendingTx } from "@/lib/flow/pendingTx";
import type { Position } from "@/lib/position/types";

/**
 * Position status: derive(local note, chain reads, relayer
 * index). Local data is a hint, the chain decides, and a missing read yields
 * `checking` rather than a guess.
 */

/** What this device knows. Never sufficient on its own. */
export interface LocalInputs {
  /** The local note once the deposit has a position. */
  position: Position | null;
  /** The deposit in progress, before it is a usable position. */
  pendingDeposit: PendingDeposit | null;
  /** Stellar txs from this device touching this position, not yet reconciled. */
  pendingTxs?: PendingTx[];
  /** This tab is generating the deposit proof. */
  proving?: boolean;
  /** The last tree-insert attempt for this deposit failed. */
  insertFailed?: boolean;
}

export type BtcTxView = { seen: false } | { seen: true; blockHeight: number | null };

export type Outspend = { spent: false } | { spent: true; txid: string; confirmed: boolean };

/** Every field is undefined until read successfully. `null` means read and empty. */
export interface ChainReads {
  /** `get_commitment(txid)` as hex. */
  commitmentForTxid?: string | null;
  /** `is_commitment_pending(commitment)`. */
  commitmentPending?: boolean;
  /** `is_nullifier_spent(nullifier)` for the note's current nullifier. */
  nullifierSpent?: boolean;
  /** Oracle BTC price in USDC stroops per BTC. */
  oraclePriceStroops?: bigint;
  /** Esplora tip height. */
  btcTipHeight?: number;
  /** Esplora view of the deposit transaction. */
  depositTx?: BtcTxView;
  /** Esplora outspend of the lock output. */
  lockOutspend?: Outspend;
}

export type LiquidationLookup =
  | { found: true; txHash: string }
  /** `complete` is false when the lookup cannot see back to the position's creation. */
  | { found: false; complete: boolean };

/**
 * Relayer-indexed fields. Filled by the relayer
 * `/status` endpoints once they exist, by client fallbacks until then.
 */
export interface RelayerIndex {
  /** Relayer `min_confirmations`. */
  minConfirmations?: number;
  /** Confirmations the relayer has seen for the deposit. */
  confirmations?: number;
  liquidation?: LiquidationLookup;
  catchingUp?: boolean;
}

export interface StatusParams {
  /** Config denominator, used when the relayer reports none. */
  minConfirmations: number;
  now: number;
}

export interface StatusInputs {
  local: LocalInputs;
  chain: ChainReads;
  relayer: RelayerIndex | null;
  params: StatusParams;
}

export type StatusInput =
  | "position"
  | "commitment"
  | "commitment_pending"
  | "nullifier"
  | "oracle_price"
  | "btc_tip"
  | "deposit_tx"
  | "outspend"
  | "liquidation"
  | "local_tx";

export type HealthBand = "healthy" | "below_limit";

export type PositionStatus =
  | { kind: "checking"; missing: StatusInput[] }
  | { kind: "btc_sent" }
  | { kind: "btc_unseen" }
  | { kind: "confirming"; n: number; m: number; relayerBehind: boolean }
  | { kind: "ready_to_register" }
  | { kind: "proving" }
  | { kind: "registering"; step: 1 | 2 }
  | { kind: "register_failed" }
  | { kind: "active"; ratioBp: bigint; band: HealthBand }
  | { kind: "at_risk"; ratioBp: bigint }
  | { kind: "liquidatable"; ratioBp: bigint }
  | { kind: "repaid_locked"; neverBorrowed: boolean; missingBtcDetails: boolean }
  | { kind: "releasing"; btcTxid: string | null }
  | { kind: "released"; btcTxid: string }
  | { kind: "liquidated"; txHash: string }
  /** Nullifier spent, no local tx, and the liquidation lookup cannot see far enough back (L20). */
  | { kind: "closed_on_chain" }
  | { kind: "changed_elsewhere" };

export type PositionStatusKind = PositionStatus["kind"];

export interface Timelock {
  height: number;
  /** Null while the tip height is unknown. */
  blocksLeft: number | null;
}

export interface DerivedStatus {
  status: PositionStatus;
  /** Overlay: tip at or past the timelock and the lock output unspent. */
  reclaimable: boolean;
  timelock: Timelock | null;
  /** Overlay: an action landed and the relayer is catching up. */
  syncing: boolean;
}
