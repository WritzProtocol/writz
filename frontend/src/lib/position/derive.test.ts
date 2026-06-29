import { describe, expect, test } from "bun:test";
import {
  KEY_DERIVATION_MESSAGE,
  deriveMasterSeed,
  deriveNonce,
  deriveSecret,
  deriveViewingKey,
} from "./derive";
import { FIELD_PRIME, computeCommitment } from "./crypto";

// A real SEP-53 signature (base64) produced by Freighter's signMessage for the
// "HELLO" message — used as a stable, deterministic input.
const SIG =
  "sYB+OzWZL66TGqdHo07CkP6m2NDThg7TbRkuSB//HBw3cq98U/qlqJTyjz52ZqaSbfVBEE/p1bHSEobSblCOAg==";

describe("key derivation (#18 Layer 1)", () => {
  test("master seed is deterministic for the same signature", async () => {
    expect(await deriveMasterSeed(SIG)).toBe(await deriveMasterSeed(SIG));
  });

  test("different signatures yield different seeds", async () => {
    const other = "AAAA" + SIG.slice(4);
    expect(await deriveMasterSeed(SIG)).not.toBe(await deriveMasterSeed(other));
  });

  test("all derived values are valid BN254 field elements", async () => {
    const seed = await deriveMasterSeed(SIG);
    const values = [
      seed,
      deriveSecret(seed, 0),
      deriveNonce(seed, 0, 0),
      deriveViewingKey(seed),
    ];
    for (const v of values) {
      expect(v).toBeGreaterThan(0n);
      expect(v).toBeLessThan(FIELD_PRIME);
    }
  });

  test("secret is stable per index; nonce rotates per index and version", async () => {
    const seed = await deriveMasterSeed(SIG);
    expect(deriveSecret(seed, 0)).toBe(deriveSecret(seed, 0));
    expect(deriveSecret(seed, 0)).not.toBe(deriveSecret(seed, 1));
    expect(deriveNonce(seed, 0, 0)).not.toBe(deriveNonce(seed, 0, 1));
    expect(deriveNonce(seed, 0, 0)).not.toBe(deriveNonce(seed, 1, 0));
  });

  test("re-deriving reconstructs the identical commitment (cross-device recovery)", async () => {
    const make = async () => {
      const seed = await deriveMasterSeed(SIG);
      return computeCommitment(1_000_000n, 0n, deriveSecret(seed, 0), deriveNonce(seed, 0, 0));
    };
    expect(await make()).toBe(await make());
  });

  test("the canonical message is fixed (guards accidental edits)", () => {
    expect(KEY_DERIVATION_MESSAGE.startsWith("Writz — position keys")).toBe(true);
    expect(KEY_DERIVATION_MESSAGE).toContain("Version: 1");
  });
});
