# ADR 0001: Contracts Remain Immutable - No Upgrade Mechanism

**Author:** Tyler (Architecture)
**Status:** Accepted (2026-08-18) - founder confirmed Option A (stay immutable) after review, citing DeFi trust norms as the deciding factor. The migration runbook named below is the follow-up this ADR requires before it's fully load-bearing at mainnet.

---

## Context

None of the four Writz contracts (`bitcoin-spv`, `commitment-tree`, `private-lend`, `zk-verifier`) implement `update_current_contract_wasm` or any other upgrade mechanism - confirmed by an exhaustive grep across `contracts/contracts/**/*.rs`. This was not a deliberate architectural choice documented anywhere; it's simply the state the contracts are in. That's the gap this ADR closes - not by changing the code, but by making the choice explicit and stating its consequences.

## The decision to make

**Option A - Stay immutable (recommended).** Once deployed, contract logic cannot change. Any bug fix, feature addition, or parameter-model change (e.g. swapping the interest rate curve) requires deploying a new contract and migrating state and dependent contract addresses.

**Option B - Add upgradeability.** Implement `update_current_contract_wasm`, gated by admin auth (the same single-key admin that already exists on three of the four contracts). Logic can change post-deployment without redeploying or migrating.

## Recommendation: Option A, with a written migration plan as the mitigation

This is Tyler's recommendation, not an executed decision - see Status above.

**Why immutability, not upgradeability, for this specific system:**

1. **An upgradeable contract is a bigger trust assumption than an immutable one holding a known bug.** Users depositing real BTC are trusting that the code they can read today is the code that runs tomorrow. `update_current_contract_wasm` gated by a single admin key (which is what three of the four contracts would have, absent the separate multisig work in Fase 2) means the admin key alone can rewrite the entire contract's logic - including, in the worst case, logic that moves user funds. That's strictly more powerful than any bug the current immutable contracts could contain, because a bug is bounded by what the deployed code can do; an upgrade key is not bounded at all.
2. **Boring technology.** Writz's contracts are simple enough (four contracts, clear responsibilities) that "redeploy and migrate" is a tractable, auditable process, not an unbounded one. That calculus changes if the contracts grow much more complex - revisit this ADR if that happens.
3. **It matches what's already true operationally.** The trusted-setup ceremony, the oracle integration, and the SCF/Audit Bank path are all still pending (see `docs/roadmap/phases.md`) - Writz is pre-mainnet. There is no user fund history to protect via in-place upgrades yet; a redeploy today costs nothing a real upgrade path would save.
4. **Matches DeFi norms on Stellar specifically.** Blend - Stellar's flagship lending protocol - is immutable with no upgrade mechanism at all; per their own FAQ, "the closest thing to an upgrade for Blend is an emissions fork," where the old deployment keeps running unchanged and a new one takes over emissions. That's the same shape of answer this ADR reaches (redeploy + migrate, old contract untouched), just solved one layer up (protocol-level fork vs. contract-level migration). Writz depositing real BTC under an admin-upgradeable contract would be a *weaker* trust posture than the protocol Writz is trying to match credibility with.

**What immutability costs, and how this ADR mitigates it:**

The real cost is operational, not security: a bug found post-mainnet requires a full migration, and migrations are where funds get stuck or lost if done carelessly. Immutability without a migration plan is not actually safer than upgradeability with a bad admin key - it just moves the risk from "a compromised key rewrites logic" to "an unplanned emergency migration loses funds." **This ADR is only sound if paired with a written migration runbook before mainnet**, covering:

- How to pause new deposits/borrows on the old contract - now solved: `Config.paused` + `set_paused` (admin-gated) exist on both lending contracts, checked in `deposit`/`borrow`/`supply_usdc` only, so exits stay open during a pause
- How existing open positions (collateral locked, debt owed) get represented in the new contract - a snapshot-and-replay of state, or a claim-based migration where users re-submit proof of their existing commitment against the old contract's still-readable (if not writable) state
- Who has authority to declare a migration necessary and execute it, and what the multisig/governance requirement is for that action specifically (this should be at least as strict as the admin multisig policy in Fase 2, arguably stricter, since a migration touches every user at once)

**This runbook now exists:** `docs/architecture/contract-migration-runbook.md`. It recommends a wind-down model (old contract keeps running for existing positions, new activity goes to the new contract) rather than a forced state transplant - partly because that's what Blend does, and partly because `commitment-tree`'s privacy model makes a forced bulk migration architecturally impossible for ZK positions regardless of preference. It surfaced two prerequisite gaps, both now closed: `private-lend`/`commitment-tree` have a `paused` flag (`set_paused`, admin-gated, blocks new deposits/borrows/supply while leaving repay/withdraw/liquidate open), and both contracts now emit `supply`/`withdraw` events so lenders can be enumerated the same way borrowers already could.

## What this ADR does not decide

It does not add a pause mechanism or write the migration runbook itself - those are the concrete follow-up work, tracked in `docs/roadmap/phases.md` as a Phase 2 exit criterion. Option A is now the accepted decision; revisit this ADR only if the contracts' complexity grows enough to change the calculus in point 2 above, not by default.
