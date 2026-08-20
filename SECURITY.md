# Security Policy

Writz locks real Bitcoin behind a P2WSH script and settles loans on Soroban. A
bug here can cost someone their BTC, so we would much rather hear about it from
you than read about it later.

## Reporting a vulnerability

**Use GitHub private vulnerability reporting:**

→ **https://github.com/WritzProtocol/writz/security/advisories/new**

This opens a private advisory visible only to you and the maintainers. It is the
only supported channel - please do not open a public issue for a security
finding, and do not email the addresses that appear in older documents.

If GitHub private reporting is unavailable to you for any reason, open a public
issue containing **only** the sentence "I have a security finding and need a
private channel" - no technical detail - and a maintainer will arrange one.

## What to include

1. The affected component (contract, circuit, or service, plus function name)
2. What an attacker can achieve, and under what preconditions
3. Step-by-step reproduction, ideally as a failing test
4. Your assessment of severity
5. Whether you want to be credited, and under which name

## What to expect

| Stage | Target |
|---|---|
| Acknowledgement | 48 hours |
| Severity assessment | 7 business days |
| Fix for Critical / High | 14 days |
| Public post-mortem (Critical / High) | After the fix is live |
| Coordinated public disclosure | Once the fix is live, 30 days after the report |

We will keep you in the loop through the advisory thread rather than going
quiet, and we will tell you plainly if we assess a finding as lower severity
than you did.

## Scope

In scope - the four Soroban contracts (`bitcoin-spv`, `zk-verifier`,
`commitment-tree`, `private-lend`), the three Circom circuits, the P2WSH
scripts in `bitcoin-script/`, and the SPV relayer.

Out of scope - denial of service, social engineering, findings that require
physical access to infrastructure, vulnerabilities in Stellar or Bitcoin
themselves, and issues already documented in
[`docs/security/security-model.md`](docs/security/security-model.md) or a
published audit.

Rewards, severity bands, and the Hall of Fame live in
[`docs/security/bug-bounty.md`](docs/security/bug-bounty.md). Note that the
protocol is on testnet and holds no user funds yet: cash rewards begin at
mainnet, and testnet findings are recognised now and honoured then.

## Safe harbour

We will not pursue legal action against researchers who follow this policy:
report privately, do not access or modify data belonging to others, and give us
a reasonable window to ship a fix before going public.
