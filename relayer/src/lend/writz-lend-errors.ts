/**
 * `WritzLendError` codes, as `contracts/contracts/writz-lend/src/error.rs`
 * declares them. A failed `deposit` call carries only the number on chain
 * (`Error(Contract, #21)` in its diagnostic events); this table gives the
 * deposit status route a name a UI can map to a message.
 *
 * test/writz-lend-errors.test.ts parses error.rs and fails when this table
 * and the contract disagree, so a new variant cannot be reported by the
 * wrong name.
 */
export const WRITZ_LEND_ERRORS: Readonly<Record<number, string>> = Object.freeze({
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
  28: "InvalidEntryTtl",
});
