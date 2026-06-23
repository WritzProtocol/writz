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
