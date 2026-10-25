/**
 * Defaults for the guided loop: amounts a first-time tester can accept
 * without doing arithmetic, chosen to work and to stay far from liquidation.
 */

/** Kept back from a deposit for its network fee, and a little more. */
export const DEPOSIT_FEE_RESERVE_SATS = 1_000n;
/** Deposits are rounded down to a round number of sats. */
const DEPOSIT_STEP_SATS = 1_000n;
/** Share of the safe maximum the guide suggests borrowing: about 600% collateral, far from the 120% liquidation line. */
export const SUGGESTED_BORROW_SHARE_PERCENT = 25n;
/** 0.01 USDC in stroops: suggested amounts are rounded down to cents. */
const CENT_STROOPS = 100_000n;

/**
 * Most of the balance, minus the fee reserve, rounded down to 1,000 sats.
 * Null when what is left would be below the contract minimum.
 */
export function suggestDepositSats(balanceSats: bigint, minDepositSats: bigint): bigint | null {
  const usable = balanceSats - DEPOSIT_FEE_RESERVE_SATS;
  const rounded = usable - (usable % DEPOSIT_STEP_SATS);
  return rounded >= minDepositSats ? rounded : null;
}

/** A quarter of the safe maximum, rounded down to cents; null when that rounds to nothing. */
export function suggestBorrowStroops(maxStroops: bigint): bigint | null {
  const quarter = (maxStroops * SUGGESTED_BORROW_SHARE_PERCENT) / 100n;
  const rounded = quarter - (quarter % CENT_STROOPS);
  return rounded > 0n ? rounded : null;
}

/** "0.00019" for 19,000 sats: the shortest decimal BTC string, for the amount field. */
export function satsToBtcInput(sats: bigint): string {
  const whole = sats / 100_000_000n;
  const frac = (sats % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/**
 * USDC to buy so a full repayment goes through: the debt (which grew with
 * interest since the borrow) less what the wallet holds, rounded up to the
 * next cent so interest that accrues while the swap lands is covered too.
 * Zero when the wallet already covers the debt.
 */
export function repayShortfallStroops(debtStroops: bigint, walletStroops: bigint): bigint {
  const short = debtStroops - walletStroops;
  if (short <= 0n) return 0n;
  return (short / CENT_STROOPS + 1n) * CENT_STROOPS;
}
