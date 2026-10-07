import { describe, expect, it } from "bun:test";
import { createHash } from "crypto";
import { recipientLoHi } from "./crypto";

describe("recipientLoHi", () => {
  const strkey = "CAIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRDB3V";

  it("splits sha256(strkey) into 128-bit halves, matching the contract's recomputation", async () => {
    const digest = createHash("sha256").update(strkey, "ascii").digest();
    const { lo, hi } = await recipientLoHi(strkey);
    expect(BigInt(hi)).toBe(BigInt("0x" + digest.subarray(0, 16).toString("hex")));
    expect(BigInt(lo)).toBe(BigInt("0x" + digest.subarray(16, 32).toString("hex")));
  });

  it("matches the fixture the commitment-tree contract tests bind to", async () => {
    // Same address as BORROW_RECIPIENT in commitment-tree/src/test.rs; the proof
    // vectors there carry these exact halves.
    const { lo, hi } = await recipientLoHi(strkey);
    expect(hi).toBe("147403669137390075720114308694896654163");
    expect(lo).toBe("70241141853438903396562468743115965161");
  });

  it("gives different halves for different addresses", async () => {
    const other = await recipientLoHi("GBZ36IZMIQHXQ467FCUGGIG4L7ZD4JY7EQ5THUT44PFYMWVA374DAVTV");
    const base = await recipientLoHi(strkey);
    expect(other).not.toEqual(base);
  });

  it("keeps both halves inside the BN254 field (128-bit values)", async () => {
    const { lo, hi } = await recipientLoHi(strkey);
    expect(BigInt(lo) < 2n ** 128n).toBe(true);
    expect(BigInt(hi) < 2n ** 128n).toBe(true);
  });
});
