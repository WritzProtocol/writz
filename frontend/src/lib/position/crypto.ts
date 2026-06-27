import { poseidon2, poseidon4 } from "poseidon-lite";

/**
 * Position cryptography — must match the circuits in `circuits/src/` exactly,
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

/** Position commitment — `Poseidon(collateral, debt, secret, nonce)`. */
export function computeCommitment(
  collateralSats: bigint,
  debtStroops: bigint,
  secret: bigint,
  nonce: bigint,
): bigint {
  return poseidon4([collateralSats, debtStroops, secret, nonce]);
}

/** Nullifier — `Poseidon(secret, nonce)`. */
export function computeNullifier(secret: bigint, nonce: bigint): bigint {
  return poseidon2([secret, nonce]);
}
