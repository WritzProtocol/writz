# spv-payment-check

A Soroban contract that accepts a Bitcoin payment as proof. `check_payment` calls the Writz `bitcoin-spv` contract to prove that a signet transaction is in a confirmed block, then parses the transaction to find an output that pays at least `min_sats` to `expected_script_pubkey`. Each txid is accepted once.

```rust
fn __constructor(spv: Address, min_confirmations: u32);
fn check_payment(block_hash: BytesN<32>, merkle_proof: Vec<BytesN<32>>, tx_index: u32, raw_tx: Bytes,
                 expected_script_pubkey: Bytes, min_sats: u64) -> Result<Payment, Error>;
fn is_used(txid: BytesN<32>) -> bool;
```

Errors: `1` ProofRejected (`bitcoin-spv` refused the proof; its own code is in the diagnostic events), `2` OutputNotFound, `3` AmountTooLow, `4` AlreadyUsed.

It is a standalone crate (not part of the `contracts/` workspace) and depends on `spv-types` from this repository as a git dependency pinned to a commit, for the on-chain output parser.

## Test

```bash
cargo test
```

The unit tests use a mock `bitcoin-spv` and a real signet transaction.

## Run against testnet

```bash
cargo build --release --target wasm32v1-none
stellar keys generate me --network testnet --fund
stellar contract deploy --wasm target/wasm32v1-none/release/spv_payment_check.wasm \
  --source-account me --network testnet -- \
  --spv NEWSPVID --min_confirmations 6
# prints your contract ID; use it as $ID below

TXID=NEWEXAMPLETXID
curl -s "https://api.testnet.writz.xyz/spv-proof/$TXID" > proof.json
stellar contract invoke --id $ID --source-account me --network testnet --send=no -- \
  check_payment \
  --block_hash "$(jq -r .sorobanArgs.block_hash proof.json)" \
  --merkle_proof "$(jq -c .sorobanArgs.merkle_proof proof.json)" \
  --tx_index "$(jq -r .sorobanArgs.tx_index proof.json)" \
  --raw_tx "$(jq -r .sorobanArgs.raw_tx proof.json)" \
  --expected_script_pubkey NEWEXAMPLESPK \
  --min_sats 1000
```

```json
{"block_height":NEWEXAMPLEBLOCK,"confirmations":NEWEXAMPLECONF,"sats":NEWEXAMPLESATS,"txid":"NEWEXAMPLETXINTERNAL"}
```

Drop `--send=no` to record the payment; a second call with the same proof then fails with `Error(Contract, #4)`. A wrong scriptPubKey gives `#2`, a higher `min_sats` gives `#3`, and a wrong `tx_index` gives `#1`. All of these were run on testnet on 2026-10-23, against the previous `bitcoin-spv` deployment.

The scriptPubKey of each output is on mempool.space as `scriptpubkey` (`https://mempool.space/signet/api/tx/<txid>`).
