import { poseidon2, poseidon3, poseidon4 } from "poseidon-lite";
import { FIELD_PRIME } from "./crypto";

/**
 * Deterministic, recoverable position keys — issue #18, Layer 1 (key derivation).
 *
 * The user signs one constant message with their Stellar wallet. Stellar message
 * signing (SEP-53) hashes a fixed preimage and signs it with ed25519, which is
 * deterministic — the same wallet + same message yields the same signature on any
 * device. We hash that signature into an in-memory master seed and derive every
 * position key from it, so no secret is ever persisted and positions are
 * recoverable by reconnecting the same wallet.
 *
 * Keys are derived with Poseidon (the same hash family as the circuits), so every
 * result is already a valid BN254 field element. This module is pure and carries
 * no wallet/React dependency; wiring it into the flows happens after the deposit
 * flow (#7) lands.
 */

/**
 * Canonical message signed once per session to derive the master seed.
 * It MUST stay byte-for-byte constant — any edit derives different keys and
 * orphans existing positions. Bump the trailing version only with a migration.
 */
export const KEY_DERIVATION_MESSAGE = `Writz — position keys

Sign this message to derive the private keys for your Writz positions.
This lets you access your positions on any device with this wallet.

Only sign this on app.writz.io. It does not create a transaction or cost fees.

Version: 1`;

// Domain separators keep the three key types independent under one seed.
const DOMAIN_SECRET = 1n;
const DOMAIN_NONCE = 2n;
const DOMAIN_VIEWING_KEY = 3n;

/** Interpret big-endian bytes as a field element. */
function bytesToField(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  return value % FIELD_PRIME;
}

/** Decode a base64 string into a fresh ArrayBuffer (browser/Node/Bun-safe). */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

/**
 * Derive the in-memory master seed from a wallet message signature.
 * `signatureBase64` is the `signedMessage` returned by the wallet's signMessage.
 */
export async function deriveMasterSeed(signatureBase64: string): Promise<bigint> {
  const digest = await crypto.subtle.digest("SHA-256", base64ToArrayBuffer(signatureBase64));
  return bytesToField(new Uint8Array(digest));
}

/** Per-position secret — fixed for a position's whole lifetime. */
export function deriveSecret(seed: bigint, index: number): bigint {
  return poseidon3([seed, DOMAIN_SECRET, BigInt(index)]);
}

/**
 * Per-position nonce — rotates with `version`, which increments on every
 * borrow/repay so each on-chain commitment/nullifier is unlinkable.
 */
export function deriveNonce(seed: bigint, index: number, version: number): bigint {
  return poseidon4([seed, DOMAIN_NONCE, BigInt(index), BigInt(version)]);
}

/** Viewing key for encrypting/decrypting recovery notes (Layer 2, future). */
export function deriveViewingKey(seed: bigint): bigint {
  return poseidon2([seed, DOMAIN_VIEWING_KEY]);
}
