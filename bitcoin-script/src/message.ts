/**
 * Bitcoin signed messages (BIP-137, the "Bitcoin Signed Message" format that
 * wallets produce for compressed keys): framing, signing and public key
 * recovery. Only compressed keys are accepted, the only kind a P2WPKH address
 * can hold.
 *
 * The framing matches `frontend/app/src/lib/bitcoin/keyProof.ts`
 * (`signedMessageFrame`) and `spv-types::key_proof` in the contracts.
 */
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';

const MAGIC = 'Bitcoin Signed Message:\n';

function varint(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {
    const b = Buffer.alloc(3);
    b[0] = 0xfd;
    b.writeUInt16LE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = 0xfe;
  b.writeUInt32LE(n, 1);
  return b;
}

/** SHA256d of the BIP-137 framing of `message`: the digest a wallet signs. */
export function bitcoinMessageHash(message: string): Buffer {
  const m = Buffer.from(message, 'utf8');
  const magic = Buffer.from(MAGIC, 'utf8');
  return bitcoin.crypto.hash256(Buffer.concat([varint(magic.length), magic, varint(m.length), m]));
}

/**
 * Signs `message` with a raw 32-byte private key and returns the 65-byte
 * signature in base64, with the BIP-137 header for a native SegWit (P2WPKH)
 * address (39 + recovery id). For tests and the embedded Signet test key.
 */
export function signBitcoinMessage(message: string, privkey: Buffer): string {
  const { signature, recoveryId } = ecc.signRecoverable(bitcoinMessageHash(message), privkey);
  return Buffer.concat([Buffer.from([39 + recoveryId]), Buffer.from(signature)]).toString('base64');
}

/**
 * Recovers the compressed public key that produced a BIP-137 signature over
 * `message`, or returns null when the signature is malformed, uses an
 * uncompressed-key header (27 to 30), or does not recover. Headers 31 to 34
 * (compressed P2PKH, what most wallets emit), 35 to 38 (P2SH-P2WPKH) and
 * 39 to 42 (P2WPKH) are accepted: the caller compares the recovered key with
 * the one it expects, so the address type in the header adds nothing.
 */
export function recoverBitcoinMessagePubkey(message: string, signature: string | Buffer): Buffer | null {
  const sig = typeof signature === 'string' ? Buffer.from(signature, 'base64') : signature;
  if (sig.length !== 65) return null;
  const header = sig[0];
  if (header < 31 || header > 42) return null;
  const recoveryId = ((header - 27) & 3) as 0 | 1 | 2 | 3;
  try {
    const pub = ecc.recover(bitcoinMessageHash(message), sig.subarray(1), recoveryId, true);
    return pub ? Buffer.from(pub) : null;
  } catch {
    return null;
  }
}

/** True when `signature` is a BIP-137 signature over `message` by the compressed key `pubkey`. */
export function verifyBitcoinMessage(message: string, signature: string | Buffer, pubkey: Buffer): boolean {
  const recovered = recoverBitcoinMessagePubkey(message, signature);
  return recovered !== null && pubkey.length === 33 && recovered.equals(pubkey);
}
