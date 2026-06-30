import { x25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { sha256 } from "@noble/hashes/sha2.js";

/**
 * Recovery notes (issue #18, Layer 2).
 *
 * On every position change the client seals the note plaintext to the owner's
 * x25519 viewing public key and the contract emits the ciphertext in its event.
 * On a fresh device the user re-derives the viewing key, scans the emitted
 * blobs, and trial-decrypts — the ones that open are theirs — recovering the
 * amounts (which are NOT derivable from the seed and are hidden in the
 * commitment). Anonymous-sender sealed-box pattern: ephemeral x25519 → ECDH →
 * SHA-256 → ChaCha20-Poly1305. Wire format: ephPub(32) ‖ nonce(12) ‖ ciphertext.
 */
export interface PositionNote {
  index: number; // derivation index
  version: number; // nonce rotation counter
  collateralSats: string;
  debtStroops: string;
}
// Note: leafIndex is intentionally NOT in the note — on recovery it's resolved by
// recomputing the commitment and matching it against the relayer's leaf list
// (the deposit leafIndex isn't known until after the note is sealed into deposit()).

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/** Seal a note to a viewing public key. Returns the wire blob. */
export function sealNote(note: PositionNote, viewingPub: Uint8Array): Uint8Array {
  const ephSk = randomBytes(32); // x25519 clamps internally; any 32 bytes is a valid scalar
  const ephPub = x25519.getPublicKey(ephSk);
  const key = sha256(x25519.getSharedSecret(ephSk, viewingPub));
  const nonce = randomBytes(12);
  const pt = new TextEncoder().encode(JSON.stringify(note));
  const ct = chacha20poly1305(key, nonce).encrypt(pt);
  const out = new Uint8Array(32 + 12 + ct.length);
  out.set(ephPub, 0);
  out.set(nonce, 32);
  out.set(ct, 44);
  return out;
}

/** Try to open a sealed note with the viewing secret key. Returns null if not ours. */
export function openNote(blob: Uint8Array, viewingSk: Uint8Array): PositionNote | null {
  try {
    if (blob.length < 44) return null;
    const ephPub = blob.slice(0, 32);
    const nonce = blob.slice(32, 44);
    const ct = blob.slice(44);
    const key = sha256(x25519.getSharedSecret(viewingSk, ephPub));
    const pt = chacha20poly1305(key, nonce).decrypt(ct);
    return JSON.parse(new TextDecoder().decode(pt)) as PositionNote;
  } catch {
    return null;
  }
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(h: string): Uint8Array {
  const clean = h.startsWith("0x") ? h.slice(2) : h;
  return new Uint8Array((clean.match(/.{1,2}/g) ?? []).map((x) => parseInt(x, 16)));
}
