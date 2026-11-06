# Contract Migration Runbook

**Author:** Tyler (Architecture)
**Status:** Written, not yet rehearsed - see the checklist at the end. This is the required follow-up to `docs/architecture/adr/0001-contract-immutability.md` (Accepted: contracts stay immutable). Immutability without this document is not actually safer than upgradeability with a weak key - it just moves the risk to an unplanned, panicked migration. This is the plan for it to be planned instead.

---

## The model this runbook uses: wind-down, not state transplant

There are two ways to think about "migrating" a contract: (a) forcibly move every position's state into a new contract in one operation, or (b) deploy the new contract for new activity, leave the old contract running exactly as-is for existing positions, and let it wind down naturally as users repay/withdraw/release. **This runbook recommends (b) as the default for every non-emergency migration**, for two independent reasons:

1. **It's what Blend does.** Per Blend's own FAQ: "the closest thing to an upgrade for Blend is an emissions fork - the old version of the protocol still functions as expected; it just stops receiving emissions." Same shape of answer, one layer up.

## Two tracks

### Track 1 - Planned migration (bug fix, feature, parameter change; no funds at risk on the old contract)

This is the common case: something needs to change that isn't security-critical on the currently-deployed contract.

1. Deploy the new contract version. Run the full test suite and a testnet soak period before mainnet deployment - same bar as the original launch.
2. **`bitcoin-spv` first, since it has no user state:**
   - `bitcoin-spv`: `initialize(admin)`, then `set_checkpoint` with a current checkpoint (see `contracts/scripts/check-checkpoint-age.sh` for how to check the old one's freshness before copying it forward - don't copy a stale checkpoint into a fresh deployment).
3. **Repoint the lending contracts' dependencies**, using the setters added alongside this runbook (`set_spv_contract`, `set_oracle`): if only `bitcoin-spv` changed, the lending contract themselves don't need to redeploy at all - just repoint them at the new dependency address. This is the case the Fase 1 setter work was specifically for.
4. **If `writz-lend` itself is what's changing:** deploy the new lending contract, point it at the (possibly unchanged) `bitcoin-spv`/oracle/USDC token addresses, and update the frontend/relayer configuration (`NEXT_PUBLIC_WRITZ_LEND_ID` and the relayer's `WRITZ_LEND_ID`) to send **new** deposits to the new contract. Do not attempt to move existing positions. They stay on the old contract, which keeps functioning:
   - Existing borrowers can still repay and get their BTC released (the co-signing backend's protocol Bitcoin key is not tied to any specific Soroban contract address - the P2WSH script only references the protocol's Bitcoin pubkey and the user's, never the Soroban contract - so releases keep working regardless of which Soroban contract is doing the accounting).
   - Existing lenders can still withdraw from the old contract's pool.
   - The relayer's event watcher needs to keep watching **both** contracts' `repay_full`/`liquidate` events during the wind-down period - this is a config change (watch two contract IDs), not new logic.
5. Communicate clearly (docs, in-app banner) that the old contract is in wind-down: still fully functional for exit, not accepting new deposits. Set an expectation for how long you'll keep supporting it (e.g., "old contract stays live indefinitely for existing users" is the safe default - there's no cost to leaving it running).

### Track 2 - Emergency migration (active exploit or critical bug with funds at risk on the currently-deployed contract)

This is harder, because "just let it wind down" isn't good enough when the old contract itself is the danger.

