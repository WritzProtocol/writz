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

**Not a property of v1: privacy.** Writz Lend positions are plaintext. Your Stellar address, the Bitcoin deposit it is linked to, your collateral, debt and health ratio are all public on chain. Privacy is being designed as a separate, opt-in edition with its own contracts, pool, audit and trusted-setup ceremony, in progress and on testnet only; see `docs/how-it-works/privacy-edition.md`. Sections below that cover `commitment-tree`, `zk-verifier`, the circuits or the ceremony describe that edition, not v1.

---

## Trust Assumptions

Every security system has trust assumptions. Writz's are:

| Component | Trust assumption | Risk if violated |
|---|---|---|
| Bitcoin Script | Bitcoin's consensus rules are enforced correctly | Catastrophic - but this is foundational Bitcoin security |
| Soroban contracts | Smart contract code runs as written | Critical - mitigated by audits and open-source code |
| ZK circuits (privacy edition only) | Groth16 proofs are sound (no witness forgery) | Critical for that edition - mitigated by its own audit; not a v1 assumption |
| Trusted setup ceremony (privacy edition only) | ≥1 participant destroyed their randomness honestly | Critical for that edition - mitigated by a multi-party ceremony; not on the v1 mainnet path |
| Protocol co-signing key (Phase 1) | Writz's HSM is not compromised | High - mitigated by migration to MPC in Phase 2 |
| Oracle price feed | BTC/USD price is not manipulated beyond staleness threshold | High - mitigated by staleness checks today (single Reflector source); a second source for a median is planned |
| User's private keys | User's Bitcoin and Stellar keys are not compromised | Critical - user responsibility |
| All of the above | No large-scale quantum computer capable of running Shor's algorithm exists | Catastrophic if it does, but this breaks Bitcoin's ECDSA, Stellar's Ed25519, and Groth16's BN254 pairing curve simultaneously. Not a Writz-specific risk, and not one Writz can mitigate unilaterally |

Every trust assumption above except the ZK circuit's soundness (Groth16 pairing checks) and the Bitcoin/Stellar signature schemes themselves rests on elliptic curve discrete log hardness. A cryptographically relevant quantum computer would break secp256k1 (Bitcoin), Ed25519 (Stellar), and BN254 (the trusted setup ceremony and every Groth16 proof) at once. This is not something Writz can fix by itself: the protocol's BTC custody depends on Bitcoin's own signature scheme remaining secure, and its USDC settlement depends on Stellar's. Migrating Writz's ZK layer to a post-quantum-friendly proving system (for example, a hash-based STARK) would not change that, and would give up Stellar's native BN254 pairing verification (Protocol X-Ray) that makes on-chain ZK verification affordable in the first place. No BTCfi competitor surveyed in `docs/research/market-landscape.md` is post-quantum either, for the same structural reason. This is tracked as an acknowledged, industry-wide limitation, not a roadmap item.

---

## Component-Level Security Mechanisms

The properties above are enforced by specific mechanisms in `bitcoin-spv`, `writz-lend` and the relayer. Subsections marked `commitment-tree`, ZK or circuit belong to the privacy edition (in progress, testnet only), which `writz-lend` never calls; they are kept here because that edition's contracts are deployed on testnet and in scope for security reports. This section documents how each one works and what its residual trade-offs are.

### Bitcoin SPV verification

`bitcoin-spv` is a header-chain light client, and `verify_transaction` is the sole gate a Bitcoin deposit must pass before Writz recognizes it. A caller no longer supplies a header chain: it proves a transaction against block headers the contract already stored, so a chain mined privately can never be presented.

