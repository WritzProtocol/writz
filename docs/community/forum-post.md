# Stellar Developer Forum — Announcement Post

**Target:** Stellar Discord `#soroban` and `#defi` channels, or Stellar Developer community forums.
**Tone:** Technical builder sharing real work. Not a pitch. Shows code, asks questions.
**Length target:** 400–600 words.

---

## Post (copy-paste ready)

---

**[BUILDING] Writz Protocol — Bitcoin SPV client on Soroban + ZK-private lending**

Hey everyone — I've been building a Bitcoin DeFi protocol on Stellar for the past few weeks and wanted to share some progress and get community feedback on a few technical decisions.

**What it is:**
Writz Protocol lets users deposit real BTC (from a Bitcoin wallet, not a bridge) into a P2WSH locking script, submit an SPV proof to a Soroban contract, and borrow USDC against their BTC collateral — with positions hidden by ZK proofs.

The key differentiator vs. everything else in BTCfi: no custodian, no wrapped token, and no public positions.

---

**What's working on testnet today:**

1. **Bitcoin SPV contract** (Soroban) — Verifies Bitcoin transaction inclusion using stateless SPV: the caller provides 6 block headers + Merkle proof + raw tx, the contract runs SHA256d, validates the header chain, and confirms Merkle inclusion. Deployed at `CDYQRO6PZ55A3AMJQBHDEUUCQTSVHHRWQW7WSDX7CBX6FQ2NLKYCPLVC` on Soroban testnet. 28 tests passing.

2. **SPV Relayer service** (Node.js / Blockstream Esplora) — REST API that fetches block headers + Merkle proof for any confirmed Bitcoin txid and formats the `sorobanArgs` ready for contract invocation. Running locally, will be hosted publicly before SCF application.

3. **P2WSH script library** (TypeScript) — Generates unique deposit addresses from `(protocol_key, user_key, cltv_timelock)`. Builds and finalizes PSBTs for both spending paths: co-signed release (Path A) and emergency timelock recovery (Path B). Tested against real Signet addresses.

4. **PrivateLend contract** (Soroban) — Skeleton lending contract: calls the SPV contract cross-contract, parses the raw Bitcoin tx on-chain to verify the P2WSH output satoshi amount (no trusted off-chain data), creates per-entry positions in persistent storage (per CertiK's unbounded instance storage warning), implements the kinked interest rate model (Uoptimal=75%, slope1=8%, slope2=200%), and handles the full deposit→borrow→repay→liquidate lifecycle. 50 tests passing. 23.7 KB WASM.

---

**Two things I'd love community input on:**

**1. Cross-contract call to the SPV contract from PrivateLend:**
I'm using `env.invoke_contract` with a locally defined `SpvResult` struct that mirrors `VerificationResult` from the bitcoin-spv contract (same field order → same Val encoding). Is there a more idiomatic way to do cross-contract calls without importing the callee crate? Should I be using `contractimport!`?

**2. Protocol 27 (Zipper) and co-signing key architecture:**
The protocol holds a co-signing key for the P2WSH script's `<protocol_pubkey>`. Protocol 27 introduces `delegate_account_auth`. Has anyone explored using delegated account auth to build a distributed co-signing architecture on the Stellar side? Trying to understand if this could replace or complement the MPC approach for the protocol key.

---

**Links:**
- Docs: [coming to Mintlify (docs.writz.io) before the SCF application]
- GitHub: [going public before SCF application]
- Testnet contract: `CDYQRO6PZ55A3AMJQBHDEUUCQTSVHHRWQW7WSDX7CBX6FQ2NLKYCPLVC`

Happy to share code snippets or dig deeper on any of this. Feedback very welcome.

---

## Posting instructions

1. Join **discord.gg/stellar** → navigate to `#soroban` channel
2. Post the above (starting from the bold title line)
3. Within 2 hours, also post a shorter version in `#defi`:

> **Short version for `#defi`:**
> Building Writz Protocol — trustless BTC collateral on Stellar via P2WSH locking + Soroban SPV verification + ZK-private lending positions. SPV contract live on testnet, PrivateLend skeleton working. Happy to chat about the architecture. More detail in `#soroban` → [link to your soroban post].

4. Engage with any replies within 24 hours — ask follow-up questions, share code if asked.
