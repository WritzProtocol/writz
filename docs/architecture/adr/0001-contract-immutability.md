# ADR 0001: Contracts Remain Immutable - No Upgrade Mechanism

**Status:** Accepted (2026-08-18): Option A, stay immutable, with DeFi trust norms as the deciding factor. The [migration runbook](/architecture/contract-migration-runbook) is the follow-up this ADR requires before mainnet.

---

## Context

Neither Writz contract (`bitcoin-spv`, `writz-lend`) calls `update_current_contract_wasm` or has any other upgrade mechanism; a search of `contracts/contracts/**/*.rs` finds none. Before this ADR that was the state of the code rather than a documented choice. This ADR makes the choice explicit and states its consequences, without changing the code.

## The decision to make

**Option A - Stay immutable (recommended).** Once deployed, contract logic cannot change. Any bug fix, feature addition, or parameter-model change (e.g. swapping the interest rate curve) requires deploying a new contract and migrating state and dependent contract addresses.

**Option B - Add upgradeability.** Implement `update_current_contract_wasm`, gated by admin auth (the same single-key admin that both contracts already have). Logic can change post-deployment without redeploying or migrating.

## Recommendation: Option A, with a written migration plan as the mitigation

**Why immutability, not upgradeability, for this specific system:**

1. **An upgradeable contract is a bigger trust assumption than an immutable one holding a known bug.** Users depositing real BTC are trusting that the code they can read today is the code that runs tomorrow. `update_current_contract_wasm` gated by a single admin key (which is what both contracts would have until the admin account becomes a multisig) means the admin key alone can rewrite the entire contract's logic - including, in the worst case, logic that moves user funds. That's strictly more powerful than any bug the current immutable contracts could contain, because a bug is bounded by what the deployed code can do; an upgrade key is not bounded at all.
2. **Boring technology.** Writz's contracts are simple enough (two contracts, clear responsibilities) that "redeploy and migrate" is a tractable, auditable process, not an unbounded one. That calculus changes if the contracts grow much more complex - revisit this ADR if that happens.
3. **It matches what's already true operationally.** Writz is pre-mainnet and the audit is still pending. There is no user fund history to protect via in-place upgrades yet; a redeploy today costs nothing a real upgrade path would save.
4. **Matches DeFi norms on Stellar specifically.** Blend - Stellar's flagship lending protocol - is immutable with no upgrade mechanism at all; per their own FAQ, "the closest thing to an upgrade for Blend is an emissions fork," where the old deployment keeps running unchanged and a new one takes over emissions. That's the same shape of answer this ADR reaches (redeploy + migrate, old contract untouched), just solved one layer up (protocol-level fork vs. contract-level migration). Writz depositing real BTC under an admin-upgradeable contract would be a *weaker* trust posture than the protocol Writz is trying to match credibility with.

**What immutability costs, and how this ADR mitigates it:**

The real cost is operational, not security: a bug found post-mainnet requires a full migration, and migrations are where funds get stuck or lost if done carelessly. Immutability without a migration plan is not actually safer than upgradeability with a bad admin key - it just moves the risk from "a compromised key rewrites logic" to "an unplanned emergency migration loses funds." **This ADR is only sound if paired with a written migration runbook before mainnet**, covering:

- How to pause new deposits/borrows on the old contract - now solved: `Config.paused` + `set_paused` (admin-gated) exist on `writz-lend`, checked in `deposit`/`borrow`/`supply_usdc` only, so exits stay open during a pause
- How existing open positions (collateral locked, debt owed) get represented in the new contract - a snapshot-and-replay of state, or a claim-based migration where users re-submit proof of their existing deposit against the old contract's still-readable (if not writable) state
- Who has authority to declare a migration necessary and execute it, and what the multisig/governance requirement is for that action specifically (this should be at least as strict as the planned admin multisig policy, arguably stricter, since a migration touches every user at once)

**This runbook now exists:** [Contract migration runbook](/architecture/contract-migration-runbook). It recommends a wind-down model (old contract keeps running for existing positions, new activity goes to the new contract) rather than a forced state transplant, which is what Blend does. It surfaced two prerequisite gaps, both now closed: `writz-lend` has a `paused` flag (`set_paused`, admin-gated, blocks new deposits, borrows and supply while leaving repay, withdraw and liquidate open), and `writz-lend` emits `supply` and `withdraw` events so lenders can be enumerated the same way borrowers already could.

## What this ADR does not decide

It does not itself add the pause mechanism or the migration runbook; both were follow-up work and both now exist. The runbook still has to be rehearsed before mainnet. Revisit this ADR only if the contracts' complexity grows enough to change the calculus in point 2 above, not by default.
