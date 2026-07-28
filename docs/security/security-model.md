# Security Model

**What Writz protects, what it cannot protect, and what happens when things go wrong.**

No protocol is risk-free. This page explains Writz's security model honestly: what the system protects, what the trust assumptions are, and what happens in every relevant failure scenario.

---

## Security Properties

Writz is designed to provide three security properties to users:

**1. Custody:** Your BTC cannot be taken by Writz, by an attacker, or by anyone — unless your Bitcoin wallet private key is compromised. The P2WSH script enforces this at the Bitcoin Script level.

**2. Privacy:** Your position details (collateral amount, loan size, health factor) are never stored on-chain in plaintext. They exist only in your local browser storage and are protected by the ZK commitment scheme. An observer watching the blockchain cannot link your wallet to a position or infer position details.

**3. Recoverability:** Even if Writz shuts down permanently, you can recover your BTC after the time-lock expires using only your Bitcoin wallet. No dependence on Writz's co-signing service after the lock expires.

---

## Trust Assumptions

Every security system has trust assumptions. Writz's are:

| Component | Trust assumption | Risk if violated |
|---|---|---|
| Bitcoin Script | Bitcoin's consensus rules are enforced correctly | Catastrophic — but this is foundational Bitcoin security |
| Soroban contracts | Smart contract code runs as written | Critical — mitigated by audits and open-source code |
| ZK circuits | Groth16 proofs are sound (no witness forgery) | Critical — mitigated by formal verification and Veridise audit |
| Trusted setup ceremony | ≥1 participant destroyed their randomness honestly | Critical — mitigated by multi-party ceremony with independent participants |
| Protocol co-signing key (Phase 1) | Writz's HSM is not compromised | High — mitigated by migration to MPC in Phase 2 |
| Oracle price feed | BTC/USD price is not manipulated beyond staleness threshold | High — mitigated by multi-oracle median, staleness checks |
| User's private keys | User's Bitcoin and Stellar keys are not compromised | Critical — user responsibility |

---

## Component-Level Security Mechanisms

The properties above are enforced by specific mechanisms in `bitcoin-spv`, `private-lend`, `commitment-tree`, and the surrounding relayer/circuit tooling. This section documents how each one works and what its residual trade-offs are.

### Bitcoin SPV verification

`bitcoin-spv::verify_transaction` is the sole gate a Bitcoin deposit must pass before Writz recognizes it. Three checks combine to make forging a deposit computationally infeasible rather than merely inconvenient:

- **Proof-of-work.** Every header in the submitted chain must satisfy `SHA256d(header) < target(header.bits)` (`difficulty.rs::validate_proof_of_work`), replicating Bitcoin Core's `arith_uint256::SetCompact` exactly, including its overflow/negative edge cases. A chain of headers that only satisfies the chain-linkage check (`prev_block_hash` continuity) but not real proof-of-work is rejected — this is what makes fabricating "6 confirmations" in microseconds impossible.
- **Checkpoint difficulty floor.** PoW alone isn't sufficient: Bitcoin blocks from early in its history had trivially low difficulty, so an attacker could mine a real-but-historical low-difficulty chain. `set_checkpoint` (admin-gated) stores a recent block's height, hash, and `bits`. `verify_transaction` rejects any header whose implied target is more than 64× easier than the checkpoint's — a compiled constant the admin cannot relax. Since real Bitcoin consensus caps difficulty *decrease* at 4× per retarget period, satisfying this floor requires hashpower comparable to a genuine attack on current Bitcoin, not a historical replay. The checkpoint must be refreshed periodically (operationally, weekly); until `initialize` + `set_checkpoint` have both been called, `verify_transaction` fails closed with `NotInitialized`/`CheckpointNotSet` rather than silently allowing unanchored chains through.
- **Admin governance for the checkpoint.** Because a compromised checkpoint admin could widen the exploitable difficulty band, the `bitcoin-spv` (and `zk-verifier`) admin accounts are Stellar accounts intended to be configured as 2-of-3 multisigs via native `SetOptions` before mainnet — no contract code is involved, since `caller.require_auth()` already validates against whatever signing thresholds the admin account carries.

A stronger design would have the contract accumulate its own validated chainwork across calls (a stateful "light client," as BTCRelay/tBTC-style bridges do) rather than trusting an admin-set checkpoint at all. That's a real architecture change, not a parameter tweak, and is tracked as future work rather than a mainnet blocker given the mitigations above.

### Merkle proof integrity (duplicate-leaf ambiguity)

Bitcoin's block Merkle tree duplicates the last transaction when a block has an odd transaction count — a well-known quirk (the class of issue behind CVE-2012-2459) that lets the same txid produce a valid-looking inclusion proof at two adjacent indices. Rather than special-casing the Merkle verifier (which would incorrectly reject the *legitimate* proof for the last transaction in any odd-count block — covered by the `merkle_seven_tx_odd_count` test), both `private-lend::deposit` and `commitment-tree::deposit` reject any deposit whose Bitcoin txid has already been recorded, independent of which Merkle index was supplied. This closes the double-collateralization path at the layer that actually needs to enforce uniqueness — the position/commitment store — rather than in the Merkle math itself.

