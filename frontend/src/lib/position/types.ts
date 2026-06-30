/**
 * A private lending position. Amounts live on the device; `secret`/`nonce` are
 * NOT persisted — they are derived on demand from the wallet-derived session seed
 * plus `index`/`version` (see lib/position/derive). BigInt fields are decimal
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
  /** Derivation index — which position for this wallet. secret = derive(seed, index). */
  index: number;
  /** Nonce rotation counter — incremented on every borrow/repay. nonce = derive(seed, index, version). */
  version: number;
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
  /** Leaf index in the on-chain Merkle tree, assigned at deposit. Needed to compute the
   *  correct Merkle path after subsequent borrows/repays rotate the commitment. */
  leafIndex?: number;
  /** True for a test position created via "Load demo position" (no real BTC). */
  demo?: boolean;
}

/** A versioned export envelope for backup / restore. */
export interface PositionsBackup {
  version: 1;
  owner: string;
  positions: Position[];
}
