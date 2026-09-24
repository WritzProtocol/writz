/**
 * USDC amount conversion for the Earn flows.
 *
 * USDC has 7 decimals, so the on-wire and on-chain unit is the stroop. Every
 * conversion here goes through `bigint` and string manipulation, never a
 * float: `Number("12345678.1234567") * 1e7` is already wrong, and vault
 * balances reach that range. Shared by deposit (#109), the balance and APY
 * display (#110), and withdraw (#111).
 */

export const STROOP = 10_000_000n;

/** Format stroops as a human USDC amount, trailing zeros trimmed. */
export function fmtUsdc(stroops: bigint): string {
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const whole = (abs / STROOP).toLocaleString("en-US");
  const frac = (abs % STROOP).toString().padStart(7, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/**
 * Parse a user-typed USDC amount into stroops, or null when it is not a
 * usable positive amount. Rejects, deliberately:
 *   - anything that is not digits with at most one decimal point (no signs, no
 *     exponents, no thousands separators),
 *   - more than 7 decimal places, which USDC cannot represent and which would
 *     otherwise be silently truncated,
 *   - zero.
 *
 * Accepts the grouped output of `fmtUsdc` ("1,234.5") so the Max button can
 * round-trip through the input field.
 */
export function toStroops(input: string): bigint | null {
  const trimmed = input.trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") return null;

  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > 7) return null;

  const stroops =
    BigInt(whole === "" ? "0" : whole) * STROOP + BigInt(frac.padEnd(7, "0"));
  return stroops > 0n ? stroops : null;
}
