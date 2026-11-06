# STRIDE Threat Model - Writz Protocol

**Version:** 0.2 (Draft)
**Date:** November 2026
**Scope:** the testnet architecture today (SPV contract + Writz Lend + P2WSH locking script + relayer)
**Methodology:** Microsoft STRIDE (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)

---

## System components in scope

| Component | Type | Trust level |
|---|---|---|
| Bitcoin P2WSH locking script | Bitcoin on-chain | Trustless - Bitcoin consensus |
| `bitcoin-spv` Soroban contract | Stellar on-chain | Trustless - Soroban VM |
| `writz-lend` Soroban contract | Stellar on-chain | Trustless - Soroban VM |
| Writz SPV relayer | Off-chain service | Untrusted for proofs (the contracts check them). On testnet trusted for header validity, as the only submitter on signet, and for liveness of releases |
| Reflector oracle (a second source planned) | Off-chain + on-chain | Partially trusted |
| Protocol co-signing key | Off-chain | Trusted - Writz operator |
| Liquidation keeper | Off-chain | Trusted - a designated keeper today; anyone may liquidate once it is stale (24 h) |
| User Bitcoin wallet (Xverse) | Client-side | Untrusted |
| User Stellar wallet (Stellar Wallets Kit, Pollar sign-in) | Client-side | Untrusted |

---

## Data flow diagram

<img className="block dark:hidden" src="/diagrams/data-flow.svg" alt="Data flow and trust boundaries: untrusted wallets, a relayer trusted on testnet, trustless vault and contracts, trusted protocol key and keeper, partially trusted oracle" />
<img className="hidden dark:block" src="/diagrams/data-flow-dark.svg" alt="Data flow and trust boundaries: untrusted wallets, a relayer trusted on testnet, trustless vault and contracts, trusted protocol key and keeper, partially trusted oracle" />

---

## Threat analysis - STRIDE

### S - Spoofing (impersonating a legitimate entity)

#### S1: Attacker submits a fabricated SPV proof
**Threat:** An attacker constructs a fake SPV proof for a Bitcoin transaction that was never mined (or was mined with fewer confirmations than required) and submits it to the SPV contract.

**Mitigation:**
- A proof is checked against headers the SPV contract already stored. Each stored header must link to a stored parent and carry valid proof of work at the exact difficulty Bitcoin requires. Fabricating a 6-deep valid mainnet chain requires solving 6 Bitcoin proof-of-work puzzles - infeasible at current difficulty.
- The Merkle proof must correctly connect the transaction to the Merkle root embedded in the block header. Forging a valid Merkle proof without the actual transaction requires a SHA256 preimage attack - computationally infeasible.
- The raw transaction bytes are parsed on-chain; the txid is recomputed as SHA256d(raw_tx) and verified against the Merkle proof.

**Residual risk:** LOW on mainnet, where the model is backed by Bitcoin's proof-of-work consensus. On signet (testnet) proof of work is cheap and block signatures are not checked, so header validity rests on the designated submitter.

#### S2: Attacker impersonates the Writz protocol co-signing key
**Threat:** An attacker obtains the protocol private key and co-signs a fraudulent P2WSH release, draining all BTC collateral.

**Mitigation (today):** The protocol key alone cannot move Bitcoin: the cooperative path also requires the user's signature, so a stolen protocol key cannot drain collateral, and the user's time-lock exit (Path B) never needs it. What it can do is refuse or delay releases, or co-sign an early release for a borrower who holds or colludes with it, letting that borrower take the BTC back while the debt stays open.

**Mitigation (planned):** A 2-of-3 protocol side written into the P2WSH script, three keys held separately, so Bitcoin enforces the threshold natively and no single key can co-sign a release. Threshold ECDSA (MPC) is not planned. The signing policy, what the protocol signers can and cannot sign, will be published.

**Residual risk:** MEDIUM with a single protocol key; LOW once the 2-of-3 protocol side ships.

#### S3: Oracle price spoofing
**Threat:** An attacker manipulates the BTC/USD price fed to Writz Lend to artificially trigger liquidations or allow over-borrowing.

