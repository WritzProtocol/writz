# STRIDE Threat Model - Writz Protocol

**Version:** 0.1 (Draft)
**Date:** June 2026
**Scope:** Phase 1 architecture (SPV contract + Writz Lend + P2WSH locking script + relayer)
**Methodology:** Microsoft STRIDE (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)

---

## System components in scope

| Component | Type | Trust level |
|---|---|---|
| Bitcoin P2WSH locking script | Bitcoin on-chain | Trustless - Bitcoin consensus |
| `bitcoin-spv` Soroban contract | Stellar on-chain | Trustless - Soroban VM |
| `writz-lend` Soroban contract | Stellar on-chain | Trustless - Soroban VM |
| Writz SPV relayer | Off-chain service | Untrusted - convenience only |
| Pyth / Reflector oracle | Off-chain + on-chain | Partially trusted |
| Protocol co-signing key (HSM) | Off-chain | Trusted - Writz operator |
| Liquidation keeper | Off-chain | Trusted - Phase 1 |
| User Bitcoin wallet (Xverse) | Client-side | Untrusted |
| User Stellar wallet (Freighter) | Client-side | Untrusted |

---

## Data flow diagram

```
[User Bitcoin Wallet]
        │
        │ BTC → P2WSH address (on Bitcoin)
        ▼
[Bitcoin Network] ──────────────────────────────────────────────
        │
        │ block headers + Merkle proof (via relayer or self-serve)
        ▼
[SPV Relayer] ─────────────────────────────────────────────── UNTRUSTED
        │
        │ headers + proof + raw_tx (user submits directly to Soroban)
        ▼
[bitcoin-spv contract] ─────────────────────────────────────── TRUSTLESS
        │
        │ SpvVerificationResult { txid, block_hash, confirmations }
        ▼
[writz-lend contract] ────────────────────────────────────── TRUSTLESS
        │         │         │
        │         │         │ BTC/USD price feed (SEP-40)
        │         │         ▼
        │         │    [Pyth / Reflector Oracle] ─────────────────── PARTIALLY TRUSTED
        │         │
        │    USDC transfer (Stellar Asset Contract)
        ▼         ▼
[User Stellar Wallet]     [Protocol Treasury / USDC Pool]

[Protocol Co-signing Key (HSM)] ─── co-signs P2WSH release on Bitcoin
[Liquidation Keeper] ─────────── calls liquidate() on Writz Lend
```

---

## Threat analysis - STRIDE

### S - Spoofing (impersonating a legitimate entity)

#### S1: Attacker submits a fabricated SPV proof
**Threat:** An attacker constructs a fake SPV proof for a Bitcoin transaction that was never mined (or was mined with fewer confirmations than required) and submits it to the SPV contract.

**Mitigation:**
- The SPV contract validates the full header chain: each header's `prev_block_hash` must equal SHA256d of the previous header. Fabricating a 6-deep valid chain requires solving 6 Bitcoin proof-of-work puzzles - infeasible at current difficulty.
- The Merkle proof must correctly connect the transaction to the Merkle root embedded in the block header. Forging a valid Merkle proof without the actual transaction requires a SHA256 preimage attack - computationally infeasible.
- The raw transaction bytes are parsed on-chain; the txid is recomputed as SHA256d(raw_tx) and verified against the Merkle proof.

**Residual risk:** LOW - the entire security model is backed by Bitcoin's proof-of-work consensus.

#### S2: Attacker impersonates the Writz protocol co-signing key
**Threat:** An attacker obtains the protocol private key and co-signs a fraudulent P2WSH release, draining all BTC collateral.

**Mitigation (Phase 1):** Protocol key stored in cloud HSM (AWS CloudHSM or equivalent). Key never leaves HSM in plaintext. Signing requires authenticated access.

**Mitigation (Phase 2):** Migrate to MPC (multi-party computation): 2-of-3 or 3-of-5 threshold ECDSA. No single party holds the complete key.

