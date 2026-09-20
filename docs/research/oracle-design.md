# Research: BTC/USD Price Oracle on Stellar

**Author:** Research
**Date:** 2026-06-22
**Revised:** 2026-09-16 (web research) - primary provider recommendation corrected. **Revised again 2026-09-16 (on-chain verification)** - the web-research revision's Reflector and DIA conclusions were themselves wrong in places; superseded by directly calling the deployed contracts. See "2026-09-16 - on-chain verification pass" below, which is the current source of truth. Both superseded revisions are kept in git history, not in this file.

---

## 2026-09-16 - on-chain verification pass (current source of truth)

Everything below this point was obtained by running `contracts/scripts/verify-oracles.sh` against Stellar testnet - not by reading provider docs or blog posts. Docs go stale and get things wrong (see below); a direct contract call doesn't. Two corrections to the same-day web-research pass:

1. **Reflector does have a plain BTC/USD feed - the earlier "watch, don't wire yet" verdict was wrong.** The mistake: Reflector runs *multiple separate oracle contracts per network*, not one. Its "Stellar assets" instance (testnet `CAVLP5DH2GJPZMVO7IJY4CVOD5MWEFTJFVPD2YY2FQXOQHRGHK4D6HLP`) only lists Stellar Soroban token contracts (SolvBTC's SAC among them) - that's the instance the earlier web-research pass happened to look at, and it's the wrong one for this purpose. Its separate **"external CEXs & DEXs" instance** (testnet `CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63`) lists real market tickers - `BTC`, `ETH`, `USDT`, `XRP`, `SOL`, and 11 others - as plain `Other(Symbol)` assets, not SAC addresses. Confirmed live 2026-09-16: `lastprice({"Other":"BTC"})` returned a price of **~$76,185** (`7618536708010298807` at 14 decimals) with a timestamp matching the actual call time to within seconds - this is a real, currently-updating feed, not stale or mocked data. `resolution()` returned `300` (5 minutes), matching Reflector's documented "Pulse" free-tier cadence.
2. **DIA's documented testnet contract does not exist.** Its official docs (`diadata.org/docs/guides/chain-specific-guide/stellar`) list `CAEDPEZDRCEJCF73ASC5JGNKCIJDV2QJQSW6DJ6B74MYALBNKCJ5IFP4` as the testnet deployment. Calling it (`stellar contract info interface`) returns `Contract not found`, confirmed on two separate attempts. Stellar's own oracle-providers docs list the same address independently, so this isn't a copy-paste error on one page - either the contract was never actually deployed at that address, or it existed and was removed/archived. **DIA is parked, not secondary**, until Writz gets a working contract address directly from DIA (Discord/Telegram - their own docs say custom/production access goes through those channels anyway).

**Corrected recommendation: Pyth primary, Reflector (external-prices instance) secondary.** This resolves the "2-source median has no tiebreaker" concern the previous revision flagged - Reflector genuinely works today, so Writz doesn't need to wait on a listing request or a third source to have a real median. DIA remains a candidate third leg if a working address is obtained later.

Stellar mainnet contract addresses for reference (not yet called - Writz is testnet-only right now, and mainnet calls weren't part of this verification pass):
- Pyth verifier: `CACZ3GBAKUPIAFRILUFO27J5RUH5GJ2VSJ46LP6GJYSKGDRTQ5MS3HCH`
- Reflector, Stellar-assets instance: `CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M`
- Reflector, external CEXs & DEXs instance: `CAFJZQWSED6YAWZU3GWRTOCNPPCGBN32L7QV43XX5LZLFTK6JLN34DLN`
- Reflector, fiat exchange rates instance: `CBKGPWGKSKZF52CFHMTRR23TBWTPMRDIYZ4O2P5VS65BMHYH4DXMCJZC`

**Re-run `contracts/scripts/verify-oracles.sh` before mainnet integration** - none of this is guaranteed to still hold by the time Phase 2 oracle work actually starts. Contract addresses can be redeployed, Reflector's asset list can change, and DIA may or may not have a working address by then.

---

## 2026-09-16 revision (web research only) - superseded above, kept for the RedStone/SolvBTC finding

The original version of this document (still in git history) recommended **RedStone as primary oracle**, on the claim that "Blend is already integrating RedStone for price feeds." That claim does not hold up:

- **Blend uses Reflector, not RedStone.** Reflector is listed as a Blend integration on Stellar's own oracle-providers documentation; no independent source found confirms Blend adopting RedStone.
- **RedStone does not list Stellar among its 110+ supported chains** on its own official docs (`docs.redstone.finance`). Its Stellar-side announcements (blog posts, March/June/August 2026) describe SEP-40 feeds for RWA assets - USDC, EURC, XLM, PYUSD, tokenized sovereign debt (Etherfuse), USDY (Ondo), Centrifuge tokens - not a plain BTC/USD spot pair.
- **This part still matters even though the Reflector conclusion above was corrected:** RedStone's and Reflector's *Stellar-assets-instance* asset lists both surface **SolvBTC** (and, for Reflector, **BTCLN**) as their closest thing to "Bitcoin." Both are wrapped/custodied representations, not the L1 asset. Pricing Writz's collateral off a wrapped-BTC market price would make the liquidation threshold depend on Solv's (or a bridge's) minting integrity - the exact counterparty risk Writz's pitch ("no wrapped tokens, no custodian") exists to avoid. **Do not wire a SolvBTC or BTCLN feed into `get_btc_price_stroops` and call it the BTC price** - use Reflector's external-prices instance's plain `BTC` asset instead, confirmed above.

---

## Overview

PrivateLend requires a reliable, manipulation-resistant BTC/USD price feed to:
1. Calculate collateral ratios (how much USDC a user can borrow against their BTC)
2. Determine when a position is liquidatable (BTC value dropped below liquidation threshold)
3. Compute fair liquidation prices

Oracle manipulation is the #1 attack vector in DeFi lending protocols. This document evaluates the oracle landscape on Stellar and recommends a strategy.

---

## Available Oracles on Stellar (2026)

### 1. Pyth Network - RECOMMENDED PRIMARY

**Testnet verifier contract (confirmed live 2026-09-16):** `CAYFT5JE3UQTKT4Q6ZOZK4FXVYVT6RE3MFC7STA4UB6WAEGBT65MRU52`
**Mainnet verifier contract:** `CACZ3GBAKUPIAFRILUFO27J5RUH5GJ2VSJ46LP6GJYSKGDRTQ5MS3HCH`

**Architecture is structurally different from Reflector/DIA - this matters for the verification script and for integration effort.** Pyth's Stellar contract is a signature *verifier*, not a price reader: its interface is `verify_update(data: Bytes) -> Bytes`, plus admin functions for managing trusted signers. There is no `lastprice()`-style call that returns a currently-stored value for free. To read a Pyth price, the relayer/keeper must first fetch a signed update from Pyth's off-chain Hermes service, then submit those bytes to `verify_update` on-chain (paying the pull fee) as part of the same transaction that uses the price. **This means Pyth's BTC/USD availability could not be confirmed the same way Reflector's was** - `verify_update` needs a live signed payload as input, not just a read call. Confirming it requires either fetching a real Hermes update for the BTC/USD feed ID and test-submitting it, or checking Pyth's feed-ID registry (canonical across all chains, so if Hermes carries BTC/USD at all - which it does, it's one of Pyth's oldest and most liquid feeds - it's available on Stellar too, since Stellar's verifier doesn't whitelist feed IDs itself).

**Cost:** Per-pull fee, not a subscription. General Pyth pricing across chains runs roughly **$0.0001-0.001 per update**. No confirmed Stellar-specific fee schedule.
**Known dependency to track:** Pyth's Hermes service has moved toward requiring an API key for some tiers of off-chain consumption. Whether the free public Hermes endpoint remains usable at Writz's expected call volume needs to be confirmed directly before committing - an operational risk, not a blocker to starting integration work.

### 2. Reflector (external CEXs & DEXs instance) - RECOMMENDED SECONDARY

**Testnet contract (confirmed live 2026-09-16):** `CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63`
**Mainnet contract:** `CAFJZQWSED6YAWZU3GWRTOCNPPCGBN32L7QV43XX5LZLFTK6JLN34DLN`

**Confirmed by direct call, not docs.** `assets()` returns 16 tickers including a plain `{"Other":"BTC"}`. `lastprice({"Other":"BTC"})` returned a live price (~$76,185 at the time of the call, 14 decimals). `resolution()` is 300 seconds (5-minute cadence - this is Reflector's free "Pulse" tier, no XRF fee). `decimals()` is 14 - **note this for the Rust integration**, it's not the 7 decimals Stellar native assets use, nor a round number like 8 - `get_btc_price_stroops`'s scaling math needs to read this from the contract, not assume it.

**Do not confuse this contract with Reflector's other Stellar instance** (`CAVLP5DH2GJPZMVO7IJY4CVOD5MWEFTJFVPD2YY2FQXOQHRGHK4D6HLP` testnet / `CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M` mainnet) - that one only prices Stellar Soroban tokens against each other (including SolvBTC's SAC, which is *not* the BTC feed Writz wants) and has no plain BTC ticker.

**Audit status:** A Code4rena competitive audit of Reflector V3 ran Oct 27-Nov 11, 2025 ($20K USDC pool); final report/findings weren't confirmed as published in this research pass - check before citing this as "audited" externally.

### 3. DIA - parked, not currently usable

**Documented testnet contract:** `CAEDPEZDRCEJCF73ASC5JGNKCIJDV2QJQSW6DJ6B74MYALBNKCJ5IFP4` - **confirmed NOT live** (`Contract not found`, checked twice via `stellar contract info interface`). This is the address both DIA's own docs and Stellar's official oracle-providers docs list, so it's not a copy-paste error specific to one source.
**Action needed before DIA can be a candidate again:** get a working contract address directly from DIA (Discord/Telegram per their own docs) and re-run the verification script against it.

### 4. RedStone - removed as a candidate

Stellar isn't in RedStone's own list of 110+ supported chains; its Stellar-side SEP-40 feeds (per its own blog posts) target RWA assets (USDC, EURC, XLM, PYUSD, tokenized debt, Centrifuge tokens), not BTC/USD. Never had a testnet address to verify in the first place. Kept here only because earlier project docs (this file's pre-2026-09-16 versions, `docs/scf/application.md`, `docs/roadmap/phases.md`, `docs/security/security-model.md`, `docs/how-it-works/stellar-side.md`, `docs/architecture/technical-overview.md`, `docs/developers/contribution-guide.md`, `docs/scf/stride-threat-model.md`, `docs/research/security-audit-strategy.md`, `docs/research/blend-usdc-integration.md`, and Rust doc comments in `contracts/contracts/private-lend/src/{types,lib}.rs`) all named it as primary - those are now corrected to Pyth + Reflector.

---

## Oracle Manipulation Attack Vectors

*(Unchanged from the original analysis - still applies regardless of which providers are chosen.)*

### 1. Flash loan oracle manipulation

An attacker takes a large flash loan, moves the price of BTC on a DEX (if the oracle reads from a DEX), liquidates an undercollateralized position at the manipulated price, repays the flash loan.

**Writz exposure:** LOW - Pyth and Reflector's external-prices instance both use off-chain institutional/exchange price aggregation, not on-chain DEX prices. Off-chain feeds cannot be manipulated by on-chain flash loans.

### 2. Single oracle failure / manipulation

A single oracle source fails, is manipulated, or goes stale. All lending decisions are made on bad data.

**Mitigation:** Use multiple independent oracles and take the **median** price. With 2 confirmed-working sources (Pyth + Reflector), a median of 2 doesn't have a tiebreaker if they disagree - see "Combined-oracle design" below for how the deviation check covers this gap in practice, and treat DIA (or a third source) as worth adding once available, not as blocking launch.

### 3. Oracle front-running

An attacker observes a large price update in the mempool (or before it's applied) and liquidates positions milliseconds before the update executes.

**Writz exposure:** MEDIUM - On Stellar, front-running is harder than on Ethereum (no public mempool in the same way), but not impossible. Mitigation: require a price confirmation delay of 1-2 ledgers (~5-10 seconds) before acting on a new price for liquidations.

### 4. Stale price data

The oracle hasn't updated in a long time. The contract uses an outdated price that doesn't reflect current market conditions.

**Mitigation:** Reject any price older than X minutes (e.g., 60 minutes for BTC/USD). If no fresh price is available, the protocol enters a "price paused" state - no new borrows or liquidations until a fresh price is available. Existing positions are safe. Pyth is pull-only (price only as fresh as the last submitted update); Reflector's external instance updates on a fixed ~5-minute cadence (confirmed via `resolution()`) - the staleness threshold must account for each provider's actual cadence, not a single assumed one.

---

## Recommended Oracle Architecture for Writz

### Combined-oracle design

Combining oracles is still the right call - confirmed, not just recommended, now that both sources are known to work:

```
Price sources:
├── Pyth BTC/USD (primary)                    → price_1  - real cross-exchange price, small per-pull fee, needs a Hermes update submitted per call
└── Reflector external-prices BTC (secondary) → price_2  - confirmed live on testnet, free (Pulse tier), 5-min resolution

Aggregation:
  price = median(price_1, price_2)  # placeholder until a 3rd source (DIA, once fixed) is added

Validity checks:
  - Each price must be < 60 minutes old (Pyth: since last pull; Reflector: since resolution()-aligned update)
  - If prices deviate >5% from each other → treat as a manipulation signal, pause liquidations rather than average blindly
  - If either source is unreachable → pause liquidations (not new borrows) until both are healthy again
```

### Implementation path

Two different SDK call shapes are needed, not one shared `get_btc_usd_price` helper as originally assumed - Pyth and Reflector don't share an interface:

```rust
// Reflector (SEP-40-shaped) - a straightforward cross-contract call
fn get_reflector_btc_price(env: &Env, reflector_address: &Address) -> PriceData {
    let oracle: ReflectorClient = ReflectorClient::new(env, reflector_address);
    let asset = Asset::Other(Symbol::new(env, "BTC"));
    oracle.lastprice(&asset).unwrap_or_else(|| panic!("Reflector price unavailable"))
}

// Pyth - requires the caller (relayer/keeper) to supply a fresh signed Hermes
// update as part of the same call; the contract only verifies it, it doesn't
// store or serve a price on its own.
fn verify_pyth_update(env: &Env, pyth_address: &Address, hermes_payload: Bytes) -> Bytes {
    let verifier: PythVerifierClient = PythVerifierClient::new(env, pyth_address);
    verifier.verify_update(&hermes_payload)
        .unwrap_or_else(|_| panic!("Pyth update verification failed"))
    // Caller still needs to parse the verified bytes into (price, exponent, timestamp)
    // per Pyth's wire format - not shown here.
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

## Before wiring this in

Updated against the on-chain verification pass above:

1. ~~Call `assets()`/`lastprice()` on Pyth's, DIA's, and Reflector's live testnet contracts~~ - **done for Reflector and attempted for DIA** (see `contracts/scripts/verify-oracles.sh`). Pyth couldn't be fully verified this way since it needs a live Hermes payload, not just a read call - that's still open.
2. **Fetch a real Hermes BTC/USD update and test-submit it to Pyth's testnet verifier** (`CAYFT5JE3UQTKT4Q6ZOZK4FXVYVT6RE3MFC7STA4UB6WAEGBT65MRU52`) to close the remaining gap in Pyth verification. Needs the Hermes client/SDK, not just `stellar contract invoke`.
3. **Get a working DIA contract address** directly from DIA (their docs' listed address doesn't resolve) if DIA is still wanted as a third median leg.
4. **Confirm Pyth's Hermes access policy** (API key requirement, rate limits) at whatever call volume Writz's relayer/keeper will actually generate.
5. Re-run `contracts/scripts/verify-oracles.sh` against **mainnet** addresses before any mainnet deployment - everything confirmed above is testnet-only.
6. **Done for `private-lend` (2026-09-17):** `get_btc_price_stroops` now calls Reflector's external-prices instance live, replacing `STUB_PRICE_STROOPS_PER_BTC` - see `contracts/contracts/private-lend/src/oracle.rs`. Reads `decimals()` live rather than assuming 14, per the note above. `commitment-tree` is unchanged and still stubbed - see that crate's `oracle.rs` and `spv-types`'s doc comment for why (the ZK circuit's exact-match price signal has no tolerance window, so a live price would make honest borrows/repays fail intermittently until the circuit itself changes).
7. **Still open:** Pyth is not wired anywhere yet. `private-lend` is single-source (Reflector only) until it is - see `docs/security/security-model.md` for what that means for manipulation resistance in the interim.

---

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Primary oracle | Pyth | Real cross-exchange BTC/USD, industry standard; verification contract confirmed live on testnet, though price availability itself needs a Hermes-payload test (see "Before wiring this in") |
| Secondary oracle | Reflector, external-prices instance | Confirmed live on testnet by direct call: real `BTC` ticker, live updating price, free (Pulse tier, 5-min resolution) |
| Parked | DIA | Documented testnet contract address doesn't exist on-chain; needs a working address from DIA directly before it can be a candidate again |
| Explicitly avoided | RedStone; SolvBTC/BTCLN as "BTC"; Reflector's Stellar-assets instance for BTC | RedStone isn't on Stellar at all; SolvBTC/BTCLN are wrapped BTC, reintroducing custodian risk; Reflector's *other* instance only has SAC-token prices, not the external BTC ticker |
| Aggregation | Median of 2 confirmed-working sources, with a deviation check standing in for the missing 3rd-source tiebreaker | Both sources now confirmed live - no need to wait on a listing request before wiring in a real median |
| Staleness threshold | 60 minutes, adjusted per provider cadence | Reflector's `resolution()` (300s) and Pyth's pull-on-demand model don't update the same way |
| Liquidation smoothing | min(current, 5-min lookback) | Prevents front-running and price spike exploits |
| Interface standard | SEP-40 for Reflector; Pyth uses its own verifier pattern, not SEP-40 | Reflector is provider-agnostic within SEP-40; Pyth's integration code is provider-specific regardless |

---

*Last updated: 2026-09-16 (on-chain verification pass)*
*Sources: direct `stellar contract invoke` / `stellar contract info interface` calls against Stellar testnet (2026-09-16, via `contracts/scripts/verify-oracles.sh`) for the claims in the "on-chain verification pass" section; web research (official docs, blogs, GitHub, Stellar's oracle-providers documentation) for everything else, explicitly flagged as unverified where it hasn't been re-checked against a live contract. Re-run the verification script rather than trusting any number in this file that predates its listed "Last updated" date.*
