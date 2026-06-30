import { describe, expect, test } from "bun:test";
import {
  KEY_DERIVATION_MESSAGE,
  deriveSeed,
  seedToField,
  deriveSecret,
  deriveNonce,
  deriveViewingKey,
} from "./derive";
import { sealNote, openNote, type PositionNote } from "./notes";
import { FIELD_PRIME, computeCommitment } from "./crypto";

// A real SEP-53 signature (base64) from Freighter, used as a stable input.
const SIG =
  "sYB+OzWZL66TGqdHo07CkP6m2NDThg7TbRkuSB//HBw3cq98U/qlqJTyjz52ZqaSbfVBEE/p1bHSEobSblCOAg==";

describe("key derivation (#18)", () => {
  test("seed + keys are deterministic for the same signature", () => {
    expect(deriveSeed(SIG)).toEqual(deriveSeed(SIG));
    const f = seedToField(deriveSeed(SIG));
    expect(deriveSecret(f, 0)).toBe(deriveSecret(f, 0));
    expect(deriveNonce(f, 0, 0)).toBe(deriveNonce(f, 0, 0));
  });

  test("different signatures yield different seeds", () => {
    expect(deriveSeed(SIG)).not.toEqual(deriveSeed("AAAA" + SIG.slice(4)));
  });

  test("derived spending keys are valid BN254 field elements", () => {
    const f = seedToField(deriveSeed(SIG));
    for (const v of [deriveSecret(f, 0), deriveNonce(f, 0, 0)]) {
      expect(v).toBeGreaterThan(0n);
      expect(v).toBeLessThan(FIELD_PRIME);
    }
  });

  test("secret fixed per index; nonce rotates per index and version", () => {
    const f = seedToField(deriveSeed(SIG));
    expect(deriveSecret(f, 0)).not.toBe(deriveSecret(f, 1));
    expect(deriveNonce(f, 0, 0)).not.toBe(deriveNonce(f, 0, 1));
    expect(deriveNonce(f, 0, 0)).not.toBe(deriveNonce(f, 1, 0));
  });

  test("viewing key is a deterministic x25519 keypair", () => {
    const a = deriveViewingKey(deriveSeed(SIG));
    const b = deriveViewingKey(deriveSeed(SIG));
    expect(a.secretKey).toEqual(b.secretKey);
    expect(a.publicKey.length).toBe(32);
  });

  test("canonical message is fixed", () => {
    expect(KEY_DERIVATION_MESSAGE.startsWith("Writz — position keys")).toBe(true);
    expect(KEY_DERIVATION_MESSAGE).toContain("Version: 1");
  });
});

describe("recovery notes (#18 Layer 2)", () => {
  const note: PositionNote = {
    index: 0,
    version: 2,
    collateralSats: "1000000",
    debtStroops: "3000000000",
  };

  test("seal → open round-trips with the owner's viewing key", () => {
    const vk = deriveViewingKey(deriveSeed(SIG));
    const blob = sealNote(note, vk.publicKey);
    expect(openNote(blob, vk.secretKey)).toEqual(note);
  });

  test("a different viewing key cannot open the note (trial-decrypt fails)", () => {
    const owner = deriveViewingKey(deriveSeed(SIG));
    const other = deriveViewingKey(deriveSeed("BBBB" + SIG.slice(4)));
    const blob = sealNote(note, owner.publicKey);
    expect(openNote(blob, other.secretKey)).toBeNull();
  });

  test("recovered note reconstructs the on-chain commitment", () => {
    const f = seedToField(deriveSeed(SIG));
    const vk = deriveViewingKey(deriveSeed(SIG));
    const blob = sealNote(note, vk.publicKey);
    const rec = openNote(blob, vk.secretKey)!;
    const secret = deriveSecret(f, rec.index);
    const nonce = deriveNonce(f, rec.index, rec.version);
    // Same commitment the contract would hold for this position.
    const commitment = computeCommitment(
      BigInt(rec.collateralSats),
      BigInt(rec.debtStroops),
      secret,
      nonce,
    );
    expect(commitment).toBeGreaterThan(0n);
  });
});