**Residual risk:** MEDIUM in Phase 1 (HSM compromise is the primary attack vector on the protocol's Bitcoin-side custody). Mitigated to LOW in Phase 2 with MPC.

#### S3: Oracle price spoofing
**Threat:** An attacker manipulates the BTC/USD price fed to Writz Lend to artificially trigger liquidations or allow over-borrowing.

**Mitigation:**
- Pyth uses off-chain institutional price aggregation (30–60 publishers per feed). Cannot be manipulated by on-chain flash loans.
- Phase 2 adds a second oracle (Reflector's external-prices instance) and takes the median - requires compromising both simultaneously. (Corrected 2026-09-16, on-chain verified: RedStone dropped as primary - Stellar isn't in its supported-chain list. DIA parked - its documented testnet contract address returns "contract not found" when queried directly. See `docs/research/oracle-design.md`.)
- TWAP (time-weighted average price) delays as additional manipulation resistance considered for Phase 2.

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
- The timelock is set at loan origination block + loan duration + 7-day safety buffer - if the worst happens, the user is never permanently locked out.

**Residual risk:** LOW - the timelock is the cryptographic guarantee that eliminates protocol repudiation risk.

#### R2: Keeper denies initiating a liquidation
**Threat:** The keeper claims to have initiated a liquidation that didn't occur, or denies initiating one that did.

**Mitigation:** The `liquidate()` call and its result are recorded on Stellar's ledger. The `liquidate` event includes the keeper's address, the position txid, and the debt amount. All on-chain, all immutable.

**Residual risk:** NONE for on-chain record. Note: `writz-lend` uses a designated keeper, so keeper reliability is a concern - mitigated by the stale-keeper fallback: after 24 hours with no keeper liquidation or heartbeat, any caller may liquidate an undercollateralized position.

---

### I - Information Disclosure (unauthorized access to private data)

#### I1: On-chain position amounts are public
**Threat:** `writz-lend` positions are plaintext: position amounts, debt sizes, health ratios, the depositor's Stellar address and the Bitcoin deposit are visible on-chain. This exposes users to front-running and competitive analysis, as in any public lending market.

**Mitigation:** None in v1, by design. Writz v1 has no privacy layer, and this is disclosed in the user documentation. Privacy is being designed as a separate, opt-in edition with its own contracts, pool, audit and trusted-setup ceremony (see `docs/how-it-works/privacy-edition.md`); it is in progress, testnet only, not on the v1 mainnet plan and has no date.

**Residual risk:** HIGH for users who need confidential positions; accepted for v1.

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
- The `repay()` function updates internal state (debt, status) before calling `token.transfer()` - a checks-effects-interactions pattern.

**Residual risk:** VERY LOW - Soroban's execution model makes traditional reentrancy much harder than EVM.

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
| S1: Fake SPV proof | Critical | Bitcoin PoW | NONE |
| S2: Protocol key compromise | Critical | HSM (P1) → MPC (P2) | MEDIUM (P1), LOW (P2) |
| S3: Oracle price manipulation | High | Multi-publisher, median (P2) | LOW |
| T1: P2WSH script tampering | Critical | SHA256 commitment | NONE |
| T2: Storage tampering | Critical | Soroban VM isolation | NONE |
| T3: Proof data in transit | Medium | User self-service | LOW |
| R1: Protocol repudiation | High | CLTV timelock backstop | LOW |
| R2: Keeper repudiation | Low | On-chain immutability | NONE |
| I1: Public position amounts | High | None in v1 (by design); separate privacy edition in progress | HIGH (accepted for v1) |
| I2: Relayer data collection | Medium | Self-service available | MEDIUM (P1), LOW (P2) |
| D1: Relayer DoS | Low | Stateless SPV redundancy | LOW |
| D2: Compute spam | Low | Soroban fee model | LOW |
| D3: Key unavailability | High | CLTV timelock backstop | LOW (users), HIGH (ops) |
| E1: False liquidation | High | On-chain check + keeper ACL | LOW |
| E2: Reentrancy | High | Soroban model + CEI pattern | VERY LOW |
| E3: Integer overflow | High | i128 + saturating + overflow-checks | LOW |

---

## Security priorities for audit

The external audit before mainnet should focus on, in priority order:

1. **SPV verification correctness** - is the SHA256d implementation correct? Does header chain validation correctly prevent header substitution attacks?
2. **Interest rate model overflow** - are there edge cases in the kinked rate formula that could cause incorrect interest calculation at extreme values?
3. **Cross-contract call trust** - can a malicious contract be registered as the SPV contract to bypass deposit verification?
4. **Protocol key security** - HSM configuration, signing policy, and key recovery procedures
5. **ZK circuit soundness** - not part of v1; the privacy edition's circuits get their own audit before that edition launches

---

*Last updated: June 2026 - v0.1 draft. Full revision planned for a future Tranche #1 submission, which is not currently scheduled.*
