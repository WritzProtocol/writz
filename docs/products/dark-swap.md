# Dark Swap

**Convert BTC to USDC directly — no exchange, no KYC, no visible order.**

Dark Swap is the second product in the Writz Protocol suite. Planned for Phase 3 (2027), it uses the same Bitcoin SPV infrastructure as PrivateLend to enable direct BTC-to-USDC conversion with ZK-private swap sizes.

---

## What Dark Swap Does

A user sends BTC to a Writz P2WSH address. The SPV contract verifies the deposit. USDC is released from the Dark Swap pool at the current oracle price. The swap size is hidden behind a ZK proof — the on-chain record shows only that a swap occurred, not for how much.

No exchange account. No KYC form. No order book that reveals your trade.

---

## How It Differs From PrivateLend

| | PrivateLend | Dark Swap |
|---|---|---|
| BTC returned? | Yes (after repayment) | No — BTC is sold |
| Output | USDC loan | USDC outright |
| Position ongoing? | Yes (active loan) | No (one-time conversion) |
| Interest? | Yes | No (one-time swap fee) |
| Use case | Liquidity without selling BTC | Converting BTC to USDC |

---

## Who This Is For

- **Bitcoin holders in LATAM** who earn or receive BTC and need USDC for expenses, without going through an exchange that requires KYC
- **Privacy-conscious users** who want to convert BTC to USDC without the transaction visible on a public order book
- **Arbitrageurs and OTC traders** who want large BTC-to-USDC conversions without moving markets

---

## Architecture

Dark Swap reuses the existing Writz infrastructure:

1. User sends BTC to a P2WSH address (no co-sign release needed — the BTC is consumed, not returned)
2. SPV contract verifies the BTC deposit
3. ZK proof validates the swap amount stays within pool limits
4. USDC is released from the Dark Swap AMM pool
5. BTC accumulates in the protocol's treasury (auctioned to arbitrageurs or used to rebalance)

The AMM-style liquidity pool on the USDC side is seeded by protocol-owned liquidity and third-party USDC LPs who earn swap fees.

---

## Status

Dark Swap is planned for Phase 3 (Q2–Q3 2027), after PrivateLend has been live on mainnet for six or more months.

The SPV contract and ZK verifier required for Dark Swap are already deployed and tested — the same contracts used by PrivateLend. The additional work is the swap AMM contract and the updated ZK circuit for swap-specific constraints.

---

**Back to:** [All Products →](privatelend.md)
