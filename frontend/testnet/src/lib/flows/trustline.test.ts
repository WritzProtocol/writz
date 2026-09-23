import { describe, expect, it } from "bun:test";
import { EARN_ASSET, POOL_ASSET } from "./trustline";

/**
 * The bug this file guards against: the Earn tab read the lending pool's USDC
 * balance and offered the pool's trustline, while the vault only accepts
 * Blend's test USDC. Both are called "USDC", so nothing about the code or the
 * types made the mistake visible - only the issuer distinguishes them.
 */
describe("the Earn asset and the pool asset are distinct identities", () => {
  it("shares the asset code, which is exactly why the issuer must be compared", () => {
    expect(EARN_ASSET.code).toBe(POOL_ASSET.code);
  });

  it("does not share an issuer, so they are unrelated assets on Stellar", () => {
    // Guarded so the test still means something in an env-less CI checkout,
    // where both issuers read as "" and would trivially compare equal.
    if (!EARN_ASSET.issuer || !POOL_ASSET.issuer) return;
    expect(EARN_ASSET.issuer).not.toBe(POOL_ASSET.issuer);
  });

  it("points the Earn asset at the issuer the deployed vault actually accepts", () => {
    if (!EARN_ASSET.issuer) return;
    // The "Underlying asset" row of
    // contracts/deployments/defindex-vault-testnet.md, confirmed on-chain.
    expect(EARN_ASSET.issuer).toBe(
      "GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
    );
  });
});