1. **Pause new risk-taking on the old contract.** `writz-lend` has a `Config.paused` flag, admin-gated via `set_paused(caller, paused)`, checked at the top of `deposit`/`borrow`/`supply_usdc`. `repay`/`withdraw_supply`/`liquidate`/BTC release never check it, so users can always exit during a pause. Call `set_paused(admin, true)` on the affected contract as the first containment step - it's the difference between "contain the incident in minutes" and "contain it whenever the next transaction happens to fail some other way."
2. **Get existing users' funds moving toward safety, using the exit paths that already exist, in priority order:**
   - Normal `repay` → `release` flow, if the vulnerability doesn't affect that path.
   - The CLTV timelock emergency path (Path B) - see `docs/how-it-works/manual-emergency-recovery.md`. This works entirely on the Bitcoin side and needs no cooperation from the Soroban contract at all, which is exactly what makes it the right fallback when you don't trust the contract's normal logic anymore. Its one limitation: it's only available once each position's individual timelock height has passed - it is not an instant exit for a freshly-deposited position.
3. **For `writz-lend` specifically**, if a genuine forced snapshot is ever justified (e.g. the normal repay path is what's broken, so users can't self-serve out): positions are enumerable. Scan `deposit` events (topic `deposit`) from contract genesis to collect every `txid` that ever deposited, then call `get_position(txid)` on each to read the current authoritative state directly (this is a state *read*, not a *reconstruction from event payloads* - the events alone are insufficient, see the gap noted below). A new contract could then be seeded with equivalent `Position` entries via a one-time admin-gated `import_position`-style function - **this function does not exist today; it would need to be written and reviewed at the time, not improvised under incident pressure.** Treat "we might need this" as a reason to sketch it in a calmer moment, not as something already available.

### A real prerequisite gap this runbook surfaces

`writz-lend` emits `supply`/`withdraw` events (topic on `supplier`, carrying `usdc_amount`, `scaled_amount`, `supply_index` and the resulting `total_supply_assets`). Lenders can be enumerated the same way borrowers are: scan `supply` events from genesis, then confirm current balance with `get_supply_balance(lender)` for each address found (the event tells you *who*, the getter tells you *how much right now* - the same two-step pattern as `writz-lend` positions above).

## Governance: who can declare and execute a migration

Matches the multisig policy from `docs/security/security-model.md` (all four contract admins on 2-of-3+ multisig) - arguably stricter here, since a migration decision affects every user at once, not just one contract's parameters. Recommend: the same multisig that governs each contract's admin key must jointly approve (a) declaring an emergency (Track 2) vs. planned (Track 1) migration, and (b) the specific new contract address(es) being pointed to, before the frontend/relayer configuration changes. Nobody should be able to unilaterally redirect where user deposits go.

## Communication checklist (either track)

- Old contract address(es), clearly labeled "wind-down - do not deposit," linked from the app.
- New contract address(es), with a note on what changed and why.
- Explicit statement of what still works on the old contract (repay, release, withdraw) and for how long you're committing to keep it operational.
- For Track 2 specifically: what happened, in plain language, before speculation fills the gap.

---

## Rehearsal checklist (do this before trusting this runbook)

- [ ] Run a full Track 1 migration on testnet: deploy a second `writz-lend` instance, repoint a test deposit's dependent config, confirm the old instance still lets a test position repay and release BTC end-to-end while pointed at "wind-down."
- [ ] Confirm the `deposit`-event-scan-then-`get_position` methodology actually reconstructs a correct `Position` for a handful of testnet positions - this is described here, not yet executed.
- [ ] Rehearse `set_paused` on testnet: confirm `deposit`/`borrow`/`supply_usdc` all reject while paused, and `repay`/`withdraw_supply`/`liquidate` all still succeed. Tested at the unit level (`test::*_while_paused_*` in both contracts' `test.rs`) - this checklist item is about confirming the same behavior end-to-end against a live deployment, not re-proving the logic.
- [ ] Decide, before an incident, whether the `import_position` admin function (for Track 2 forced-migration on `writz-lend`) is worth building now, calmly, rather than during a live incident. This runbook takes no position on urgency - that's a product/risk-tolerance call, not an architecture one. `paused` and the `supply`/`withdraw` events are already done; this is the one item from the original list still open.
- [ ] Assign an owner for keeping this document current as the contracts evolve - a migration runbook that drifts from the real getters/events is worse than no runbook, because it creates false confidence.
