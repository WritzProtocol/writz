# GitHub Discussion Draft

**Target repository:** `stellar/stellar-protocol`
**Discussion category:** Ideas / Show and Tell
**Purpose:** Contribute to the ecosystem conversation while introducing Writz.
  Demonstrates technical depth and Stellar protocol knowledge to SCF reviewers who check GitHub history.

---

## Discussion Title

**Pattern: Stateless Bitcoin SPV on Soroban — lessons from implementing SHA256d + Merkle verification**

---

## Discussion Body (copy-paste ready)

---

I've been building a Bitcoin SPV verification contract on Soroban as the trust foundation for a BTC-collateralized lending protocol. Wanted to share some implementation patterns and observations for anyone else working on cross-chain verification on Stellar.

### What stateless SPV means

Traditional Bitcoin relay approaches (BTC Relay on Ethereum, etc.) store the entire Bitcoin block header chain on-chain and require continuous relayer activity. Writz uses stateless SPV instead: the caller provides the relevant data at verification time, and the contract verifies without storing state.

This has a key practical implication: the relayer is a **convenience service**, not a **protocol dependency**. Users can fetch their own headers from any public Bitcoin full node (Blockstream Esplora, mempool.space) and submit directly. If the relayer goes down, the protocol keeps working.

### What I found building SHA256d in Soroban

Bitcoin uses double-SHA256 (SHA256d) as its primary hash function — block hashes, txids, and Merkle tree nodes are all computed this way. On Soroban SDK v26, `env.crypto().sha256(data)` gives you the first pass, and `sha256(sha256(data))` gives you SHA256d:

```rust
pub(crate) fn sha256d(env: &Env, data: &Bytes) -> BytesN<32> {
    let first = env.crypto().sha256(data);
    let first_bytes: Bytes = first.into();
    env.crypto().sha256(&first_bytes)
}
```

This uses native host functions rather than a Rust SHA256 implementation — significantly cheaper in instructions.

### Header chain validation cost

Each block header is 80 bytes. Validating a 6-header chain (6 confirmations) requires:
- 6× SHA256d for header hashes (to verify the `prev_block_hash` links)
- 1× SHA256d to extract the block hash for the return value
- The Merkle proof verification (log₂n SHA256d operations)

In practice: a 6-header chain + 12-sibling Merkle proof costs roughly 30–40M Soroban instructions. Well within the single-transaction limit.

### Pattern: per-entry persistent storage for user data

The contract stores nothing itself — it's fully stateless. But the PrivateLend contract that calls it stores one `Position` per Bitcoin txid using keyed persistent storage:

```rust
#[contracttype]
pub enum DataKey {
    Position(BytesN<32>),      // keyed by Bitcoin txid — never grows as a collection
    SupplyBalance(Address),
    Config,
    Protocol,
}
```

This avoids the unbounded instance storage growth vulnerability that the Soroban Audit Bank flags as a critical risk category. If you're building on Soroban: never push into a `Vec` or `Map` stored at the instance level. Always key into persistent storage instead.

### Cross-contract call pattern for the SPV verification

The PrivateLend contract calls the SPV contract at deposit time:

```rust
let spv_result: SpvResult = env.invoke_contract(
    &config.spv_contract,
    &Symbol::new(&env, "verify_transaction"),
    (headers, merkle_proof, tx_index, raw_tx, min_confirmations).into_val(&env),
);
```

The `SpvResult` type is defined locally in PrivateLend with the same field order as `VerificationResult` in the SPV contract — Soroban's Val encoding makes them wire-compatible as long as the `#[contracttype]` fields match. Curious if there's a more idiomatic pattern (maybe `contractimport!` with a pinned WASM hash?) that others have used for stable cross-contract interfaces.

### What's next

Building toward the full deposit → ZK-proof → borrow → repay cycle. The ZK privacy layer will use Circom + Groth16 on Stellar's Protocol X-Ray BN254 operations (Protocol 25, January 2026).

Happy to share the full contract code when the repo goes public (before SCF application). Would love to hear if anyone else has worked on Bitcoin cross-chain verification on Stellar.

---

## Posting instructions

1. Go to `https://github.com/stellar/stellar-protocol/discussions`
2. Click **New discussion**
3. Select category: **Ideas** (or "General" if Ideas isn't available)
4. Title: `Pattern: Stateless Bitcoin SPV on Soroban — lessons from implementing SHA256d + Merkle verification`
5. Body: paste the content above (starting from "I've been building...")
6. Add labels if available: `soroban`, `cross-chain`
7. Submit

**After posting:**
- Watch for responses and reply within 24 hours
- If SDF team members engage (Tyler van der Hoeven, or others), that's a strong signal for SCF
- Link to this discussion in your SCF application as evidence of community engagement

---

## Alternative: stellar-community repo

If stellar/stellar-protocol feels too formal, post in:
`https://github.com/stellar/stellar-community/discussions`

Same content works, slightly less technical audience.
