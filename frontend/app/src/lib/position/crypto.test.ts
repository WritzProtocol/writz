import { describe, expect, it } from "bun:test";
import { computeCommitment, computeNullifier, randomEphemeralScalar } from "./crypto";

/**
 * The deposit fixture of `circuits/scripts/gen_commitment_tree_test_vectors.js`
 * (commitment-tree's integration vectors): the circuit's commitment and
 * nullifier for that witness. If the app hashed a position any other way, no
 * proof it built would ever verify on-chain (#212).
 */
const FIXTURE = {
  collateral: 1_000_000n,
  secret: 0x5566778811223344n,
  nonce: 0x1111111111111111n,
  timelock: 2_950_000,
  commitment: 0x1dce82aabe45c8b7dcae5017abf8696a713c31ef28e2efa2f021bb571d1df116n,
  nullifier: 0x229904c60cf3c4a86b9f091026cf9d96a959ec6dab65aeca687d3a41c0502bcfn,
};

describe("position crypto", () => {
  it("matches the deposit circuit's commitment and nullifier", () => {
    const { collateral, secret, nonce, timelock } = FIXTURE;
    expect(computeCommitment(collateral, 0n, secret, nonce, timelock)).toBe(FIXTURE.commitment);
    expect(computeNullifier(secret, nonce)).toBe(FIXTURE.nullifier);
  });

  it("binds the timelock into the commitment", () => {
    const { collateral, secret, nonce, timelock } = FIXTURE;
    expect(computeCommitment(collateral, 0n, secret, nonce, timelock + 1)).not.toBe(FIXTURE.commitment);
  });

  it("draws ephemeral scalars the circuit's 253-bit decomposition accepts", () => {
    for (let i = 0; i < 32; i++) {
      const k = randomEphemeralScalar();
      expect(k > 0n && k < 1n << 248n).toBe(true);
    }
  });
});
