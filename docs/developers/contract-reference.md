# Contract Reference

Complete public interface documentation for all four Writz Soroban contracts.

**Testnet addresses:**

| Contract | Address |
|---|---|
| `bitcoin-spv` | `CAE5L7BO2GNF7MIZWXB2BTUMLYNIMQZUSWN2BWLZQS7HRHLOUSL6VLWJ` |
| `zk-verifier` | `CDV45GLXG4AOU6BDZSY5YHHVNGQIAYAPD3PUGXIIIYLIO6V2XGO6SMFV` |
| `commitment-tree` | `CDFAP3J4WLFZC2N5U66X5EO62POBBIBXOKCCMCM3IRLJNXT73C4IBKA7` |
| `private-lend` | `CCLH2GJYG3QSHZJI7V7VK3DNMNK3I3QJCECBSFGX3AC6CK4I7EF7ZJ2G` |

---

## bitcoin-spv

### `verify_transaction`

Verifies that a Bitcoin transaction is included in a confirmed block. Stateless — no headers are stored on-chain.

```rust
pub fn verify_transaction(
    env: Env,
    headers: Vec<Bytes>,          // Raw 80-byte Bitcoin block headers, ordered oldest→newest
    merkle_proof: Vec<BytesN<32>>, // Sibling hashes from transaction to block Merkle root
    tx_index: u32,                 // Position of the transaction in the block (0-indexed)
    raw_tx: Bytes,                 // Complete raw Bitcoin transaction (serialized)
    min_confirmations: u32,        // Minimum number of confirmations required
) -> VerificationResult
```

**Returns:**
```rust
pub struct VerificationResult {
    pub txid: BytesN<32>,      // Double-SHA256 of the raw transaction (little-endian)
    pub block_hash: BytesN<32>, // Double-SHA256 of the first header (little-endian)
    pub confirmations: u32,    // Number of headers provided (= number of confirmations)
    pub outputs: Vec<TxOutput>,
}

pub struct TxOutput {
    pub value: u64,      // Output value in satoshis
    pub address: String, // Bitcoin address derived from the output script
}
```

**Panics if:**
- Any header fails PoW validation (`SHA256d(header) ≥ target`)
- The header chain is not continuous (`headers[i].prev_block ≠ SHA256d(headers[i-1])`)
- The Merkle proof does not reconstruct `headers[0].merkle_root`
- `headers.len() < min_confirmations`

---

## zk-verifier

### `initialize`

Sets the admin address and initializes the contract. Call once after deployment.

```rust
pub fn initialize(env: Env, admin: Address)
```

### `set_vkey`

Stores a Groth16 verification key for a circuit type. Admin only.

```rust
pub fn set_vkey(
    env: Env,
    circuit: CircuitType,   // Deposit | BorrowRepay | Liquidation
    vkey: VerificationKey,
)
```

```rust
pub enum CircuitType {
    Deposit,
    BorrowRepay,
    Liquidation,
}

pub struct VerificationKey {
    pub alpha: G1Point,
    pub beta: G2Point,
    pub gamma: G2Point,
    pub delta: G2Point,
    pub ic: Vec<G1Point>,  // One per public signal + 1
}
```

### `verify_groth16`

Verifies a Groth16 BN254 proof against a stored verification key.

```rust
pub fn verify_groth16(
    env: Env,
    circuit: CircuitType,
    proof: Groth16Proof,
    public_signals: Vec<BytesN<32>>,  // Public inputs, in circuit order
) -> bool
```

```rust
pub struct Groth16Proof {
    pub a: G1Point,  // 64 bytes (BN254 G1, uncompressed)
    pub b: G2Point,  // 128 bytes (BN254 G2, uncompressed)
    pub c: G1Point,  // 64 bytes
}
```

**Returns:** `true` if the proof is valid. `false` if the pairing check fails. Transaction panics (host rejects) if the proof contains invalid curve points.

---

## commitment-tree

### `initialize`

```rust
pub fn initialize(
    env: Env,
    admin: Address,
    zk_verifier: Address,    // Address of the deployed zk-verifier contract
    spv_contract: Address,   // Address of the deployed bitcoin-spv contract
    usdc_token: Address,     // USDC token contract address
    oracle: Address,         // BTC/USD oracle contract address (SEP-40)
)
```

### `deposit`

Verifies a Bitcoin deposit (via SPV) and a ZK deposit proof, then queues a commitment for insertion.

```rust
pub fn deposit(
    env: Env,
    spv_proof: SpvProofArgs,  // headers, merkle_proof, tx_index, raw_tx
    zk_proof: ZkProofArgs,    // Groth16 proof + public signals [commitment, txid]
    expected_address: String, // P2WSH address this deposit was sent to
)
```

**Emits:** `DepositVerified { txid: BytesN<32>, commitment: BytesN<32> }`

### `insert_commitment`

Inserts the next pending commitment into the Poseidon Merkle tree. Admin only in Phase 1.

