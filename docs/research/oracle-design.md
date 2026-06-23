# Research: BTC/USD Price Oracle on Stellar

**Author:** Research
**Date:** 2026-06-22
**Status:** Complete

---

## Overview

PrivateLend requires a reliable, manipulation-resistant BTC/USD price feed to:
1. Calculate collateral ratios (how much USDC a user can borrow against their BTC)
2. Determine when a position is liquidatable (BTC value dropped below liquidation threshold)
3. Compute fair liquidation prices

Oracle manipulation is the #1 attack vector in DeFi lending protocols. This document evaluates the oracle landscape on Stellar and recommends a strategy.

---

## Available Oracles on Stellar (2026)

### 1. RedStone — RECOMMENDED PRIMARY

**Live on Stellar mainnet since:** March 4, 2026
**BTC/USD feed:** Available
**Standard:** SEP-40 (Stellar oracle standard)

**Architecture:** RedStone uses a "pull oracle" model — price data is published off-chain and pulled on-chain only when needed (at transaction time), rather than being pushed on-chain continuously. This is more gas-efficient and avoids stale data.

**Key metrics:**
- $8.5B+ Total Value Secured across 70+ blockchains
- 180+ protocols using RedStone
- Zero mispricing events in production
- Sub-second latency price updates
- Deviation-based updates: new price pushed when market moves >threshold
- Time-based updates: daily minimum refresh during low volatility
- SEP-40 compliant: standardized interface for Stellar protocols

**Data sources:** RedStone sources from institutional market participants — trading firms, market makers, exchanges. 30–60 publishers per major feed (BTC/USD). Single publisher failure has zero impact on the aggregated value.

**Blend integration:** Blend (Stellar's major lending protocol) is already preparing to integrate RedStone feeds. This means the same infrastructure Writz will use is battle-tested in the ecosystem's existing lending product.

**Why this matters for Writz:** RedStone is the most mature, production-ready oracle on Stellar. It's already Blend-compatible, has the SEP-40 standard interface, and has proven zero mispricing. It should be Writz's primary BTC/USD source.

### 2. Pyth Network

**Status on Stellar:** Available (price feeds live)
**BTC/USD feed:** Available, 30–60 publishers

**Architecture:** Pull oracle. Pyth publishes prices off-chain through a Wormhole-based price service; contracts pull the price on-demand during transaction execution.

**Key metrics:**
- Large publisher network for BTC/USD (30–60 institutional publishers)
- Sub-second latency
- Proven across 60+ blockchains
- Core upgrade scheduled July 31, 2026 (requires API key for users)

**Note on July 2026 API key requirement:** Pyth's Core upgrade introduces API key requirements for data consumers. This is a dependency Writz must track — accessing Pyth prices may require an API key after July 31, 2026.

### 3. SEP-40 Standard

SEP-40 is Stellar's native oracle interface standard. RedStone adopted it in June 2026 for RWA assets. Any SEP-40-compatible oracle can be swapped in without contract changes — Writz should build against the SEP-40 interface, not against a specific oracle provider.

**SEP-40 assets live (June 2026):** USDC, EURC, XLM, PYUSD, and several tokenized instruments. BTC/USD via RedStone is available.

---

## Oracle Manipulation Attack Vectors

### 1. Flash loan oracle manipulation

An attacker takes a large flash loan, moves the price of BTC on a DEX (if the oracle reads from a DEX), liquidates an undercollateralized position at the manipulated price, repays the flash loan.

**Writz exposure:** LOW — Writz uses off-chain institutional price feeds (RedStone, Pyth), not on-chain DEX prices. Off-chain feeds cannot be manipulated by on-chain flash loans.

### 2. Single oracle failure / manipulation

A single oracle source fails, is manipulated, or goes stale. All lending decisions are made on bad data.

**Mitigation:** Use multiple independent oracles and take the **median** price. A median of 3 sources requires 2 to be simultaneously wrong to affect the result.

### 3. Oracle front-running

An attacker observes a large price update in the mempool (or before it's applied) and liquidates positions milliseconds before the update executes.

**Writz exposure:** MEDIUM — On Stellar, front-running is harder than on Ethereum (no public mempool in the same way), but not impossible. Mitigation: require a price confirmation delay of 1–2 ledgers (~5–10 seconds) before acting on a new price for liquidations.

### 4. Stale price data

The oracle hasn't updated in a long time. The contract uses an outdated price that doesn't reflect current market conditions.

**Mitigation:** Reject any price older than X minutes (e.g., 60 minutes for BTC/USD). If no fresh price is available, the protocol enters a "price paused" state — no new borrows or liquidations until a fresh price is available. Existing positions are safe.

---

## Recommended Oracle Architecture for Writz

### Multi-oracle median design

```
Price sources:
├── RedStone BTC/USD (primary)     → price_1
├── Pyth BTC/USD (secondary)       → price_2
└── [optional] Third source        → price_3

Aggregation:
  price = median(price_1, price_2, price_3)

Validity checks:
  - Each price must be < 60 minutes old
  - No individual price may deviate >5% from the median
  - If < 2 valid prices available → pause liquidations (not new borrows)
```

### Implementation path

Build against the **SEP-40 interface** for all oracle calls. This abstracts the specific oracle provider and allows swapping RedStone for another SEP-40-compatible provider without contract changes.

```rust
// Writz oracle consumer interface (SEP-40 compatible)
fn get_btc_usd_price(env: &Env, oracle_address: Address) -> (i128, u32) {
    // Returns (price_in_microdollars, decimals)
    let oracle: OracleContractClient = OracleContractClient::new(env, &oracle_address);
    let asset = Asset::Other(Symbol::new(env, "BTC"));
    let price_data = oracle.lastprice(&asset);
    price_data.unwrap_or_else(|| panic!("Oracle unavailable"))
}
```

### Liquidation price safety

For liquidations specifically, use a **conservative price** (slightly lower than current) to avoid liquidating based on a momentary price spike:

```
liquidation_price = min(
    current_price,
    price_5_minutes_ago  // smoothed lookback
)
```

This prevents attackers from temporarily spiking the price to trigger unfair liquidations.

---

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Primary oracle | RedStone (SEP-40) | Live on Stellar, Blend-compatible, zero mispricing history |
| Secondary oracle | Pyth | Large publisher network, independent source |
| Aggregation | Median of 2–3 sources | Resistant to single-source manipulation |
| Staleness threshold | 60 minutes | BTC/USD volatile — stale data is dangerous |
| Liquidation smoothing | min(current, 5-min lookback) | Prevents front-running and price spike exploits |
| Interface standard | SEP-40 | Provider-agnostic, future-proof |

---

*Last updated: 2026-06-22*
*Sources: [RedStone Oracle on Stellar](https://blog.redstone.finance/2026/03/04/stellar-finally-gets-the-oracle-infrastructure-it-deserves/) · [RedStone SEP-40 Standard](https://blog.redstone.finance/2026/06/04/reliability-at-scale-redstone-and-the-data-standard-for-stellars-rwa-moment/) · [Pyth BTC/USD Feed](https://www.pyth.network/price-feeds/crypto-btc-usd) · [Soroban Bitcoin Price Oracle Demo](https://github.com/stellar/sorobounty-spectacular/discussions/29)*
