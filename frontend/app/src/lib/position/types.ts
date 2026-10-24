/**
 * A loan as this device remembers it. The chain is the truth: `writz-lend`
 * keeps every position in plaintext, keyed by its Bitcoin deposit txid, and
 * screens derive status from `get_position`. This record holds what the
 * chain does not answer directly (the loan's number on this wallet, the
 * deposit output index, the release this device sent) and the last amounts
 * read, so a loan can render before its reads land. BigInt fields are decimal
 * strings for JSON-safe persistence.
 */
export type PositionStatus = "active" | "closed" | "released" | "liquidated";

export interface Position {
  /** Stable local id: the Bitcoin deposit txid, display order. */
  id: string;
  /** Stellar address this position belongs to (its `depositor` on chain). */
  owner: string;
  /** Bitcoin txid of the collateral deposit (hex, display order). Same as `id`. */
  txid: string;
  /** Collateral locked, in satoshis. */
  collateralSats: string;
  /** USDC debt in stroops at the last read. A hint: the chain decides. */
  debtStroops: string;
  /** Which loan this is for the wallet: "Loan n" is `index + 1`. */
  index: number;
  /** Local hint of the chain status, refreshed on every read. */
  status: PositionStatus;
  /** Unix ms when created (stamped by the caller). */
  createdAt: number;
  /** User's Bitcoin compressed pubkey hex (33 bytes), from the chain. */
  btcPubkey?: string;
  /** CLTV block height in the P2WSH redeem script, from the chain. */
  timelockHeight?: number;
  /** Vout of the collateral UTXO within the deposit transaction. */
  vout?: number;
  /** Bitcoin txid of the release transaction, once broadcast. */
  releaseTxid?: string;
  /** Bitcoin address the collateral was released to. */
  releaseAddress?: string;
  /** Stellar transaction that registered the deposit. */
  stellarTxHash?: string;
}

/** A versioned export envelope for backup / restore. */
export interface PositionsBackup {
  version: 1;
  owner: string;
  positions: Position[];
}
