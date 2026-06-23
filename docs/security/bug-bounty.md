# Bug Bounty

**Responsible disclosure program for Writz Protocol.**

If you find a security vulnerability in Writz Protocol, we want to hear from you before it becomes a problem. Report it responsibly and we will reward you fairly.

---

## Scope

The following are in-scope for the bug bounty program:

**Soroban contracts (high priority):**
- `commitment-tree` — ZK lending logic, nullifier set, Merkle tree
- `zk-verifier` — Groth16 verification, verification key management
- `bitcoin-spv` — SPV verification, SHA256d implementation, Merkle proofs
- `private-lend` — Lending mechanics, interest accrual, liquidation

**ZK circuits:**
- `deposit.circom` — Soundness issues, underconstrained signals
- `borrow_repay.circom` — Collateral ratio enforcement, state transition
- `liquidation.circom` — Undercollateralization proof, usdc_debt binding
- `merkle.circom` — Poseidon Merkle tree components

**Relayer service:**
- SPV proof assembly correctness
- API authentication and rate limiting
- Data integrity issues

**Out of scope:**
- Theoretical attacks that require physical access to infrastructure
- Social engineering attacks
- Denial-of-service attacks (network or application layer)
- Issues in third-party dependencies (report to the dependency maintainer)
- Issues in Stellar or Bitcoin protocols themselves
- Findings already documented in known limitations or audit reports

---

## Severity Levels and Rewards

Rewards are paid in USDC on Stellar. Amounts are guidelines — actual rewards depend on impact and quality of the report.

| Severity | Description | Reward |
|---|---|---|
| **Critical** | Theft of user funds, ZK circuit soundness bypass, unauthorized BTC access | Up to $50,000 |
| **High** | Significant fund loss risk, privacy leak of user positions, oracle manipulation | Up to $15,000 |
| **Medium** | Denial of service for a specific user, minor fund loss risk, incorrect calculations | Up to $5,000 |
| **Low** | Minor issues, incorrect error handling, non-exploitable edge cases | Up to $1,000 |
| **Informational** | Best-practice improvements, documentation issues | Recognition only |

**Critical finding examples:**
- A ZK circuit that accepts a proof where the loan-to-value constraint is not enforced
- A Soroban contract bug that allows withdrawing more USDC than was deposited
- A Bitcoin SPV verification bypass that accepts a fabricated transaction as valid

---

## How to Report

**Email:** [security@writz.io](mailto:security@writz.io)

**PGP key:** Published on Keybase at `keybase.io/writz` (coming soon)

**Include in your report:**
1. A description of the vulnerability
2. The affected component (contract name, circuit name, function name)
3. Step-by-step reproduction instructions
4. Proof of concept code or test case (if available)
5. Your assessment of impact and severity
6. Your Stellar wallet address for the reward payment

---

## Disclosure Process

1. **You submit** a report to [security@writz.io](mailto:security@writz.io)
2. **We acknowledge** within 48 hours
3. **We assess** the report and confirm the severity within 7 business days
4. **We fix** the issue; Critical/High findings are patched within 14 days
5. **We pay** the reward upon fix deployment
6. **We publish** a post-mortem (for Critical/High findings) after the fix is live and users are safe
7. **You can disclose** publicly after the fix is live and 30 days have passed — we will coordinate with you

We do not pursue legal action against researchers who follow this responsible disclosure process.

---

## Hall of Fame

Researchers who responsibly disclose valid vulnerabilities will be acknowledged here (with permission).

| Researcher | Finding | Date |
|---|---|---|
| — | — | — |

---

## Active Period

The bug bounty program is active from mainnet launch (Q4 2026). During the testnet phase, reports are accepted and recognized, but cash rewards are not yet active — the protocol does not hold user funds until mainnet.

If you find a critical issue during the testnet phase, report it anyway. We will honor the reward when mainnet launches.
