import { poseidon1, poseidon2, poseidon5 } from "poseidon-lite";
import { bytesToHex } from "./notes";

/**
 * Position cryptography - must match the circuits in `circuits/src/` exactly,
 * or proofs will fail on-chain. `poseidon-lite` is verified to produce the same
 * outputs as the `circomlibjs` Poseidon used by the circuits.
 *
 *   liq_key    = Poseidon(secret)
 *   commitment = Poseidon(collateral_satoshis, debt_stroops, liq_key, nonce, timelock_height)
 *   nullifier  = Poseidon(liq_key, nonce)
 *
 * `liq_key` is what the keeper receives (encrypted, inside every borrow and
 * repay proof) so it can liquidate the position; it cannot borrow, repay or
 * release, which take `secret` (#212). `timelock_height` is the CLTV height of
 * the position's Bitcoin script, bound at deposit.
 */

/** BN254 scalar field prime. */
export const FIELD_PRIME =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** A cryptographically-random field element in [1, FIELD_PRIME). */
export function randomFieldElement(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  value %= FIELD_PRIME;
  return value === 0n ? 1n : value;
}

/** Liquidation key - `Poseidon(secret)`. */
export function liquidationKey(secret: bigint): bigint {
  return poseidon1([secret]);
}

/** Position commitment - `Poseidon(collateral, debt, Poseidon(secret), nonce, timelock)`. */
export function computeCommitment(
  collateralSats: bigint,
  debtStroops: bigint,
  secret: bigint,
  nonce: bigint,
  timelockHeight: number,
): bigint {
  return poseidon5([collateralSats, debtStroops, liquidationKey(secret), nonce, BigInt(timelockHeight)]);
}

/** Nullifier - `Poseidon(Poseidon(secret), nonce)`. */
export function computeNullifier(secret: bigint, nonce: bigint): bigint {
  return poseidon2([liquidationKey(secret), nonce]);
}

/**
 * A fresh ephemeral scalar for a keeper note. The circuit decomposes it into
 * 253 bits; 248 random bits stay well inside that and the BabyJubJub order.
 */
export function randomEphemeralScalar(): bigint {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  return value === 0n ? 1n : value;
}

/**
 * Split sha256(strkey) into the two 128-bit halves the borrow_repay circuit
 * expects as `recipient_lo` / `recipient_hi`. `commitment-tree::borrow()`
 * independently recomputes the same digest from the authenticated address
 * and rejects a mismatch - this binds the proof to its recipient so it
 * can't be resubmitted with a different address (GHSA-xxqv-6vhx-hhrx,
 * GHSA-mhp9-jmvc-x9mw).
 */
export async function recipientLoHi(strkey: string): Promise<{ lo: string; hi: string }> {
  const bytes = new TextEncoder().encode(strkey);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer));
  const hi = BigInt("0x" + bytesToHex(digest.subarray(0, 16))).toString();
  const lo = BigInt("0x" + bytesToHex(digest.subarray(16, 32))).toString();
  return { lo, hi };
}