**Mitigation:**
- `writz-lend` reads Reflector's external-prices SEP-40 feed (CEX and DEX aggregation), which an on-chain flash loan cannot move. A price older than one hour is rejected, so a stale or unavailable feed blocks price-dependent calls rather than mispricing them.
- Planned: a second source (RedStone's BTC/USD push feed on Stellar) with a divergence guard, so a single bad feed is caught by the other.

**Residual risk:** LOW for retail manipulation. Theoretical risk from compromised institutional publishers - mitigated by publisher diversity.

---

### T - Tampering (unauthorized data modification)

#### T1: Attacker tampers with the P2WSH redeem script
**Threat:** An attacker modifies the redeem script after the P2WSH address is generated to change the spending conditions.

**Mitigation:** The P2WSH address commits to the SHA256 hash of the redeem script. The script is revealed only at spend time, and Bitcoin verifies `SHA256(revealed_script) == address_hash`. Any modification to the script changes the hash and invalidates the address.

**Residual risk:** NONE - Bitcoin's P2WSH construction is cryptographically binding.

#### T2: Attacker tampers with the Soroban contract state
**Threat:** An attacker modifies position data (debt amount, satoshi amount, status) directly in contract storage.

**Mitigation:** Soroban's execution model guarantees that contract storage can only be modified by the contract itself within its own execution context. The VM provides full isolation.

**Residual risk:** NONE - Soroban VM isolation is a fundamental security property.

#### T3: Attacker modifies the SPV proof data in transit
**Threat:** A man-in-the-middle attacker modifies the block headers or Merkle proof between the relayer and the user's submission to the Soroban contract.

**Mitigation:** The user submits the proof directly to the Soroban contract (the relayer is a data source, not an intermediary). The contract cryptographically validates all provided data. Even if the relayer provides modified data, the contract will reject it. Users can self-serve from any public Bitcoin data source.

**Residual risk:** LOW - the user can always bypass the relayer entirely.

---

### R - Repudiation (denying having performed an action)

#### R1: Protocol denies co-signing a BTC release
**Threat:** A user repays their USDC loan but the protocol denies the repayment occurred and refuses to co-sign the P2WSH release.

**Mitigation:**
- Repayment is recorded on the Stellar blockchain - fully public and immutable. The `repay_full` event is emitted at repayment time with the P2WSH scriptPubKey.
- The user's CLTV timelock provides a backstop: if the protocol refuses to co-sign, the user waits for the timelock to expire and recovers their BTC unilaterally.
- The app sets the timelock about one year after the deposit (the contract accepts 1,008 to 105,000 blocks above the confirming block) - if the worst happens, the user is never permanently locked out.

**Residual risk:** LOW - the timelock is the cryptographic guarantee that eliminates protocol repudiation risk.

#### R2: Keeper denies initiating a liquidation
**Threat:** The keeper claims to have initiated a liquidation that didn't occur, or denies initiating one that did.

**Mitigation:** The `liquidate()` call and its result are recorded on Stellar's ledger. The `liquidate` event includes the position txid, the keeper's address and the bonus paid. All on-chain, all immutable.

**Residual risk:** NONE for on-chain record. Note: `writz-lend` uses a designated keeper, so keeper reliability is a concern - mitigated by the stale-keeper fallback: after 24 hours with no keeper liquidation or heartbeat, any caller may liquidate an undercollateralized position.

---

### I - Information Disclosure (unauthorized access to private data)

#### I1: On-chain position amounts are public
**Threat:** `writz-lend` positions are plaintext: position amounts, debt sizes, health ratios, the depositor's Stellar address and the Bitcoin deposit are visible on-chain. This exposes users to front-running and competitive analysis, as in any public lending market.

**Mitigation:** None in v1, by design. Writz v1 has no privacy layer, and this is disclosed in the user documentation.

**Residual risk:** HIGH for users who need confidential positions; accepted for v1.

#### I2: The relayer learns which deposits a user is proving
**Threat:** The relayer sees the IP address and txid of each proof request, linking a network identity to a Bitcoin deposit.

**Mitigation:** A user can build the proof from any Esplora instance or their own node ([Manual Proof Submission](/how-it-works/manual-proof-submission)). The link it reveals is already public on chain once the deposit is registered.

**Residual risk:** MEDIUM.

---

### D - Denial of Service

#### D1: The relayer stops
**Threat:** No new headers reach `bitcoin-spv`, no proofs are served and no releases are published.

**Mitigation:** Borrows and liquidations fail closed once the light client's tip header is older than six hours, so no loan is measured against a stale tip. Proofs can be built from any Esplora instance, and a published release stays readable on `writz-lend`. The user's time-lock exit needs no relayer. Planned: permissionless submission and redundant relayers on mainnet.

**Residual risk:** LOW for funds; liveness depends on the relayer until redundant relayers exist.

#### D2: Compute spam
**Threat:** An attacker floods the contracts with calls.

**Mitigation:** Every Soroban call pays fees, and `submit_headers` accepts at most 16 headers per call. The relayer's proof endpoint is rate limited.

**Residual risk:** LOW.

#### D3: The protocol key becomes unavailable
**Threat:** The protocol key is lost or its holder stops signing, so no cooperative release can be produced.

**Mitigation:** Each user recovers their BTC through the time-lock path after H. Planned: a 2-of-3 protocol side, so one lost key does not stop releases.

**Residual risk:** LOW for users' BTC, HIGH for operations (every release waits until H).

---

### E - Elevation of Privilege

#### E1: Attacker triggers liquidation on a healthy position
**Threat:** An attacker calls `liquidate()` on a position that is actually healthy, clearing the owner's position against their will.

**Mitigation:**
- `liquidate()` performs an on-chain collateral ratio check before proceeding: `health_ratio = collateral_value / debt`. If health ≥ liquidation threshold (120%), the call reverts with `PositionHealthy`.
- Only the authorized keeper address can call `liquidate()` while the keeper is active. After 24 hours of keeper inactivity anyone may call it, but the on-chain ratio check above still applies to every caller.
- `liquidate()` never moves BTC: the liquidator pays the USDC debt and receives a USDC bonus from the reserve.

**Residual risk:** LOW (on-chain ratio check, keeper access control while active). The oracle price remains the main input to watch (S3).

#### E2: Attacker uses an undisclosed reentrancy exploit to drain the USDC pool
**Threat:** A malicious USDC token contract or cross-contract call enables reentrancy, allowing multiple withdrawals from a single repayment.

**Mitigation:**
- Soroban does not support EVM-style reentrancy: all contract calls are sequential within a transaction and state changes are applied atomically.
- The Soroban host rejects re-entry into a contract that is already on the call stack.
- The token is the USDC Stellar Asset Contract fixed at deployment, which does not call back into the caller. `repay()` pulls the USDC in before it writes the position, so it relies on these two properties rather than on a checks-effects-interactions order.

**Residual risk:** VERY LOW.

#### E3: Attacker exploits integer overflow in the interest rate model
**Threat:** An attacker crafts a deposit or borrow scenario that causes integer overflow in the kinked interest rate calculation or the collateral ratio check.

**Mitigation:**
- All financial math uses Rust's `i128` (128-bit signed integer), providing sufficient range for all realistic BTC and USDC amounts.
- `saturating_mul` and `saturating_add` are used throughout the rate model - overflow silently caps rather than wrapping.
- The Soroban compilation profile has `overflow-checks = true` in release mode - integer overflow panics rather than wrapping.
- Unit tests cover the rate model at boundary values (U=0%, U=75%, U=100%, U>100%).

**Residual risk:** LOW - tested at boundaries, saturating arithmetic, and compiler overflow checks.

---

## Residual risk summary

| Threat | Severity | Mitigation state | Residual |
|---|---|---|---|
| S1: Fake SPV proof | Critical | Bitcoin PoW; trusted submitter on signet | LOW |
| S2: Protocol key compromise | Critical | User key required on every path; 2-of-3 protocol side planned | MEDIUM (single key), LOW (2-of-3) |
| S3: Oracle price manipulation | High | Reflector with staleness check; second source with deviation guard planned | LOW |
| T1: P2WSH script tampering | Critical | SHA256 commitment | NONE |
| T2: Storage tampering | Critical | Soroban VM isolation | NONE |
| T3: Proof data in transit | Medium | User self-service | LOW |
| R1: Protocol repudiation | High | CLTV timelock backstop | LOW |
| R2: Keeper repudiation | Low | On-chain immutability | NONE |
| I1: Public position amounts | High | None in v1 (by design) | HIGH (accepted for v1) |
| I2: Relayer data collection | Medium | Self-service available | MEDIUM |
| D1: Relayer DoS | Low | Tip freshness rule live (borrows and liquidations fail on a tip older than six hours); redundant relayers planned; the user's time-lock exit is unaffected | LOW |
| D2: Compute spam | Low | Soroban fee model | LOW |
| D3: Key unavailability | High | CLTV timelock backstop | LOW (users), HIGH (ops) |
| E1: False liquidation | High | On-chain check + keeper ACL | LOW |
| E2: Reentrancy | High | Soroban host re-entry guard, fixed USDC SAC | VERY LOW |
| E3: Integer overflow | High | i128 + saturating + overflow-checks | LOW |

---

## Security priorities for audit

The external audit before mainnet should focus on, in priority order:

1. **SPV verification correctness** - do header validation, difficulty retargeting, chainwork and reorg handling match Bitcoin's rules? Does the Merkle check prevent substitution attacks?
2. **Interest rate model overflow** - are there edge cases in the kinked rate formula that could cause incorrect interest calculation at extreme values?
3. **Cross-contract call trust** - what can an admin-set address (`set_spv_contract`, `set_oracle`) do if it points at a malicious contract?
4. **Protocol key security** - the 2-of-3 protocol signers, their published signing policy, and key recovery procedures

---

*Last updated: November 2026 - v0.2 draft. Full revision planned before the external audit.*
