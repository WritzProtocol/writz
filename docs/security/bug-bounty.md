---
title: "Bug Bounty"
---

**Responsible disclosure program for Writz Protocol.**

> ### [WARNING] Not yet active - no cash rewards are payable today
>
> Writz runs on **testnet only** and holds no user funds. The paid bug bounty
> starts at mainnet launch (targeted Q2 to Q3 2027); the reward amounts below are the
> **planned** bands for that program, not offers we can honour right now.
>
> **Please still report findings.** During testnet we acknowledge, fix, and
> credit them. A report made during testnet is never paid, and the mainnet
> program will not be retroactive: it will cover only reports made after it
> opens. We would rather say so plainly than have you assume otherwise.

If you find a security vulnerability in Writz Protocol, we want to hear from you
before it becomes a problem.

---

## Scope

The following are in-scope for the bug bounty program:

**Soroban contracts (high priority):**
- `bitcoin-spv` - header validation, difficulty, reorgs, Merkle proofs
- `writz-lend` - Lending mechanics, interest accrual, liquidation

**Bitcoin scripts:**
- `bitcoin-script` - P2WSH script construction and the spending paths

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

## Severity Levels and Rewards (planned - from mainnet launch)

Rewards will be paid in USDC on Stellar once the program is active. Amounts are
guidelines - actual rewards depend on impact and quality of the report. **None of
these are payable during the testnet phase**; see the notice at the top.

| Severity | Description | Reward |
|---|---|---|
| **Critical** | Theft of user funds, unauthorized BTC access | Up to $50,000 |
| **High** | Significant fund loss risk, oracle manipulation | Up to $15,000 |
| **Medium** | Denial of service for a specific user, minor fund loss risk, incorrect calculations | Up to $5,000 |
| **Low** | Minor issues, incorrect error handling, non-exploitable edge cases | Up to $1,000 |
| **Informational** | Best-practice improvements, documentation issues | Recognition only |

**Critical finding examples:**
- A Soroban contract bug that allows withdrawing more USDC than was deposited
- A Bitcoin SPV verification bypass that accepts a fabricated transaction as valid

---

## How to Report

**Open a private GitHub security advisory:**
[github.com/WritzProtocol/writz/security/advisories/new](https://github.com/WritzProtocol/writz/security/advisories/new)

Only you and the maintainers can see it, and it gives us a thread to coordinate
the fix in. See [`SECURITY.md`](https://github.com/WritzProtocol/writz/blob/main/SECURITY.md)
for the full policy.

> **There is no security mailbox.** The private advisory is the only supported
> channel. Do not email the addresses that appear in older documents.

**Include in your report:**
1. A description of the vulnerability
2. The affected component (contract name, function name)
3. Step-by-step reproduction instructions
4. Proof of concept code or test case (if available)
5. Your assessment of impact and severity
6. Whether you want to be credited, and under which name

---

## Disclosure Process

1. **You submit** a [private advisory](https://github.com/WritzProtocol/writz/security/advisories/new)
2. **We acknowledge** within 48 hours
3. **We assess** the report and confirm the severity within 7 business days
4. **We fix** the issue; Critical/High findings are patched within 14 days
5. **We pay** the reward upon fix deployment (mainnet program only, for reports made after it opens)
6. **We publish** a post-mortem (for Critical/High findings) after the fix is live and users are safe
7. **You can disclose** publicly once the fix is live, 30 days after the report - we will coordinate with you

We do not pursue legal action against researchers who follow this responsible disclosure process.

---

## How We Triage

Every report is checked against the current code on `main` before we assign a
severity. We close reports that describe code that does not exist or has been
removed, that repeat a finding already reported, or that we cannot reproduce on
the current code. Generated or automated submissions without a working
reproduction are closed with a short reply. A failing test is the fastest way to
show us a real issue.

---

## Hall of Fame

Researchers who responsibly disclose valid vulnerabilities will be acknowledged here (with permission).

| Researcher | Finding | Date |
|---|---|---|
| - | - | - |

---

## Active Period

The bug bounty program is active from mainnet launch (Q2 to Q3 2027). During the testnet phase, reports are accepted and recognized, but cash rewards are not yet active - the protocol does not hold user funds until mainnet.

If you find a critical issue during the testnet phase, report it anyway: it is fixed before real funds are at stake, and you are credited for it. Testnet reports are not paid, now or after mainnet launch.
