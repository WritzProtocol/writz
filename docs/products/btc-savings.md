# BTC Savings

**Earn USDC yield on your Bitcoin — without selling a sat.**

BTC Savings is the third product in the Writz Protocol suite. Planned for Phase 3 (2027), it combines Bitcoin collateral with automated USDC yield routing. Your BTC stays locked on Bitcoin. The USDC you borrow against it flows automatically to the highest-yield opportunities on Stellar.

---

## What BTC Savings Does

BTC Savings is PrivateLend with automated yield routing. You deposit BTC. Writz borrows USDC against it on your behalf at a conservative LTV. That USDC is automatically deployed into yield-bearing positions on Stellar — Blend lending pools, AMM liquidity positions, and other vetted sources.

The yield accumulates in USDC. The BTC remains your collateral — protected by the same Bitcoin Script as PrivateLend. Your yield position compounds automatically. Withdraw at any time.

---

## The Value Proposition

Bitcoin holders have historically faced a binary choice: hold BTC and earn nothing, or sell BTC to deploy capital into yield-bearing assets.

BTC Savings reframes this: **hold BTC and earn USDC yield simultaneously.**

The mechanics:
- Your BTC appreciates (if it does) while it sits as collateral
- USDC yield accrues on top of BTC price performance
- You never sell your BTC
- Your position stays private behind ZK proofs

In a year where BTC rises 30% and USDC yield averages 6% APR, a BTC Savings user captures both.

---

## Risk Disclosure

BTC Savings carries the same liquidation risk as PrivateLend. If BTC price drops significantly, the auto-borrowed USDC may not be sufficient collateral. The product is designed with conservative LTV (40% vs. PrivateLend's 66%) to provide a larger safety buffer, but it is not risk-free.

The yield routing is also subject to smart contract risk in the downstream protocols where USDC is deployed. Writz vets these protocols and diversifies across multiple pools to reduce concentration risk.

---

## Architecture

BTC Savings adds one component on top of PrivateLend:

1. **Yield Router contract:** A Soroban contract that accepts USDC from the PrivateLend borrow and routes it to approved yield sources (Blend, Phoenix DEX LP, others). It maintains a live accounting of yields earned and rebalances across sources periodically.
2. **Strategy whitelisting:** Only audited, established protocols are eligible yield destinations. Writz governance (eventually WRTZ token holders) controls the whitelist.
3. **Auto-compounding:** Yield is harvested and re-deployed periodically by a keeper service.

---

## Who This Is For

- **Long-term BTC holders** who want passive income without active management
- **Mining companies** with ongoing BTC treasury that want USDC cash flow
- **Institutional treasuries** that hold BTC and need yield to offset operational costs

---

## Status

BTC Savings is planned for Phase 3 (Q3–Q4 2027), after PrivateLend is live and stable on mainnet.

---

**Back to:** [All Products →](privatelend.md)
