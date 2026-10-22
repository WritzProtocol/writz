import { describe, expect, it } from "bun:test";
import { createHash } from "crypto";
import { depositKeyMessage, parseMessageSignature, signedMessageFrame } from "./keyProof";

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();

/** Shared with spv-types/src/key_proof.rs tests: both sides must produce this digest. */
export const VECTOR = {
  contract: "CAQBLCAPGXXCZTJDAJLY7E4PTJYGR6CY4YWH4JSJKFXYIHW3GANP6RFM",
  depositor: "GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT",
  txid: "e80765d874d4e31da59b6f30617cf7018fe635f836a892dc671d77bcb7c1ee24",
};

describe("depositKeyMessage", () => {
  it("names the contract, the depositor and the display txid, in that order", () => {
    expect(depositKeyMessage(VECTOR.contract, VECTOR.depositor, VECTOR.txid.toUpperCase())).toBe(
      `Writz deposit\ncontract:${VECTOR.contract}\ndepositor:${VECTOR.depositor}\ntxid:${VECTOR.txid}`,
    );
  });

  it("frames and hashes like a Bitcoin signed message, matching the contract", () => {
    const msg = depositKeyMessage(VECTOR.contract, VECTOR.depositor, VECTOR.txid);
    const digest = sha256(sha256(signedMessageFrame(msg))).toString("hex");
    expect(digest).toBe(EXPECTED_DIGEST);
  });
});

describe("parseMessageSignature", () => {
  it("accepts a 65-byte compressed-key signature", () => {
    const sig = Buffer.alloc(65, 1);
    sig[0] = 39; // native segwit P2WPKH
    expect(parseMessageSignature(sig.toString("base64")).length).toBe(65);
  });

  it("refuses BIP-322 blobs and uncompressed-key headers", () => {
    expect(() => parseMessageSignature(Buffer.alloc(80).toString("base64"))).toThrow(/ECDSA/);
    const uncompressed = Buffer.alloc(65, 1);
    uncompressed[0] = 27;
    expect(() => parseMessageSignature(uncompressed.toString("base64"))).toThrow(/uncompressed/);
  });
});

const EXPECTED_DIGEST = "0125d670b399e17a6b05d0a323ec534376f94b089e5470a14bc25687e42099ee";
