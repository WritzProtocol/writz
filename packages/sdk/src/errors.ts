/** Base class of every error this package throws on purpose. */
export class WritzError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Error codes the relayer answers with. Other strings can appear on routes that pass an upstream message through. */
export type RelayerErrorCode =
  | "invalid_txid"
  | "invalid_confirmations"
  | "unconfirmed"
  | "tx_not_found"
  | "insufficient_confirmations"
  | "light_client_behind"
  | "rate_limited"
  | "upstream_error"
  | "upstream_unavailable"
  | "http_error"
  | "network_error";

/**
 * A non-2xx answer from the relayer, or a request that never got one
 * (`network_error`). `retryAfterSeconds` is set on 409 `light_client_behind`,
 * 429 and 503: wait that long before asking again.
 */
export class RelayerError extends WritzError {
  constructor(
    message: string,
    readonly status: number,
    readonly code: RelayerErrorCode | (string & {}),
    readonly retryAfterSeconds: number | undefined,
    readonly body: unknown,
  ) {
    super(message);
  }

  /** True when the relayer said when to try again. */
  get retryable(): boolean {
    return this.retryAfterSeconds !== undefined;
  }
}

/** Error names of `bitcoin-spv`, by code. Codes are stable. */
export const SPV_ERRORS: Readonly<Record<number, string>> = {
  1: "NoHeaders",
  2: "InsufficientConfirmations",
  3: "ZeroMinConfirmations",
  4: "HeaderChainBroken",
  5: "MerkleProofInvalid",
  6: "InvalidHeaderSlice",
  7: "EmptyTransaction",
  8: "InsufficientProofOfWork",
  9: "InvalidDifficultyBits",
  10: "NotInitialized",
  11: "AlreadyInitialized",
  12: "Unauthorized",
  13: "CheckpointNotSet",
  14: "DifficultyBelowCheckpointFloor",
  15: "AmbiguousTransactionLength",
  16: "CheckpointAlreadySet",
  17: "InvalidCheckpoint",
  18: "TooManyHeaders",
  19: "UnknownParent",
  20: "UnexpectedDifficulty",
  21: "TimestampTooFarInFuture",
  22: "HeaderNotFound",
  23: "NotOnBestChain",
  24: "BlockNotAfterCheckpoint",
  25: "ReorgTooDeep",
  26: "TxidAlreadyConsumed",
  27: "NotAConsumer",
};

/** Error names of `writz-lend`, by code. Codes are stable. */
export const WRITZ_LEND_ERRORS: Readonly<Record<number, string>> = {
  1: "AlreadyInitialized",
  2: "NotInitialized",
  3: "Unauthorized",
  4: "SpvVerificationFailed",
  5: "OutputNotFound",
  6: "DepositTooSmall",
  7: "PositionAlreadyExists",
  8: "PositionNotFound",
  9: "PositionNotActive",
  10: "ExceedsCollateralRatio",
  11: "InsufficientLiquidity",
  12: "RepayExceedsDebt",
  13: "InsufficientSupply",
  14: "PositionHealthy",
  15: "Overflow",
  16: "InvalidScriptPubKey",
  17: "Paused",
  18: "OraclePriceUnavailable",
  19: "OraclePriceStale",
  20: "InvalidUserPubkey",
  21: "ScriptPubKeyMismatch",
  22: "InvalidTimelock",
  23: "InvalidProtocolPubkey",
  24: "ExposureCapExceeded",
  25: "InvalidKeyProof",
  26: "ZeroShareAmount",
  27: "InvalidDepositParams",
};

export type ContractName = "bitcoin-spv" | "writz-lend";

/**
 * A contract call that failed in simulation. `code` is the contract's error
 * code (`Error(Contract, #N)`) when there is one; `errorName` its name.
 * `cause` holds the raw RPC message.
 */
export class ContractError extends WritzError {
  readonly errorName: string | undefined;

  constructor(
    readonly contract: ContractName,
    readonly method: string,
    readonly code: number | undefined,
    readonly detail: string,
  ) {
    const errorName =
      code === undefined
        ? undefined
        : (contract === "bitcoin-spv" ? SPV_ERRORS : WRITZ_LEND_ERRORS)[code];
    super(
      code === undefined
        ? `${contract}.${method} failed: ${detail.split("\n")[0]}`
        : `${contract}.${method} failed with #${code}${errorName ? ` ${errorName}` : ""}`,
    );
    this.errorName = errorName;
  }
}

/** The contract error code in a simulation error message, if any. */
export function contractErrorCode(message: string): number | undefined {
  const m = message.match(/Error\(Contract, #(\d+)\)/);
  return m ? Number(m[1]) : undefined;
}
