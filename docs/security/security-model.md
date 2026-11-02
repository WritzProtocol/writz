---
title: "Security Model"
---

**What Writz protects, what it cannot protect, and what happens when things go wrong.**

No protocol is risk-free. This page explains Writz's security model honestly: what the system protects, what the trust assumptions are, and what happens in every relevant failure scenario.

---

## Security Properties

Writz v1 (Writz Lend on `bitcoin-spv` and `writz-lend`) is designed to provide two security properties to users:

**1. Custody:** Your BTC cannot be taken by Writz, by an attacker, or by anyone - unless your Bitcoin wallet private key is compromised. The P2WSH script enforces this at the Bitcoin Script level.

**2. Recoverability:** Even if Writz shuts down permanently, you can recover your BTC after the time-lock expires using only your Bitcoin wallet. No dependence on Writz's co-signing service after the lock expires.

**Not a property of v1: privacy.** Writz Lend positions are plaintext. Your Stellar address, the Bitcoin deposit it is linked to, your collateral, debt and health ratio are all public on chain.

---

## Trust Assumptions

Every security system has trust assumptions. Writz's are:

| Component | Trust assumption | Risk if violated |
|---|---|---|
| Bitcoin Script | Bitcoin's consensus rules are enforced correctly | Catastrophic - but this is foundational Bitcoin security |
| Soroban contracts | Smart contract code runs as written | Critical - mitigated by audits and open-source code |
| Protocol co-signing key | The protocol co-signing key is not compromised | High - it cannot move Bitcoin without the user's key; a 2-of-3 protocol side in the script is planned, with a published signing policy |
| Oracle price feed | BTC/USD price is not manipulated beyond staleness threshold | High - mitigated by staleness checks today (single Reflector source); a second source for a median is planned |
| User's private keys | User's Bitcoin and Stellar keys are not compromised | Critical - user responsibility |
| All of the above | No large-scale quantum computer capable of running Shor's algorithm exists | Catastrophic if it does, but this breaks Bitcoin's ECDSA and Stellar's Ed25519 simultaneously. Not a Writz-specific risk, and not one Writz can mitigate unilaterally |

Every trust assumption above except the Bitcoin/Stellar signature schemes themselves rests on elliptic curve discrete log hardness. A cryptographically relevant quantum computer would break secp256k1 (Bitcoin) and Ed25519 (Stellar) at once. This is not something Writz can fix by itself: the protocol's BTC custody depends on Bitcoin's own signature scheme remaining secure, and its USDC settlement depends on Stellar's. No BTCfi competitor surveyed in `docs/research/market-landscape.md` is post-quantum either, for the same structural reason. This is tracked as an acknowledged, industry-wide limitation, not a roadmap item.

---

## Component-Level Security Mechanisms

The properties above are enforced by specific mechanisms in `bitcoin-spv`, `writz-lend` and the relayer. This section documents how each one works and what its residual trade-offs are.

### Bitcoin SPV verification

`bitcoin-spv` is a header-chain light client, and `verify_transaction` is the sole gate a Bitcoin deposit must pass before Writz recognizes it. A caller no longer supplies a header chain: it proves a transaction against block headers the contract already stored, so a chain mined privately can never be presented. How this compares with wrapped Bitcoin and bridges, and which of their risks a light client still shares, is set out in [SPV vs Wrapped Bitcoin](/security/spv-vs-wrapped).

