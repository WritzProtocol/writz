import { poseidon2, poseidon4 } from "poseidon-lite";
import { bytesToHex } from "./notes";

/**
 * Position cryptography - must match the circuits in `circuits/src/` exactly,
 * or proofs will fail on-chain. `poseidon-lite` is verified to produce the same
 * outputs as the `circomlibjs` Poseidon used by the circuits.
 *
 *   commitment = Poseidon(collateral_satoshis, debt_stroops, secret, nonce)
 *   nullifier  = Poseidon(secret, nonce)
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

/** Position commitment - `Poseidon(collateral, debt, secret, nonce)`. */
export function computeCommitment(
  collateralSats: bigint,
  debtStroops: bigint,
  secret: bigint,
  nonce: bigint,
): bigint {
  return poseidon4([collateralSats, debtStroops, secret, nonce]);
}

/** Nullifier - `Poseidon(secret, nonce)`. */
export function computeNullifier(secret: bigint, nonce: bigint): bigint {
  return poseidon2([secret, nonce]);
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