### SegWit transaction handling

For SegWit deposits, `verify_transaction` computes the txid as `SHA256d` of the caller-supplied raw transaction bytes, which must be the non-witness serialization (Bitcoin's block Merkle tree is built over non-witness txids, not `wtxid`). The contract has no way to verify on-chain that witness data was stripped correctly — if it wasn't, the computed hash won't match the Merkle root and the deposit simply fails with `MerkleProofInvalid`. This is a liveness concern only (a failed proof can be retried with correctly stripped bytes); no funds are ever at risk from a stripping mistake. The relayer's transaction-stripping logic carries dedicated test coverage for legacy, P2WPKH, P2WSH, and P2TR shapes, including multi-input transactions with distinct per-input witness stacks.

### Emergency recovery timelock (CLTV / nSequence)

The P2WSH cooperative-release path requires the protocol's co-signature; the fallback path uses `OP_CHECKLOCKTIMEVERIFY` so a user can always recover BTC unilaterally once the timelock expires. CLTV has a sharp edge: if the spending input's `nSequence` is `0xFFFFFFFF` (Bitcoin's "final" value, and many wallets' default), the Script interpreter fails the CLTV check immediately regardless of whether the timelock has actually expired, with no clear error message. Writz's own tooling (`buildEmergencyTransaction`/`finalizePathB` in `bitcoin-script`) hardcodes `nSequence = 0xFFFFFFFE` and gives `SpendParams` no caller-settable sequence field for this path, so it cannot regress. Users constructing this recovery transaction by hand with a third-party wallet must set this themselves — see [Manual Emergency Recovery](../how-it-works/manual-emergency-recovery.md).

### Protocol co-signing key custody

The two call sites that need to co-sign a Bitcoin release (`/api/cosign` and the repay-watcher relayer) resolve their signer through a single shared function, `resolveProtocolSigner`, rather than each hardcoding a custody assumption. It prefers an AWS KMS asymmetric key (`ECC_SECG_P256K1` / `ECDSA_SHA_256` — the same curve Bitcoin uses): the private key material never leaves KMS, and every signature is an authenticated `kms:Sign` call, audit-logged via CloudTrail.

When KMS isn't configured, the same function falls back to a WIF-encoded key read from an environment variable (`PROTOCOL_SIGNING_KEY`) — the custody model Writz used before KMS. This exists to unblock testnet/signet operation when KMS setup is delayed (for example, while an AWS account identity-verification hold is being resolved), not as a permanent alternative: it reintroduces the exact risk the KMS migration closed (a compromised host or leaked environment variable exposes the key outright, with no HSM boundary). To keep that fallback from silently becoming the mainnet posture, `resolveProtocolSigner` refuses it unconditionally on `bitcoin.networks.bitcoin` — a deployment misconfigured for mainnet fails loudly at startup instead of running with a weaker custody model than the rest of this document assumes. KMS takes priority whenever both are configured, so setting `KMS_KEY_ID` is the only step needed to move a given deployment off the fallback.

### Trusted setup ceremony

Groth16 requires a per-circuit trusted setup. `circuits/scripts/ceremony/` implements the full production runbook: fetching and checksum-verifying the Hermez Phase-1 ptau (`00_fetch_ptau.sh`, deliberately requiring a human-pinned, PR-reviewed checksum rather than a hardcoded one), the coordinator's per-circuit setup (`01_new_zkey.sh`), interactive participant contribution with no scripted entropy (`02_contribute.sh`), independent transcript verification (`03_verify_transcript.sh`), and final key export plus manifest generation (`04_export.js`). A CI job re-verifies the committed manifest's hashes and IC lengths on every PR touching `circuits/keys/**`, and rejects any transcript containing a dev-labeled participant. Running the actual multi-party ceremony — recruiting independent participants and executing the runbook publicly — is an operational milestone tracked in the [roadmap](../roadmap/roadmap.md), not something further engineering work can complete on its own.

### Liquidation privacy and debt disclosure

For deposit, borrow, and repay, collateral and debt amounts are fully hidden by the ZK commitment scheme. Liquidation is the one operation where this breaks down: a keeper must know how much USDC to repay, so `usdc_debt` is necessarily published on-chain at liquidation time. What the circuit guarantees is that this published amount is *provably correct* — `liquidation.circom` binds it directly to the private commitment (`usdc_debt <== debt_stroops`) as a circuit output, so there is no caller-supplied field a keeper could misdeclare. A future keeper network where amounts are learned through encrypted off-chain channels, or committed-but-not-revealed bidding, only becomes worth building once multiple competing keepers exist for such a scheme to protect against — see the keeper model below.

### Cross-chain repayment automation

Repayment isn't atomic across Stellar and Bitcoin: a user repays USDC on Soroban, and only afterward does the protocol co-sign the Bitcoin release. For `private-lend`'s plaintext flow, a relayer service (`relayer/src/repay-watcher/`) closes the gap between those two steps automatically — it polls Soroban RPC for repayment events from a cursor persisted in SQLite (never "from now" on restart, so no event that fires during an outage is silently skipped), reconstructs and co-signs the release PSBT, and publishes it on-chain for the user to broadcast. For `commitment-tree`'s ZK flow, this can't be fully automated with the current design — cosigning requires the user's own private witness (collateral, secret, nonce), which the backend does not and should not custody outside of the keeper model described below. Those positions rely on manual cosign submission or the CLTV timelock as the safety valve. In both flows, the bound on how long a user can be "stranded" (repaid on Stellar, BTC still locked) is `loan_duration + a fixed recovery buffer`, after which the timelock path is always available regardless of protocol availability.

### Keeper model and liquidation permissionlessness

`commitment-tree::liquidate` requires only the caller's own authorization and a valid Groth16 proof of undercollateralization — there is no keeper allowlist to bypass, so it is permissionless by construction. `private-lend::liquidate` (plaintext positions, no ZK privacy at stake) additionally supports a stale-keeper fallback: the designated keeper may always liquidate an undercollateralized position, and after a configurable window (default 24h) with no keeper activity, any caller with a valid proof may do so instead. Liquidation safety never depends on caller identity — only on whether the position is actually undercollateralized — so this fallback improves liveness without weakening the collateralization check itself.

The keeper does need to custody position preimages off-chain to monitor health ratios in the first place, which means Writz-as-keeper-operator can see position details that no on-chain observer or third-party liquidator can. This is an accepted architectural trade-off for the current phase (privacy-against-observers, not privacy-against-the-operator) rather than a bug — decentralizing it requires a keeper network with its own coordination/staking design, tracked as future work.

---

## What Writz Can Do

- Co-sign BTC release transactions when a loan is fully repaid
- Refuse to co-sign if a loan is outstanding (keeping BTC locked)
- Operate the keeper service that monitors for undercollateralized positions
- Pause borrowing and liquidation if oracle prices are stale
- Update the oracle contract address (admin function, no user impact)

## What Writz Cannot Do

- Move BTC unilaterally — no valid Bitcoin transaction can be constructed without the user's signature
- See individual position details — the ZK privacy layer prevents this at the cryptographic level
- Block the emergency time-lock recovery — Condition B in the P2WSH script requires no Writz involvement
- Censor a specific user's repayment — any user can call `repay` on the Stellar contract
- Prevent the ZK verifier from accepting valid proofs

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
- Access any user position data (ZK commitments on Stellar remain private)

An attacker could:
- Refuse to co-sign repayment releases (effectively locking users out of Condition A) — users fall back to Condition B time-lock
- Generate invalid co-signatures for transactions where loans haven't been repaid — invalid because the Stellar contract checks repayment before the event is emitted

**Phase 2 mitigation:** The co-signing key is replaced with a threshold MPC scheme (Protocol 27). Compromising the co-signing key requires compromising multiple independent parties simultaneously.

### "The oracle reports a wrong price"

If the BTC/USD price is manipulated downward:
- Healthy positions could appear undercollateralized and be liquidated
- Liquidations at the wrong price transfer BTC to liquidators at below-market value

**Mitigations:**
- Median of two independent oracles (RedStone + Pyth) — manipulating the median requires moving both
- Staleness check: price data older than 90 seconds is rejected; liquidations are paused
- Progressive TVL caps limit the maximum exposure during early operation

### "A bug exists in the Soroban contracts"

**Before audit:** The protocol operates on testnet only with no real funds.

**After audit, pre-mainnet:** All findings are remediated before mainnet launch. The Audit Bank engagement covers both the Soroban contracts and the ZK circuits.

**Post-mainnet:** A whitehat bug bounty program is active with up to $50,000 in rewards for critical findings. TVL caps limit damage during early operation. An on-chain insurance fund (seeded from protocol fees) provides backstop coverage.

### "A user loses their position data (ZK secret)"

A user's ZK position data (commitment secret, nonce) exists only in their local browser storage. If this data is lost:

- The user cannot generate ZK proofs to borrow, repay, or close their position
- The Writz team cannot recover the data — it was never stored on-chain
- The user must wait for the time-lock to expire and recover BTC via Condition B
- Any USDC already borrowed is kept by the user; the loan cannot be formally repaid without the ZK secret

**Mitigation:** The Writz app will prompt users to export and securely back up their position data. This is analogous to backing up a seed phrase — the user is responsible.

### "A ZK circuit has a soundness bug"

A soundness bug means an attacker can generate a valid-looking proof for a false statement — for example, proving they have a 150% collateral ratio when they don't.

**Impact:** An attacker could borrow USDC without adequate collateral. If undetected, they could drain the USDC pool.

**Mitigations:**
- Veridise specializes in ZK circuit audits — they are a target auditor for the circuits
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

**Next:** [Audits →](audits.md)