- **Anchored to a checkpoint.** `set_checkpoint` (admin-gated, callable exactly once) stores a real block's height, hash, `bits`, timestamp and the start time of its difficulty period. Every header accepted by `submit_headers` must descend from a stored header, so it must descend from that block. A header whose `prev_block_hash` is not stored is rejected with `UnknownParent`. Because the checkpoint can only be set once, the admin cannot later swap the trusted chain.
- **Proof-of-work and exact difficulty.** Each header must satisfy `SHA256d(header) < target(header.bits)` (`difficulty.rs::validate_proof_of_work`, replicating Bitcoin Core's `arith_uint256::SetCompact`), and must carry exactly the `bits` Bitcoin's rules require at its height: unchanged inside a 2016-block period, and at each boundary the retargeted value (`parent_target * clamp(timespan, 1/4, 4x) / 2 weeks`, capped at the network's proof-of-work limit, compact-encoded like `GetCompact`). This replaces the earlier 64x "difficulty band", so an attacker must expend the network's real difficulty, not a 64x discount. Testnet3/testnet4's minimum-difficulty exception is not modelled; only mainnet and signet are supported.
- **Most-work chain.** Headers accumulate chainwork, and the contract tracks the tip with the most work and a height-to-hash index. A transaction is only provable in a block on that chain, buried under at least `min_confirmations` blocks. A heavier fork re-points the index, and a transaction that existed only in the orphaned branch stops being provable.
- **Not-in-the-future timestamps.** Headers more than two hours ahead of ledger time are rejected.
- **No inner-node forgery.** `verify_transaction` rejects a 64-byte `raw_tx`, the size of a Merkle inner-node preimage, so an inner node can never be proven as a transaction.
- **Permissionless ingestion, optional allowlist.** Anyone can call `submit_headers`; the relayer does so routinely. **On signet, restrict it with `set_submitter`:** signet blocks are authenticated by a block signature that this contract does not verify, and signet's proof-of-work is trivially cheap, so on signet the header source must be a trusted submitter. On mainnet, proof-of-work at real difficulty is the security and submission can stay open.
- **Admin governance.** The checkpoint admin can no longer rewrite the trusted chain after the fact, but it still chooses the checkpoint and the submitter, so the `bitcoin-spv` (and `zk-verifier`) admin accounts are Stellar accounts intended to be configured as 2-of-3 multisigs via native `SetOptions` before mainnet - no contract code is involved, since `caller.require_auth()` already validates against whatever signing thresholds the admin account carries.

Until `initialize` and `set_checkpoint` have both been called, `verify_transaction` and `submit_headers` fail closed with `NotInitialized`/`CheckpointNotSet`.

**This same requirement extends to `writz-lend` and `commitment-tree`'s admin accounts, not just `bitcoin-spv`/`zk-verifier`.** Their admins control functions with equal blast radius: `commitment-tree`'s admin gates `insert_commitment` (when a deposit enters the Merkle tree; the resulting root is proven, #211) and, as of the config setters added alongside this document, `set_oracle`/`set_spv_contract`/`set_zk_verifier` - an admin who can silently repoint any of those can redirect the entire lending flow's trust assumptions. `writz-lend`'s admin gates the equivalent setters plus `set_keeper`/`set_relayer`/`set_keeper_stale_window`, which govern who can liquidate and who can trigger BTC release. None of the four contracts enforce multisig in contract logic - all four depend entirely on the underlying Stellar account being configured as a multisig externally. **Before mainnet, all four admin accounts need the same 2-of-3 (or stricter) multisig configuration, not just two of them.**

A stronger design would have the contract accumulate its own validated chainwork across calls (a stateful "light client," as BTCRelay/tBTC-style bridges do) rather than trusting an admin-set checkpoint at all. That's a real architecture change, not a parameter tweak, and is tracked as future work rather than a mainnet blocker given the mitigations above.

### Deposit script binding (`writz-lend`)

An SPV proof shows a Bitcoin transaction is real and confirmed; it does not show who controls its outputs. `writz-lend::deposit` therefore never trusts the caller's scriptPubKey. It rebuilds the Writz redeem script from three values - the protocol co-signing key fixed in the contract's config, the depositor's key and the timelock - hashes it, and requires the deposit output to be exactly that P2WSH. An output the depositor can spend alone, or someone else's UTXO, cannot match, so it can never be registered as collateral. (`bitcoin-script`'s `buildRedeemScript` and the contract's `script.rs` are kept byte-identical; the contract tests pin them against reference vectors from the TypeScript builder.)

The timelock must also fall 1,008 to 105,000 blocks (about 7 days to 2 years) above the block that confirmed the deposit, so the CLTV escape hatch is never an instant exit for a freshly-deposited position. The protocol key is fixed for the contract's lifetime; rotating it means deploying a new contract.

### Collateral binding (`commitment-tree`, privacy edition)

A ZK deposit must lock its BTC under the same Writz script `writz-lend` uses: a P2WSH built from the protocol's co-signing key, the depositor's own key and a CLTV timelock. `commitment-tree::deposit` takes `user_pubkey` and `timelock_height`, rebuilds that script on-chain from them and `Config.protocol_pubkey` (`spv-types::script`, shared by both lending contracts), and counts only the output of `raw_tx` that pays it. The timelock must lie 1,008..=105,000 blocks above the block that confirmed the deposit. A transaction that pays anything else - a script the protocol cannot co-sign, or someone else's Writz output claimed with a different key - fails with `VaultOutputNotFound`.

The proof's public `actual_satoshis` signal must equal that output's value, and `deposit.circom` constrains `collateral_satoshis === actual_satoshis`, so the hidden collateral committed into the position is transitively bound to what the transaction really locked (GHSA-2hjj-x5wr-4p68, GHSA-xp6j-g2rw-h5g6, GHSA-mg4x-cr23-4x3v).

Why a per-user script rather than one shared vault script (#177): a shared script cannot hold a per-user timelock exit or require the user's own signature for release, so the protocol alone would hold every ZK depositor's BTC. The per-user script costs the ZK path no privacy it actually had: `DepositEvent` already publishes the depositor, the Bitcoin txid and the commitment, and the txid identifies the output on Bitcoin. What the ZK path hides is which leaf later borrows, repays or is liquidated - and those proofs never reference the script. `DepositEvent` also carries `user_pubkey` and `timelock_height`, so the timelock exit can be rebuilt from chain data alone.

The trade-off is the one `writz-lend` already makes (GHSA-5rxp): once the timelock passes, a borrower can reclaim the BTC while still owing USDC, and the protocol cannot seize it. `commitment-tree` therefore carries the same exposure cap, `max_total_borrowed` (50,000 USDC by default, admin-set). Two gaps specific to the ZK path are closed by #212:

- **A borrow must leave time before the timelock.** The commitment now carries the position's CLTV height, `Poseidon(collateral, debt, liq_key, nonce, timelock_height)`, bound at deposit to the height the contract checked against the Bitcoin output. A borrow proves `timelock_height >= min_timelock_height`, a public bound, and the contract requires that bound to be at least `bitcoin-spv`'s tip plus `borrow_timelock_margin_blocks` (4,320 blocks, about 30 days, admin-set from 144 up to 105,000). It also refuses a tip whose header is older than `max_tip_age_secs` (6 hours by default), so a stalled header relay cannot let a borrow measure its margin from a stale height. The bound reveals the current tip, not the position's own timelock. Repay has no bound, so a matured position can always repay.
- **A third party can liquidate a ZK position.** A position has two keys: `secret`, which borrow, repay and release prove knowledge of, and `liq_key = Poseidon(secret)`, which is enough for the liquidation circuit and nothing else. Every borrow and repay proof encrypts the new position's `liq_key`, nonce and amounts to the keeper's BabyJubJub key inside the circuit (`KeeperNote` in `circuits/src/position.circom`), and the contract requires that key to be the configured one (`KeeperKeyMismatch`). Because the encryption is a constraint of the proof, a borrower cannot publish a note the keeper fails to open. The relayer's ZK keeper (`relayer/src/zk-keeper/`) opens each note from the `borrow`/`repay` event, tracks the position's health and liquidates it below the threshold. The keeper key can close a position but never borrow against it or release its BTC.

What is not done: there is no default at maturity. A position whose owner neither repays nor is liquidated can still reclaim its BTC once the timelock passes, which is the bounded exposure above. The margin guarantees that at least 30 days separate the last borrow from that point.

### Deposit key ownership (both lenders)

Rebuilding the Writz script proves an output is locked under the protocol's co-signing key, not that the Stellar caller owns it. The user key appears in the deposit transaction's own input witness and the timelock is guessable, so anyone watching Bitcoin could register someone else's deposit as their own position and borrow against it (GHSA-862g-739q-x6h8). Both `deposit` functions now take `key_sig`: a standard Bitcoin signed message (BIP-137, a wallet's ECDSA "sign message") by `user_pubkey` over

```text
Writz deposit
contract:<this contract>
depositor:<the depositor's address>
txid:<the deposit txid, display order>
```

The contract rebuilds that text, recovers the signer with `secp256k1_recover`, and requires it to be `user_pubkey` (`spv-types::key_proof`). Naming the contract and the depositor means a signature cannot be replayed into the other lender, another deployment, or another account. The app asks the connected Bitcoin wallet for this signature right before the deposit transaction.

### Borrow recipient binding (`commitment-tree`, privacy edition)

`commitment-tree::borrow` authenticates the caller-supplied `borrower` address via `require_auth`, but authentication alone doesn't tie *that specific address* to the ZK proof being redeemed. Before this fix, a party who obtained a pending borrow transaction's proof and public signals (e.g. observing it before it confirms) could resubmit the identical proof with a different address they control and be included first - the contract would pay them, spend the position's nullifier, and the original caller's transaction would then fail.

`borrow_repay.circom`'s public `recipient_lo`/`recipient_hi` signals - the sha256 digest of the recipient's Stellar strkey address, split into two 128-bit halves - close this the same way `deposit.circom`'s `btc_txid_lo/hi` bind a proof to its Bitcoin transaction: by being part of the public statement Groth16 verifies, not by any in-circuit constraint. `commitment-tree::borrow` independently recomputes `sha256(borrower.to_string())` from the address it authenticated and rejects a mismatch, so a copied proof can only be redeemed by the address it was generated for. `repay` shares the same circuit but pulls funds *from* the caller rather than paying an arbitrary address, so it has no equivalent recipient-redirection risk and doesn't check these signals.

### Interest accrual (`writz-lend`)

Interest used to be charged at the borrow rate in force when a position was next touched, applied to the whole period since its last update. A borrower could supply a large amount right before repaying, crash utilization and the rate, and reprice months of debt at almost nothing, then withdraw (GHSA-c9gg-c476-9vc8, GHSA-frj5-5wmv-wvm3). `writz-lend` now keeps a global borrow index that grows at the rate in force over each interval and is brought up to date before anything changes utilization: supply, withdraw, borrow, repay and liquidate. A position's debt scales with the index since it was last settled, so a past interval is always priced at the rate that applied during it.

### Deposit nullifier reuse (`commitment-tree`, privacy edition)

`deposit` checked that a nullifier had not been spent but never recorded it, so a second deposit could reuse one and leave a leaf that could never be spent (GHSA-frj5-5wmv-wvm3, low: self-harm only). Deposit nullifiers are now recorded and a reuse fails with `DuplicateNullifier`.

### Merkle proof integrity (duplicate-leaf ambiguity)

Bitcoin's block Merkle tree duplicates the last transaction when a block has an odd transaction count - a well-known quirk (the class of issue behind CVE-2012-2459) that lets the same txid produce a valid-looking inclusion proof at two adjacent indices. Rather than special-casing the Merkle verifier (which would incorrectly reject the *legitimate* proof for the last transaction in any odd-count block - covered by the `merkle_seven_tx_odd_count` test), both `writz-lend::deposit` and `commitment-tree::deposit` reject any deposit whose Bitcoin txid has already been recorded, independent of which Merkle index was supplied. This closes the double-collateralization path at the layer that actually needs to enforce uniqueness - the position/commitment store - rather than in the Merkle math itself.

### Relayer authorization (`/insert-commitment`, `/update-leaf`)

The relayer holds the `commitment-tree` admin key and exposes two HTTP endpoints the frontend calls directly from the browser during deposit/borrow/repay - which used to mean anyone with network access to the relayer could trigger them too (GHSA-prw2-j3jx-43qh, GHSA-wqp4-3573-552v, GHSA-ffx5-7x4m-939g).

`POST /insert-commitment` now requires `authTxXdr`: a throwaway transaction (never submitted) whose source account is the depositor, signed by them, containing a single `manageData("writz-insert-commitment", commitment)` operation. The relayer verifies the signature against the claimed depositor, then independently looks up the real `DepositEvent` for that commitment on-chain and rejects unless its `depositor` field matches - so an attacker can sign with their own key all they want, but can't claim someone else's pending deposit, and can't fabricate a deposit that never happened. `POST /update-leaf` needs no identity check at all: it validates the proposed write against ground truth instead, by recomputing what the Merkle root would become and comparing it against the real on-chain root via `get_merkle_root()`. Only a write that reproduces a root the contract has actually reached is persisted - a real borrow/repay always produces exactly the update this check demands, and nothing else can.

`commitment-tree::insert_commitment` used to store whatever root the admin passed, so the relayer's honest computation was the only thing keeping the tree correct; a compromised admin key or a relayer bug could install a root holding invented leaves or dropping honest ones. It now takes a Groth16 proof from the `insert` circuit (`circuits/src/insert.circom`, built on `MerkleTreeUpdater`) instead of a root (#211). The proof shows the new root is the stored root with the commitment written into a leaf that was empty, and the contract pins that leaf to its own `NextLeafIndex` counter, requires the commitment to be a pending deposit, and requires the proof's old root to be the stored one. The admin still decides when a commitment is inserted, but no longer what the root becomes. The relayer generates the proof from public data (`relayer/src/insert-prover.ts`). The old `createDemoPosition` dashboard shortcut, which inserted a commitment with no deposit behind it, is removed.

### Leaf store liveness (relayer)

The contract stores only the Merkle root, so the relayer's leaf store is the only copy of the tree, and it used to advance only when a client called `/update-leaf` after a borrow or repay. One missing call, a closed tab or a borrower who never sends it, left the store behind the chain and `/merkle-path` answered 409 for everyone (GHSA-vwvv-3255-783f). `BorrowEvent` now carries `new_commitment` like `RepayEvent`, and the relayer's tree watcher follows `insert_leaf`, `borrow` and `repay` events from a persisted cursor, applying each to the store after checking it reproduces the event's root. Which leaf a borrow or repay changed is found by matching the root, so it is still not published. `/update-leaf` is now only a faster path to the same state. The cursor advances one event at a time, so a restart replays at most the event that was in flight, and that event always reapplies cleanly (#286). An event the store cannot explain holds the cursor and shows up as `treeSync.ok: false` on `/health`. `bun run rebuild-tree` then rebuilds the store from chain and checks it against the on-chain root before swapping it in (#265).

### Cooperative release binding (`/api/cosign`)

`/api/cosign` verifies a `zero_debt` Groth16 proof and separately trusts a caller-supplied `commitment` string and PSBT - with nothing tying the three together. A valid zero-debt proof about the caller's own debt-free position B could authorize releasing a *different*, still-indebted position A's BTC: the proof itself carried no position identifier (its only public signal was `merkle_root`), and the endpoint never checked that the claimed `commitment` was the one the proof was about, or that the PSBT's UTXO was the one that commitment actually deposited (GHSA-6jmp-wf3x-3vxh, GHSA-9j8g-prh5-jhhj).

`zero_debt.circom` now publishes `commitment` (`Poseidon(collateral, 0, liq_key, nonce, timelock_height)`) as a circuit output alongside `merkle_root` - this reveals nothing new, since the commitment is already public on-chain as the Merkle leaf itself (visible in `DepositEvent`/`InsertLeafEvent`). `/api/cosign` (via `lib/cosign/binding.ts`'s `verifyReleaseBinding`) now checks, in order: the proof's public commitment matches the one the request claims to release; the proof's public root matches the current on-chain root; a `DepositEvent` exists on-chain for that commitment; and the PSBT's input 0 spends exactly the txid that event recorded. Each link - proof↔commitment, commitment↔real-deposit, commitment↔PSBT - is independently verified against on-chain ground truth, not against another caller-supplied value.

A repaid position's zero-debt leaf also has to stop being borrowable once its BTC leaves: otherwise a fully repaid and released position could borrow again against no collateral (GHSA-w4rp-v54x-2cv3, GHSA-hcjf-8vjc-2hfv). `zero_debt.circom` publishes the leaf's nullifier, `commitment-tree::mark_released` spends it, and `/api/cosign` refuses to co-sign until that is recorded on-chain, so `borrow` on the released leaf fails with `NullifierAlreadySpent` (#205, deployed in the 2026-10-11 testnet redeploy).

### Contract initialization (`initialize`, all four contracts)

Every contract's `initialize` now calls `admin.require_auth()`, so the admin address being installed must have authorized the call (GHSA-422m-f73x-fh58). Before this, any account could name any admin and seize the contract's configuration, since initialization is a separate transaction from deployment and has an open front-running window.

This is a partial closure. Requiring the admin's signature stops an attacker from installing an admin they don't control, but an attacker can still race to initialize with *their own* address as admin before the operator's transaction lands. Fully closing the window needs deploy and initialize to happen atomically in one transaction, which is a change to the deployment scripts and is tracked with the coordinated redeploy (#177).

### SegWit transaction handling

For SegWit deposits, `verify_transaction` computes the txid as `SHA256d` of the caller-supplied raw transaction bytes, which must be the non-witness serialization (Bitcoin's block Merkle tree is built over non-witness txids, not `wtxid`). The contract has no way to verify on-chain that witness data was stripped correctly - if it wasn't, the computed hash won't match the Merkle root and the deposit simply fails with `MerkleProofInvalid`. This is a liveness concern only (a failed proof can be retried with correctly stripped bytes); no funds are ever at risk from a stripping mistake. The relayer's transaction-stripping logic carries dedicated test coverage for legacy, P2WPKH, P2WSH, and P2TR shapes, including multi-input transactions with distinct per-input witness stacks.

### Emergency recovery timelock (CLTV / nSequence)

The P2WSH cooperative-release path requires the protocol's co-signature; the fallback path uses `OP_CHECKLOCKTIMEVERIFY` so a user can always recover BTC unilaterally once the timelock expires. CLTV has a sharp edge: if the spending input's `nSequence` is `0xFFFFFFFF` (Bitcoin's "final" value, and many wallets' default), the Script interpreter fails the CLTV check immediately regardless of whether the timelock has actually expired, with no clear error message. Writz's own tooling (`buildEmergencyTransaction`/`finalizePathB` in `bitcoin-script`) hardcodes `nSequence = 0xFFFFFFFE` and gives `SpendParams` no caller-settable sequence field for this path, so it cannot regress. Users constructing this recovery transaction by hand with a third-party wallet must set this themselves - see [Manual Emergency Recovery](/how-it-works/manual-emergency-recovery).

### Protocol co-signing key custody

The two call sites that need to co-sign a Bitcoin release (`/api/cosign` and the repay-watcher relayer) resolve their signer through a single shared function, `resolveProtocolSigner`, rather than each hardcoding a custody assumption. It prefers an AWS KMS asymmetric key (`ECC_SECG_P256K1` / `ECDSA_SHA_256` - the same curve Bitcoin uses): the private key material never leaves KMS, and every signature is an authenticated `kms:Sign` call, audit-logged via CloudTrail.

When KMS isn't configured, the same function falls back to a WIF-encoded key read from an environment variable (`PROTOCOL_SIGNING_KEY`) - the custody model Writz used before KMS. This exists to unblock testnet/signet operation when KMS setup is delayed (for example, while an AWS account identity-verification hold is being resolved), not as a permanent alternative: it reintroduces the exact risk the KMS migration closed (a compromised host or leaked environment variable exposes the key outright, with no HSM boundary). To keep that fallback from silently becoming the mainnet posture, `resolveProtocolSigner` refuses it unconditionally on `bitcoin.networks.bitcoin` - a deployment misconfigured for mainnet fails loudly at startup instead of running with a weaker custody model than the rest of this document assumes. KMS takes priority whenever both are configured, so setting `KMS_KEY_ID` is the only step needed to move a given deployment off the fallback.

**Operational monitoring gap:** the mainnet guard is a hard stop, but there is currently no alerting for the WIF fallback being active on testnet/signet - `resolveProtocolSigner` silently uses it whenever `KMS_KEY_ID` is unset, with no log line or metric flagging that a deployment is running with the weaker custody model. Before mainnet, add a startup-time log/alert (not just the mainnet-network refusal) so the team always knows which custody mode a given deployment is running under, rather than discovering it only if the mainnet guard fires.

### Trusted setup ceremony (privacy edition)

The ceremony is not on the v1 mainnet path. Groth16 requires a per-circuit trusted setup. `circuits/scripts/ceremony/` implements the full production runbook: fetching and checksum-verifying the Hermez Phase-1 ptau (`00_fetch_ptau.sh`, deliberately requiring a human-pinned, PR-reviewed checksum rather than a hardcoded one), the coordinator's per-circuit setup (`01_new_zkey.sh`), interactive participant contribution with no scripted entropy (`02_contribute.sh`), independent transcript verification (`03_verify_transcript.sh`), and final key export plus manifest generation (`04_export.js`). A CI job re-verifies the committed manifest's hashes and IC lengths on every PR touching `circuits/keys/**`, and rejects any transcript containing a dev-labeled participant. Running the actual multi-party ceremony - recruiting independent participants and executing the runbook publicly - is an operational milestone for the privacy edition before that edition launches, not something further engineering work can complete on its own.

### Liquidation debt disclosure (privacy edition)

In the privacy edition's design, collateral is hidden by the ZK commitment scheme (debt amounts still appear in borrow and repay events and USDC transfers). Liquidation is the one operation where this breaks down: a keeper must know how much USDC to repay, so `usdc_debt` is necessarily published on-chain at liquidation time. What the circuit guarantees is that this published amount is *provably correct* - `liquidation.circom` binds it directly to the private commitment (`usdc_debt <== debt_stroops`) as a circuit output, so there is no caller-supplied field a keeper could misdeclare. A future keeper network where amounts are learned through encrypted off-chain channels, or committed-but-not-revealed bidding, only becomes worth building once multiple competing keepers exist for such a scheme to protect against - see the keeper model below.

### Cross-chain repayment automation

Repayment isn't atomic across Stellar and Bitcoin: a user repays USDC on Soroban, and only afterward does the protocol co-sign the Bitcoin release. For `writz-lend`'s plaintext flow, a relayer service (`relayer/src/repay-watcher/`) closes the gap between those two steps automatically - it polls Soroban RPC for repayment events from a cursor persisted in SQLite (never "from now" on restart, so no event that fires during an outage is silently skipped), reconstructs and co-signs the release PSBT, and publishes it on-chain for the user to broadcast. For `commitment-tree`'s ZK flow, this can't be fully automated with the current design - cosigning requires the user's own private witness (collateral, secret, nonce), which the backend does not and should not custody outside of the keeper model described below. Those positions rely on manual cosign submission or the CLTV timelock as the safety valve. In both flows, the bound on how long a user can be "stranded" (repaid on Stellar, BTC still locked) is `loan_duration + a fixed recovery buffer`, after which the timelock path is always available regardless of protocol availability.

### Keeper model and liquidation permissionlessness

In the privacy edition, `commitment-tree::liquidate` requires only the caller's own authorization and a valid Groth16 proof of undercollateralization - there is no keeper allowlist to bypass, so it is permissionless by construction. Producing that proof takes the position's `liq_key`, which only its owner and the holder of the keeper key can read (#212). `writz-lend::liquidate` (plaintext positions, no ZK privacy at stake) additionally supports a stale-keeper fallback: the designated keeper may always liquidate an undercollateralized position, and after a configurable window (default 24h) with no keeper activity, any caller may liquidate a position that is actually below the threshold instead. Liquidation safety never depends on caller identity - only on whether the position is actually undercollateralized - so this fallback improves liveness without weakening the collateralization check itself.

**This is a deliberate asymmetry between the two contracts, not an inconsistency to reconcile.** `commitment-tree` doesn't need a keeper-preference mechanism because its positions are private by design - there's no plaintext health-ratio feed a keeper could act on faster than anyone else, so "anyone with a valid proof" is already the natural permission model. `writz-lend`'s positions are plaintext, so a keeper-preference-with-stale-fallback pattern makes sense there: a designated keeper gets first opportunity as an operational convenience (predictable liquidation ops, no race with third parties under normal conditions), while the stale fallback guarantees the position doesn't depend on that keeper's uptime for safety. Neither contract's approach is more "correct" than the other - they fit the privacy model each contract actually has.

The keeper does need position preimages to monitor health ratios in the first place, which means Writz-as-keeper-operator can see position details that no on-chain observer or third-party liquidator can. Since #212 it gets them from the keeper notes every borrow and repay encrypts to its key, not from the user, and what it gets (`liq_key`) cannot move funds. This is an accepted architectural trade-off for the current phase (privacy-against-observers, not privacy-against-the-operator) rather than a bug - decentralizing it requires a keeper network with its own coordination/staking design, tracked as future work.

**`commitment-tree::liquidate` is currently unreachable through any legitimate on-chain sequence of calls.** `borrow`'s circuit enforces a minimum 150% collateral ratio at the moment of borrowing; `liquidate` requires the position's ratio to be below the 120% threshold; and the price used for both checks is the same fixed Phase 1 oracle stub. Unlike `writz-lend`, `commitment-tree` has no interest-accrual mechanism that could push a healthy position's debt up over time - ZK debt only ever changes via an explicit `borrow`/`repay` proof, never automatically. With the price fixed and no accrual, there is no way for a position that started at ≥150% to ever drop below 120% today. This isn't a bug in `liquidate` itself (its proof verification, threshold check, and nullifier-spend logic are all tested - see `commitment-tree/src/test.rs::liquidate_undercollateralized_position`, which constructs the precondition directly rather than through `deposit`+`borrow`) - it's a product gap: liquidation only becomes reachable once either a real (movable) oracle price or a ZK-compatible accrual mechanism exists. Track this as a Phase 2 dependency alongside the oracle integration itself.

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

### "The protocol co-signing key is compromised (Phase 1)"

An attacker with the protocol co-signing key cannot:
- Move BTC from any P2WSH address (user signature still required for Condition A)
- Change any position's recorded state on Stellar (positions are plaintext and public, but only `writz-lend`'s own logic can modify them)

An attacker could:
- Refuse to co-sign repayment releases (effectively locking users out of Condition A) - users fall back to Condition B time-lock
- Generate invalid co-signatures for transactions where loans haven't been repaid - invalid because the Stellar contract checks repayment before the event is emitted

**Phase 2 mitigation:** The co-signing key is replaced with a threshold MPC scheme (Protocol 27). Compromising the co-signing key requires compromising multiple independent parties simultaneously.

### "The oracle reports a wrong price"

If the BTC/USD price is manipulated downward:
- Healthy positions could appear undercollateralized and be liquidated (their debt is cleared in USDC; no BTC moves in a `writz-lend` liquidation)

**Mitigations:**
- Median of two independent oracles (Pyth + Reflector - corrected 2026-09-16, then re-verified on-chain; RedStone dropped, DIA parked, see `docs/research/oracle-design.md`) - manipulating the median requires moving both

**Interim status (2026-09-17):** only Reflector is wired into `writz-lend` today - see `contracts/contracts/writz-lend/src/oracle.rs`. There is no median yet; a single misbehaving or unavailable Reflector feed currently blocks (via `OraclePriceStale`/`OraclePriceUnavailable`) rather than silently mispricing, but it cannot yet be cross-checked against a second source the way the target design requires. Do not treat this as the finished manipulation-resistance story until Pyth is also wired.
- Staleness check: price data older than 60 minutes is rejected; liquidations are paused (aligned with `docs/research/oracle-design.md` - Pyth is a pull oracle, not a continuous push feed, so the threshold accounts for time between pulls, not just publish latency)
- Progressive TVL caps limit the maximum exposure during early operation

### "A bug exists in the Soroban contracts"

**Before audit:** The protocol operates on testnet only with no real funds.

**After audit, pre-mainnet:** All findings are remediated before mainnet launch. The external audit before v1 mainnet covers the Soroban contracts (`bitcoin-spv`, `writz-lend`); the privacy edition's circuits and contracts get their own audit before that edition launches.

**Post-mainnet:** A whitehat bug bounty program is active with up to $50,000 in rewards for critical findings. TVL caps limit damage during early operation. An on-chain insurance fund (seeded from protocol fees) provides backstop coverage.

### "A user loses their position data (privacy edition only)"

This scenario does not apply to Writz Lend: `writz-lend` positions are recorded on chain and keyed by the Bitcoin txid, so there is nothing local to lose. In the privacy edition, a user's ZK position data (commitment secret, nonce) exists only in their local browser storage. If this data is lost:

- The user cannot generate ZK proofs to borrow, repay, or close their position
- The Writz team cannot recover the data - it was never stored on-chain
- The user must wait for the time-lock to expire and recover BTC via Condition B
- Any USDC already borrowed is kept by the user; the loan cannot be formally repaid without the ZK secret

**Mitigation:** The Writz app will prompt users to export and securely back up their position data. This is analogous to backing up a seed phrase - the user is responsible.

### "A ZK circuit has a soundness bug" (privacy edition only)

This does not apply to Writz Lend, which uses no circuits. A soundness bug means an attacker can generate a valid-looking proof for a false statement - for example, proving they have a 150% collateral ratio when they don't.

**Impact:** An attacker could borrow USDC without adequate collateral. If undetected, they could drain the USDC pool.

**Mitigations:**
- A specialist ZK circuit audit before the privacy edition launches
- Formal verification tools (circom-mutator, custom constraint analysis)
- TVL caps limit maximum exposure
- Progressive rollout: low TVL cap raised only after extended clean operation

---

## The Insurance Fund

Starting from mainnet launch, 5% of all protocol fee revenue is automatically routed to an on-chain insurance fund. This fund is:

- Controlled by a multi-sig (Writz team + community representatives)
- Used only to compensate users for verified smart contract exploits
- Not used for operational expenses or token liquidity

As the fund grows and protocol governance decentralizes, the insurance fund allocation and payout criteria will be managed by WRTZ token holders.

---

**Next:** [Audits →](/security/audits)
