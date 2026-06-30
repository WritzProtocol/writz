import { poseidon3, poseidon4 } from "poseidon-lite";
import { sha256 } from "@noble/hashes/sha2.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { FIELD_PRIME } from "./crypto";

/**
 * Deterministic, recoverable position keys (issue #18).
 *
 * The user signs one constant message with their Stellar wallet (SEP-53,
 * deterministic ed25519). The signature is hashed into an in-memory master seed
 * from which everything is derived, so no secret is persisted and positions are
 * recoverable by reconnecting the same wallet on any device:
 *   - per-position spending keys (`secret`/`nonce`) via Poseidon, in the BN254 field
 *   - an x25519 *viewing key* for encrypting/decrypting recovery notes (see notes.ts)
 */

/**
 * Canonical message signed once per session. MUST stay byte-for-byte constant —
 * any edit derives different keys and orphans existing positions.
 */
export const KEY_DERIVATION_MESSAGE = `Writz — position keys

Sign this message to derive the private keys for your Writz positions.
This lets you access your positions on any device with this wallet.

Only sign this on app.writz.io. It does not create a transaction or cost fees.

Version: 1`;

// Domain separators keep the key types independent under one seed.
const DOMAIN_SECRET = 1n;
const DOMAIN_NONCE = 2n;
const VIEWING_KEY_DOMAIN = "writz-viewing-x25519/v1";

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 32-byte in-memory master seed from a wallet message signature (deterministic). */
export function deriveSeed(signatureBase64: string): Uint8Array {
  return sha256(base64ToBytes(signatureBase64));
}

function bytesToField(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v % FIELD_PRIME;
}

/** Field-element form of the seed — the Poseidon derivation root. */
export function seedToField(seed: Uint8Array): bigint {
  return bytesToField(seed);
}

/** Per-position secret — fixed for a position's whole lifetime. */
export function deriveSecret(seedField: bigint, index: number): bigint {
  return poseidon3([seedField, DOMAIN_SECRET, BigInt(index)]);
}

/** Per-position nonce — rotates with `version` (incremented on each borrow/repay). */
export function deriveNonce(seedField: bigint, index: number, version: number): bigint {
  return poseidon4([seedField, DOMAIN_NONCE, BigInt(index), BigInt(version)]);
}

export interface ViewingKey {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

/**
 * x25519 viewing keypair for recovery-note encryption, domain-separated from the
 * position spending keys. Derived from the same seed → recoverable on any device.
 */
export function deriveViewingKey(seed: Uint8Array): ViewingKey {
  const domain = new TextEncoder().encode(VIEWING_KEY_DOMAIN);
  const material = new Uint8Array(seed.length + domain.length);
  material.set(seed);
  material.set(domain, seed.length);
  const secretKey = sha256(material);
  const publicKey = x25519.getPublicKey(secretKey);
  return { secretKey, publicKey };
}
