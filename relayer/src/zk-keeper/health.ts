/**
 * The liquidation circuit's undercollateralization test, in integers:
 *   debt × 10^8 × threshold_bp  >  collateral × price × 10^4
 * Kept identical to privacy/circuits/src/liquidation.circom so the keeper never
 * spends a proof attempt on a position the circuit would refuse.
 */
export function isLiquidatable(
  collateralSats: bigint,
  debtStroops: bigint,
  priceStroopsPerBtc: bigint,
  thresholdBp: bigint,
): boolean {
  if (debtStroops === 0n) return false;
  return debtStroops * 100_000_000n * thresholdBp > collateralSats * priceStroopsPerBtc * 10_000n;
}
