# Contract Reference

Complete public interface documentation for all four Writz Soroban contracts.

**Testnet addresses:**

| Contract | Address |
|---|---|
| `bitcoin-spv` | `CB2BD6QCSZVNZN5NLI7C5NF356WXVJDSXT6LVAQFWHHS4SZ4NCKKNIVA` |
| `zk-verifier` | `CBNZU23QGCZATJB2QMNF2K6IST2SVP7FSGCKASQNBULTWDWGANDBYLFY` |
| `commitment-tree` | `CDQCTFO3FK3M47QS47O2A4WLNPSQAQBSXBFPJ6RZEHFO5D7RY34FSBBP` |
| `private-lend` | `CAAWVMDRUPEJNELSQ6RU2VMVX5EJLQ2E77T7IXDWGMW4DGSNAGECGSWR` |

---

## bitcoin-spv

A header-chain light client: it stores Bitcoin block headers that descend from a checkpoint and proves transactions against them. See [SPV Verification](../how-it-works/spv-verification.md).

### `initialize`

```rust
pub fn initialize(env: Env, admin: Address, pow_limit_bits: u32)
```

`pow_limit_bits` is the tracked network's compact proof-of-work limit (mainnet `0x1d00ffff`, signet `0x1e0377ae`).

### `set_checkpoint`

Sets the trusted starting block. Admin only, and callable exactly once.

```rust
pub fn set_checkpoint(
    env: Env,
    caller: Address,
    height: u32,
    block_hash: BytesN<32>,
    bits: u32,
    time: u32,
    period_start_time: u32,  // Time of the block at height - height % 2016
)
```

### `set_submitter`

Restricts `submit_headers` to one address (`Some`), or reopens it to everyone (`None`). Admin only. Configure it on signet, whose block signatures the contract cannot verify.

```rust
pub fn set_submitter(env: Env, caller: Address, submitter: Option<Address>)
```

### `submit_headers`

Adds up to 16 contiguous headers. Each must link to a stored header, satisfy its proof-of-work, carry exactly the `bits` Bitcoin's difficulty rules require, and not be more than two hours in the future. Returns the best tip's height.

```rust
pub fn submit_headers(env: Env, headers: Vec<BytesN<80>>) -> u32
```

### `verify_transaction`

Verifies that a Bitcoin transaction is included in a confirmed block of the most-work chain.

```rust
pub fn verify_transaction(
    env: Env,
    block_hash: BytesN<32>,        // Stored block that holds the transaction
    merkle_proof: Vec<BytesN<32>>, // Sibling hashes from transaction to block Merkle root
    tx_index: u32,                 // Position of the transaction in the block (0-indexed)
    raw_tx: Bytes,                 // Raw non-witness transaction (must not be exactly 64 bytes)
    min_confirmations: u32,        // Minimum depth below the best tip
) -> SpvVerificationResult
```

**Returns** (`SpvVerificationResult`, defined once in the shared `spv-types` crate and used by every contract that calls into `bitcoin-spv` - not a per-contract duplicate):
```rust
pub struct SpvVerificationResult {
    pub txid: BytesN<32>,       // SHA256d of the non-witness raw transaction
    pub block_hash: BytesN<32>, // Hash of the block holding the transaction
    pub block_height: u32,      // Height of that block
    pub confirmations: u32,     // The block's depth below the best tip
}
```

There is no output-parsing/address-matching helper on-chain - a caller that needs to know which output paid a given address parses `raw_tx` itself.

**Errors if:**
- The block was never submitted (`HeaderNotFound`), is at or before the checkpoint, or is not on the most-work chain (`NotOnBestChain`)
- The block is buried under fewer than `min_confirmations` blocks
- `raw_tx` is exactly 64 bytes
- The Merkle proof does not reconstruct the stored block's Merkle root

### Reads

```rust
pub fn get_checkpoint(env: Env) -> Option<Checkpoint>
pub fn get_best_tip(env: Env) -> Option<BestTip>
pub fn get_header(env: Env, block_hash: BytesN<32>) -> Option<HeaderEntry>
pub fn get_canonical_hash(env: Env, height: u32) -> Option<BytesN<32>>
```

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

Issues a USDC loan. Amount is extracted from the ZK proof - not supplied by the caller.

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
    keeper: Address,
    relayer: Address,
    protocol_pubkey: BytesN<33>,  // Protocol co-signing key embedded in every deposit script
)
```

### `deposit`

Registers a BTC deposit. The contract rebuilds the Writz redeem script from `protocol_pubkey`, `user_pubkey` and `timelock_height`, and requires `p2wsh_script_pubkey` to be exactly its P2WSH, so only outputs locked under the protocol's co-signing key count as collateral. The timelock must fall 1,008 to 105,000 blocks above the block that confirmed the deposit.

```rust
pub fn deposit(
    env: Env,
    depositor: Address,
    block_hash: BytesN<32>,          // Stored bitcoin-spv block holding the deposit
    merkle_proof: Vec<BytesN<32>>,
    tx_index: u32,
    raw_tx: Bytes,
    p2wsh_script_pubkey: Bytes,      // Must equal the derived Writz P2WSH scriptPubKey
    timelock_height: u32,            // CLTV escape-hatch height
    user_pubkey: BytesN<33>,         // Depositor's compressed Bitcoin key
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
