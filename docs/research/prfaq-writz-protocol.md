---
title: "PRFAQ: Writz Protocol"
status: "in-progress"
created: "2026-07-19"
updated: "2026-07-19"
stage: "1-ignition"
inputs: ["docs/roadmap/vision.md", "docs/research/market-landscape.md", "docs/research/growth-strategy.md", "docs/brainstorming/brainstorming-session-2026-06-22-1000.md"]
---

<!-- coaching-notes-stage-1 -->
<!--
Concept type: commercial product (DeFi protocol, eventual token).

Explicit constraint from Sebastián: run this exercise ignoring the already-written
code/contracts/circuits entirely. The press release must be justified from customer
need forward, not from "we already built the SPV client so let's find a customer for it."

Key subagent-equivalent findings (manual research this session, not from local DB):
- Babylon Labs' Trustless Bitcoin Vaults (TBV): non-custodial BTC vaults, borrow
  stablecoins without giving up custody, no wrapping. Partnered with Aave Labs for
  native BTC-backed lending on Aave V4 (announced Dec 2025). Testnet interface live
  at btc-vaults.testnet.babylonlabs.io. Ledger integration (Mar 2026), GoMining
  partnership targeting 1,000 BTC activated (May 2026). NO privacy/ZK feature found.
  NO Stellar presence found. Well-funded, large existing BTC-staker distribution.
- Xoxno (github.com/XOXNO/rs-lending-xlm): generic Soroban money market, SAC-based,
  v1.0.0 tagged 2026-07-18 (one day before this session). No Bitcoin support. Not a
  BTC competitor — a new entrant into Writz's USDC-lender liquidity competition
  (same pool as Blend/Slender/Hatom/Laina/Alula/Peridot/HiYield).
- IMPORTANT GAP: docs/research/market-landscape.md (dated 2026-06-22) claims "None
  are on Stellar" and lists no Babylon TBV entry, despite the Aave V4 partnership
  predating that document by ~3 months. That doc needs a refresh — flagged to
  Sebastián, not yet corrected.

Why this direction over alternatives: existing vision.md/growth-strategy.md already
define a specific primary customer (Segment 1 — Sophisticated Bitcoin Holder, 0.5-10
BTC, held 2+ years, DeFi-skeptical) with real message-market fit language tested
("Borrow USDC against your BTC without giving it to anyone. No custodian. No KYC.
No public position."). Fast-tracked past extended discovery on customer identity
because this groundwork already exists and is specific (not "everyone"). Did NOT
fast-track past the harder question the existing docs never answered: why Stellar,
specifically, now that a funded competitor proves the Ethereum/Aave version of this
thesis works. That's the live pressure point for Stage 2.
-->