- **Anchored to a checkpoint.** `set_checkpoint` (admin-gated, callable exactly once) stores a real block's height, hash, `bits`, timestamp and the start time of its difficulty period. Every header accepted by `submit_headers` must descend from a stored header, so it must descend from that block. A header whose `prev_block_hash` is not stored is rejected with `UnknownParent`. Because the checkpoint can only be set once, the admin cannot later swap the trusted chain.
- **Proof-of-work and exact difficulty.** Each header must satisfy `SHA256d(header) < target(header.bits)` (`difficulty.rs::validate_proof_of_work`, replicating Bitcoin Core's `arith_uint256::SetCompact`), and must carry exactly the `bits` Bitcoin's rules require at its height: unchanged inside a 2016-block period, and at each boundary the retargeted value (`parent_target * clamp(timespan, 1/4, 4x) / 2 weeks`, capped at the network's proof-of-work limit, compact-encoded like `GetCompact`). This replaces the earlier 64x "difficulty band", so an attacker must expend the network's real difficulty, not a 64x discount. Testnet3/testnet4's minimum-difficulty exception is not modelled; only mainnet and signet are supported.
- **Most-work chain.** Headers accumulate chainwork, and the contract tracks the tip with the most work and a height-to-hash index. A transaction is only provable in a block on that chain, buried under at least `min_confirmations` blocks. A heavier fork re-points the index, and a transaction that existed only in the orphaned branch stops being provable.
- **Not-in-the-future timestamps.** Headers more than two hours ahead of ledger time are rejected.
- **No inner-node forgery.** `verify_transaction` rejects a 64-byte `raw_tx`, the size of a Merkle inner-node preimage, so an inner node can never be proven as a transaction.
- **Permissionless ingestion, optional allowlist.** Anyone can call `submit_headers`; the relayer does so routinely. **On signet, restrict it with `set_submitter`:** signet blocks are authenticated by a block signature that this contract does not verify, and signet's proof-of-work is trivially cheap, so on signet the header source must be a trusted submitter. On mainnet, proof-of-work at real difficulty is the security and submission can stay open.
- **Admin governance.** The checkpoint admin can no longer rewrite the trusted chain after the fact, but it still chooses the checkpoint and the submitter, so the `bitcoin-spv` admin account is a Stellar account intended to be configured as a 2-of-3 multisig via native `SetOptions` before mainnet - no contract code is involved, since `caller.require_auth()` already validates against whatever signing thresholds the admin account carries.

The contract is configured by its constructor at deployment. Until `set_checkpoint` has been called, `verify_transaction` and `submit_headers` fail closed with `CheckpointNotSet`.

**This same requirement extends to `writz-lend`'s admin account.** Its admin gates `set_oracle`, `set_spv_contract`, `set_keeper`, `set_relayer` and `set_keeper_stale_window`, which govern the lending flow's trust assumptions, who can liquidate and who can trigger BTC release. Neither contract enforces multisig in contract logic: both depend on the underlying Stellar account being configured as a multisig externally. **Before mainnet, both admin accounts need the same 2-of-3 (or stricter) multisig configuration.**

The contract already is a stateful light client: it accumulates its own validated chainwork across calls and follows the most-work chain, as described above. What it still trusts is its starting point, the checkpoint, which is set once and is public, so anyone can compare it with a Bitcoin node. Planned hardening (proof-depth binding, median-time-past, an on-chain freshness rule, redundant relayers and an independent monitor) and how this model compares with wrapped Bitcoin and bridges are set out in [SPV vs Wrapped Bitcoin](/security/spv-vs-wrapped).

### Deposit script binding (`writz-lend`)

An SPV proof shows a Bitcoin transaction is real and confirmed; it does not show who controls its outputs. `writz-lend::deposit` therefore never trusts the caller's scriptPubKey. It rebuilds the Writz redeem script from three values - the protocol co-signing key fixed in the contract's config, the depositor's key and the timelock - hashes it, and requires the deposit output to be exactly that P2WSH. An output the depositor can spend alone, or someone else's UTXO, cannot match, so it can never be registered as collateral. (`bitcoin-script`'s `buildRedeemScript` and the contract's `script.rs` are kept byte-identical; the contract tests pin them against reference vectors from the TypeScript builder.)

The timelock must also fall 1,008 to 105,000 blocks (about 7 days to 2 years) above the block that confirmed the deposit, so the CLTV escape hatch is never an instant exit for a freshly-deposited position. The protocol key is fixed for the contract's lifetime; rotating it means deploying a new contract.

### Deposit key ownership (both lenders)

Rebuilding the Writz script proves an output is locked under the protocol's co-signing key, not that the Stellar caller owns it. The user key appears in the deposit transaction's own input witness and the timelock is guessable, so anyone watching Bitcoin could register someone else's deposit as their own position and borrow against it (GHSA-862g-739q-x6h8). Both `deposit` functions now take `key_sig`: a standard Bitcoin signed message (BIP-137, a wallet's ECDSA "sign message") by `user_pubkey` over

```text
Writz deposit
contract:<this contract>
depositor:<the depositor's address>
txid:<the deposit txid, display order>
```

The contract rebuilds that text, recovers the signer with `secp256k1_recover`, and requires it to be `user_pubkey` (`spv-types::key_proof`). Naming the contract and the depositor means a signature cannot be replayed into the other lender, another deployment, or another account. The app asks the connected Bitcoin wallet for this signature right before the deposit transaction.

### Interest accrual (`writz-lend`)

Interest used to be charged at the borrow rate in force when a position was next touched, applied to the whole period since its last update. A borrower could supply a large amount right before repaying, crash utilization and the rate, and reprice months of debt at almost nothing, then withdraw (GHSA-c9gg-c476-9vc8, GHSA-frj5-5wmv-wvm3). `writz-lend` now keeps a global borrow index that grows at the rate in force over each interval and is brought up to date before anything changes utilization: supply, withdraw, borrow, repay and liquidate. A position's debt scales with the index since it was last settled, so a past interval is always priced at the rate that applied during it.

### Merkle proof integrity (duplicate-leaf ambiguity)

Bitcoin's block Merkle tree duplicates the last transaction when a block has an odd transaction count - a well-known quirk (the class of issue behind CVE-2012-2459) that lets the same txid produce a valid-looking inclusion proof at two adjacent indices. Rather than special-casing the Merkle verifier (which would incorrectly reject the *legitimate* proof for the last transaction in any odd-count block - covered by the `merkle_seven_tx_odd_count` test), `writz-lend::deposit` rejects any deposit whose Bitcoin txid has already been recorded, independent of which Merkle index was supplied. This closes the double-collateralization path at the layer that actually needs to enforce uniqueness - the position/commitment store - rather than in the Merkle math itself.

### Contract initialization (constructors)

Both contracts (`bitcoin-spv` and `writz-lend`) take their admin and configuration in a `__constructor` that runs atomically as part of deployment, so there is no separate initialization transaction for anyone to front-run (GHSA-422m-f73x-fh58). Earlier versions used a separate `initialize` call, which left a window in which another account could install itself as admin; the constructors replaced it (#199) and shipped with the coordinated redeploy (#177).

### SegWit transaction handling

For SegWit deposits, `verify_transaction` computes the txid as `SHA256d` of the caller-supplied raw transaction bytes, which must be the non-witness serialization (Bitcoin's block Merkle tree is built over non-witness txids, not `wtxid`). The contract has no way to verify on-chain that witness data was stripped correctly - if it wasn't, the computed hash won't match the Merkle root and the deposit simply fails with `MerkleProofInvalid`. This is a liveness concern only (a failed proof can be retried with correctly stripped bytes); no funds are ever at risk from a stripping mistake. The relayer's transaction-stripping logic carries dedicated test coverage for legacy, P2WPKH, P2WSH, and P2TR shapes, including multi-input transactions with distinct per-input witness stacks.

### Emergency recovery timelock (CLTV / nSequence)

The P2WSH cooperative-release path requires the protocol's co-signature; the fallback path uses `OP_CHECKLOCKTIMEVERIFY` so a user can always recover BTC unilaterally once the timelock expires. CLTV has a sharp edge: if the spending input's `nSequence` is `0xFFFFFFFF` (Bitcoin's "final" value, and many wallets' default), the Script interpreter fails the CLTV check immediately regardless of whether the timelock has actually expired, with no clear error message. Writz's own tooling (`buildEmergencyTransaction`/`finalizePathB` in `bitcoin-script`) hardcodes `nSequence = 0xFFFFFFFE` and gives `SpendParams` no caller-settable sequence field for this path, so it cannot regress. Users constructing this recovery transaction by hand with a third-party wallet must set this themselves - see [Manual Emergency Recovery](/how-it-works/manual-emergency-recovery).

### Protocol co-signing key

The relayer's repay watcher co-signs a Bitcoin release in response to a `repay_full` event recorded on Stellar, and publishes the half-signed transaction on `writz-lend` so it can be read even if Writz is down.

The protocol key cannot move Bitcoin on its own: the cooperative path also requires the user's signature, and the time-lock path needs only the user's key. The planned design replaces the single protocol key with a 2-of-3 protocol side written into the P2WSH script, three keys held separately, so Bitcoin enforces the threshold natively. The signing policy, what the protocol signers can and cannot sign, will be published.

### Cross-chain repayment automation

Repayment isn't atomic across Stellar and Bitcoin: a user repays USDC on Soroban, and only afterward does the protocol co-sign the Bitcoin release. For `writz-lend`'s plaintext flow, a relayer service (`relayer/src/repay-watcher/`) closes the gap between those two steps automatically - it polls Soroban RPC for repayment events from a cursor persisted in SQLite (never "from now" on restart, so no event that fires during an outage is silently skipped), reconstructs and co-signs the release PSBT, and publishes it on-chain for the user to broadcast.

### Keeper model and liquidation permissionlessness

`writz-lend::liquidate` supports a stale-keeper fallback: the designated keeper may always liquidate an undercollateralized position, and after a configurable window (default 24h) with no keeper activity, any caller may liquidate a position that is actually below the threshold instead. Liquidation safety never depends on caller identity - only on whether the position is actually undercollateralized - so this fallback improves liveness without weakening the collateralization check itself.

---

## What Writz Can Do

- Co-sign BTC release transactions when a loan is fully repaid
- Refuse to co-sign if a loan is outstanding (keeping BTC locked)
- Operate the keeper service that monitors for undercollateralized positions
- Manually pause new deposits/borrows/USDC supply via `set_paused` (admin-gated, both lending contracts) - an emergency brake on new exposure, not a freeze; `repay`/`withdraw_supply`/`liquidate`/BTC release all keep working during a pause so users can always exit. This is distinct from the line below.
- **Not yet implemented:** an automatic pause of borrowing and liquidation when oracle prices go stale. Today `writz-lend` calls Reflector live and a stale or unavailable price makes the calling operation fail (`OraclePriceStale`/`OraclePriceUnavailable`), which blocks it without a global pause. Today's `set_paused` is manual and admin-triggered, not automatic.
- Update the oracle contract address (admin function, no user impact) - `set_oracle` on both lending contracts

## What Writz Cannot Do

- Move BTC unilaterally - no valid Bitcoin transaction can be constructed without the user's signature
- Block the emergency time-lock recovery - Condition B in the P2WSH script requires no Writz involvement
- Censor a specific user's repayment - any user can call `repay` on the Stellar contract

---

## Failure Scenarios

### "Writz stops operating"

**During an active loan:**
- The user waits for the time-lock to expire (loan duration + 7 days)
- The user broadcasts the Condition B Bitcoin transaction using only their own key
- The user keeps the USDC they borrowed; Writz cannot recover it

**No active loans:**
- No BTC is locked; nothing is at risk

**Impact on USDC lenders:**
- If borrowers do not repay before Writz shuts down, and liquidations cannot occur, USDC lenders may face losses
- This risk is mitigated by conservative TVL caps, insurance fund accumulation, and progressive decentralization

### "The protocol co-signing key is compromised"

An attacker with the protocol co-signing key cannot:
- Move BTC from any P2WSH address (user signature still required for Condition A)
- Change any position's recorded state on Stellar (positions are plaintext and public, but only `writz-lend`'s own logic can modify them)

An attacker could:
- Refuse to co-sign repayment releases (effectively locking users out of Condition A) - users fall back to Condition B time-lock
- Generate invalid co-signatures for transactions where loans haven't been repaid - invalid because the Stellar contract checks repayment before the event is emitted

**Planned mitigation:** the single co-signing key is replaced by a 2-of-3 protocol side written into the P2WSH script, three keys held separately. Bitcoin enforces the threshold natively, so co-signing a release requires compromising two independent keys at once. The signing policy will be published.

### "The oracle reports a wrong price"

If the BTC/USD price is manipulated downward:
- Healthy positions could appear undercollateralized and be liquidated (their debt is cleared in USDC; no BTC moves in a `writz-lend` liquidation)

**Mitigations:**
- Planned: a median of two independent oracles (Reflector plus Pyth, with a deviation guard - corrected 2026-09-16, then re-verified on-chain; RedStone dropped, DIA parked, see `docs/research/oracle-design.md`) - manipulating the median requires moving both

**Interim status (2026-09-17):** only Reflector is wired into `writz-lend` today - see `contracts/contracts/writz-lend/src/oracle.rs`. There is no median yet; a single misbehaving or unavailable Reflector feed currently blocks (via `OraclePriceStale`/`OraclePriceUnavailable`) rather than silently mispricing, but it cannot yet be cross-checked against a second source the way the target design requires. Do not treat this as the finished manipulation-resistance story until Pyth is also wired.
- Staleness check: price data older than 60 minutes is rejected; liquidations are paused (aligned with `docs/research/oracle-design.md` - Pyth is a pull oracle, not a continuous push feed, so the threshold accounts for time between pulls, not just publish latency)
- Progressive TVL caps limit the maximum exposure during early operation

### "A bug exists in the Soroban contracts"

**Before audit:** The protocol operates on testnet only with no real funds.

**After audit, pre-mainnet:** All findings are remediated before mainnet launch. The external audit before v1 mainnet covers the Soroban contracts (`bitcoin-spv`, `writz-lend`).

**Post-mainnet:** A whitehat bug bounty program is active with up to $50,000 in rewards for critical findings. TVL caps limit damage during early operation. An on-chain insurance fund (seeded from protocol fees) provides backstop coverage.

## The Insurance Fund

Starting from mainnet launch, 5% of all protocol fee revenue is automatically routed to an on-chain insurance fund. This fund is:

- Controlled by a multi-sig (Writz team + community representatives)
- Used only to compensate users for verified smart contract exploits
- Not used for operational expenses or token liquidity

As the fund grows and protocol governance decentralizes, the insurance fund allocation and payout criteria will be managed by WRTZ token holders.

---

**Next:** [SPV vs Wrapped Bitcoin →](/security/spv-vs-wrapped)
