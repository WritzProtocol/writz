/**
 * A private lending position, owned and stored entirely on the user's device.
 * The chain only ever sees `commitment` / `nullifier`; everything else
 * (amounts, secret, nonce) lives here. BigInt fields are stored as decimal
 * strings for JSON-safe persistence.
 */
export type PositionStatus = "pending" | "active" | "closed";

export interface Position {
  /** Stable local id — the current commitment (decimal string). */
  id: string;
  /** Stellar address this position belongs to. */
  owner: string;
  /** Bitcoin txid of the collateral deposit (hex), once known. */
  txid: string | null;
  /** Collateral locked, in satoshis. */
  collateralSats: string;
  /** Current USDC debt, in stroops. */
  debtStroops: string;
  /** Private secret (field element). Losing this locks the position until the timelock. */
  secret: string;
  /** Current nonce (field element); rotates on every borrow/repay. */
  nonce: string;
  /** Current commitment (decimal string). */
  commitment: string;
  /** Current nullifier (decimal string) — spent when the position next changes. */
  nullifier: string;
  status: PositionStatus;
  /** Unix ms when created (stamped by the caller). */
  createdAt: number;
  /** User's Bitcoin compressed pubkey hex (33 bytes). Needed to reconstruct the P2WSH for release. */
  btcPubkey?: string;
  /** CLTV block height used in the P2WSH redeem script. Needed to reconstruct it for release. */
  timelockHeight?: number;
  /** Vout of the collateral UTXO within the deposit transaction. */
  vout?: number;
}

/** A versioned export envelope for backup / restore. */
export interface PositionsBackup {
  version: 1;
  owner: string;
  positions: Position[];
}
