import { Buffer } from "buffer";

/**
 * Proof that the depositor controls the Bitcoin key their deposit names
 * (GHSA-862g-739q-x6h8). The wallet signs this text as a standard Bitcoin
 * signed message (ECDSA, BIP-137); the lending contract rebuilds the same
 * text and recovers the signer. Must stay byte-identical to
 * `spv-types::key_proof::deposit_message`.
 */
export function depositKeyMessage(contractId: string, depositor: string, txidDisplayHex: string): string {
  return `Writz deposit\ncontract:${contractId}\ndepositor:${depositor}\ntxid:${txidDisplayHex.toLowerCase()}`;
}

const MAGIC = "Bitcoin Signed Message:\n";

function varint(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  const b = Buffer.alloc(3);
  b[0] = 0xfd;
  b.writeUInt16LE(n, 1);
  return b;
}

/** The BIP-137 framing of `message`, before hashing (SHA256d). */
export function signedMessageFrame(message: string): Buffer {
  const m = Buffer.from(message, "utf8");
  return Buffer.concat([varint(MAGIC.length), Buffer.from(MAGIC, "utf8"), varint(m.length), m]);
}

/**
 * Decodes a wallet's base64 ECDSA message signature into the 65 bytes the
 * contract takes (header, r, s), refusing anything the contract would reject.
 */
export function parseMessageSignature(base64: string): Buffer {
  const sig = Buffer.from(base64, "base64");
  if (sig.length !== 65) {
    throw new Error("Your Bitcoin wallet returned a signature in an unsupported format. Sign with ECDSA (not BIP-322).");
  }
  if (sig[0] < 31 || sig[0] > 42) {
    throw new Error("Your Bitcoin wallet signed with an uncompressed key, which Writz deposits do not use.");
  }
  return sig;
}