```rust
pub fn insert_commitment(env: Env) -> BytesN<32>  // Returns new Merkle root
```

**Emits:** `CommitmentInserted { commitment: BytesN<32>, root: BytesN<32>, index: u32 }`

### `borrow`

Issues a USDC loan. Amount is extracted from the ZK proof — not supplied by the caller.

```rust
pub fn borrow(
    env: Env,
    borrower: Address,
    zk_proof: ZkProofArgs,       // Proof: commitment in tree, collateral ratio met
    new_commitment: BytesN<32>,  // Commitment for the updated position state
) -> i128  // USDC amount transferred (in stroops: 1 USDC = 10,000,000 stroops)
```

**Emits:** `Borrowed { nullifier: BytesN<32>, new_commitment: BytesN<32>, amount: i128 }`

### `repay`

Repays outstanding USDC debt (full or partial).

```rust
pub fn repay(
    env: Env,
    repayer: Address,
    zk_proof: ZkProofArgs,       // Proof: commitment in tree, repay amount valid
    new_commitment: BytesN<32>,  // Commitment for updated position state
) -> i128  // USDC amount repaid
```

**Emits:** `Repaid { nullifier: BytesN<32>, new_commitment: BytesN<32>, amount: i128 }`

### `liquidate`

Liquidates an undercollateralized position. The `usdc_debt` amount is extracted from the proof.

```rust
pub fn liquidate(
    env: Env,
    liquidator: Address,
    zk_proof: ZkProofArgs,       // Proof: commitment in tree, health ratio < 120%
    new_commitment: BytesN<32>,  // New commitment (zeroed position)
)
```

**Emits:** `Liquidated { nullifier: BytesN<32>, usdc_debt: i128 }`

### `supply_usdc`

Supplies USDC to the lending pool.

```rust
pub fn supply_usdc(env: Env, supplier: Address, amount: i128) -> i128
```

### `withdraw_supply`

Withdraws USDC from the lending pool.

```rust
pub fn withdraw_supply(env: Env, supplier: Address, amount: i128) -> i128
```

### `get_merkle_root`

Returns the current Poseidon Merkle root.

```rust
pub fn get_merkle_root(env: Env) -> BytesN<32>
```

### TTL Refresh Functions (permissionless)

```rust
pub fn refresh_nullifier_ttl(env: Env, nullifier: BytesN<32>)
pub fn refresh_commitment_ttl(env: Env, commitment: BytesN<32>)
pub fn refresh_merkle_root_ttl(env: Env)
pub fn refresh_pool_ttl(env: Env)
pub fn refresh_supply_balance_ttl(env: Env, supplier: Address)
```

---

## private-lend

### `initialize`

```rust
pub fn initialize(
    env: Env,
    admin: Address,
    spv_contract: Address,
    usdc_token: Address,
    oracle: Address,
)
```

### `deposit`

```rust
pub fn deposit(
    env: Env,
    depositor: Address,
    spv_proof: SpvProofArgs,
    expected_address: String,
) -> BytesN<32>  // position_id (= txid)
```

### `borrow`

```rust
pub fn borrow(
    env: Env,
    borrower: Address,
    position_id: BytesN<32>,
    amount: i128,
) -> i128
```

### `repay`

```rust
pub fn repay(
    env: Env,
    repayer: Address,
    position_id: BytesN<32>,
    amount: i128,
) -> i128
```

### `liquidate`

Keeper-only in Phase 1.

```rust
pub fn liquidate(
    env: Env,
    keeper: Address,
    position_id: BytesN<32>,
    usdc_amount: i128,
)
```

### `get_position`

```rust
pub fn get_position(env: Env, position_id: BytesN<32>) -> Position

pub struct Position {
    pub depositor: Address,
    pub btc_amount_sats: u64,
    pub usdc_borrowed: i128,
    pub last_update_ledger: u32,
    pub status: PositionStatus,
}

pub enum PositionStatus {
    Active,
    Closed,
    Liquidated,
}
```

---

## Events Reference

All events use Soroban's `#[contractevent]` annotation and are emitted in the transaction ledger.

| Event | Contract | Fields |
|---|---|---|
| `DepositVerified` | commitment-tree | `txid`, `commitment` |
| `CommitmentInserted` | commitment-tree | `commitment`, `root`, `index` |
| `Borrowed` | commitment-tree | `nullifier`, `new_commitment`, `amount` |
| `Repaid` | commitment-tree | `nullifier`, `new_commitment`, `amount` |
| `Liquidated` | commitment-tree | `nullifier`, `usdc_debt` |
| `UsdcSupplied` | commitment-tree | `supplier`, `amount` |
| `UsdcWithdrawn` | commitment-tree | `supplier`, `amount` |
| `DepositCreated` | private-lend | `depositor`, `position_id`, `btc_amount_sats` |
| `Borrowed` | private-lend | `position_id`, `amount` |
| `Repaid` | private-lend | `position_id`, `amount` |
| `Liquidated` | private-lend | `position_id`, `usdc_amount` |
