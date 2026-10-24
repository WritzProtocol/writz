/** Everything needed to talk to one Writz deployment. */
export interface NetworkPreset {
  readonly network: "testnet";
  readonly networkPassphrase: string;
  readonly rpcUrl: string;
  readonly relayerUrl: string;
  /** The Bitcoin network the light client tracks. */
  readonly bitcoinNetwork: "signet";
  /** Only blocks above this Bitcoin height can be proven. */
  readonly spvCheckpointHeight: number;
  readonly contracts: {
    readonly bitcoinSpv: string;
    readonly writzLend: string;
    /** Test USDC, Stellar Asset Contract, 7 decimals. */
    readonly usdc: string;
    /** BTC/USD oracle `writz-lend` reads (Reflector). */
    readonly oracle: string;
  };
}

/**
 * The five arguments of `verify_transaction`, exactly as the relayer returns
 * them in `sorobanArgs`: hex strings in internal byte order.
 */
export interface SorobanArgs {
  block_hash: string;
  merkle_proof: string[];
  tx_index: number;
  raw_tx: string;
  min_confirmations: number;
}

/** 200 body of `GET /spv-proof/:txid`. */
export interface SpvProof {
  /** Display byte order, as explorers show it. */
  txid: string;
  rawTxNoWitness: string;
  blockHash: string;
  txIndex: number;
  merkleProof: string[];
  /** Raw 80-byte headers from the block onwards; `verify_transaction` does not take them. */
  headers: string[];
  blockHeight: number;
  /** The minimum you asked for, not the block's actual depth. */
  confirmations: number;
  sorobanArgs: SorobanArgs;
}

/** Result of `verify_transaction`. Hashes are hex. */
export interface VerificationResult {
  /** SHA256d of `raw_tx`, internal byte order (as the contract returns it). */
  txid: string;
  /** The same txid in display order, as explorers show it. */
  txidDisplay: string;
  /** Internal byte order. */
  blockHash: string;
  blockHeight: number;
  /** The block's actual depth below the light client's tip (tip = 1). */
  confirmations: number;
}

export interface BestTip {
  /** Internal byte order. */
  hash: string;
  height: number;
  chainwork: bigint;
}

export interface HeaderEntry {
  prev: string;
  merkleRoot: string;
  height: number;
  bits: number;
  time: number;
  periodStartTime: number;
  chainwork: bigint;
}

export interface Checkpoint {
  height: number;
  /** Internal byte order. */
  blockHash: string;
  bits: number;
  time: number;
  periodStartTime: number;
  setAtLedger: number;
}

/** `writz-lend` global state. USDC amounts in stroops (7 decimals), indexes scaled by 10^18. */
export interface ProtocolState {
  totalScaledSupply: bigint;
  supplyIndex: bigint;
  totalBorrowed: bigint;
  reserveUsdc: bigint;
  borrowIndex: bigint;
  indexLedger: number;
  lastKeeperHeartbeat: bigint;
}

export type PositionStatus = "Active" | "Closed" | "Liquidated";

/** A `writz-lend` position, keyed by the BTC deposit txid. */
export interface Position {
  /** Internal byte order. */
  btcTxid: string;
  btcSatoshis: bigint;
  /** Stroops, as last accrued. */
  usdcDebt: bigint;
  p2wshScriptPubkey: string;
  timelockHeight: number;
  lastUpdateLedger: number;
  debtIndex: bigint;
  depositor: string;
  status: PositionStatus;
  userPubkey: string;
}

/** `GET /defindex/position` answer. */
export interface EarnPosition {
  dfTokens: bigint;
  underlyingStroops: bigint;
}
