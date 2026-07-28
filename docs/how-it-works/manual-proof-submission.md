# Manual Proof Submission (Fallback Path)

**What to do if the Writz relayer is unavailable and you need to submit an SPV proof yourself.**

`bitcoin-spv::verify_transaction` (see [SPV Verification](./spv-verification.md)) takes `raw_tx` as the **non-witness serialization** of a Bitcoin transaction — the txid is `SHA256d(raw_tx)`, and Bitcoin's block Merkle tree is built from non-witness txids. The Writz relayer strips SegWit witness data automatically before submitting a proof. This document explains that step so a technical user can reproduce it manually if the relayer is down.

This is a **liveness** concern only: if the raw transaction bytes are stripped incorrectly, `verify_transaction` simply fails with `MerkleProofInvalid` and your deposit is rejected — it can be retried with correct bytes. No funds are ever at risk from a stripping mistake.

---

## Why stripping is needed

A SegWit transaction (P2WPKH, P2WSH, P2TR) has two serializations:

- **Full serialization** (`wtxid` form) — includes a 2-byte marker+flag (`0x00 0x01`) right after the version field, and a witness section (signatures/scripts) after the outputs.
- **Non-witness serialization** (`txid` form) — the marker+flag and witness section are removed entirely.

Bitcoin's block Merkle tree is built from `txid`s, not `wtxid`s. If you pass `bitcoin-spv` the full serialization, it computes `SHA256d` of the wrong bytes, gets the wrong txid, and the Merkle proof will not reconstruct the block's Merkle root.

Legacy (pre-SegWit) transactions have no witness data — the two serializations are identical, and no stripping is needed.

## Algorithm

This mirrors `relayer/src/bitcoin/tx.ts`'s `stripWitness` exactly:

1. Check for a SegWit marker: is `rawTx[4] == 0x00` and `rawTx[5] == 0x01`? If not, the transaction is legacy — use it unchanged.
2. Copy the 4-byte version field.
3. **Skip** the 2-byte marker+flag.
4. Copy the input count (varint) and every input unchanged (each input is `prevout (36 bytes) + scriptSig (varint-prefixed) + sequence (4 bytes)` — none of this is witness data).
5. Copy the output count (varint) and every output unchanged (`value (8 bytes) + scriptPubKey (varint-prefixed)`).
6. **Skip** the witness section: for each input (in order), read one varint (stack item count), then for each stack item read a varint (item length) and skip that many bytes.
7. Copy the final 4-byte locktime.

The result is the non-witness serialization — pass this as `raw_tx` to `verify_transaction`.

## Reference implementation

```ts
// See relayer/src/bitcoin/tx.ts for the canonical, tested implementation.
import { stripWitness, isSegwit } from "@writz/relayer/bitcoin/tx";

const rawTxHex = "..."; // full serialization, as returned by your Bitcoin node/wallet
const nonWitnessHex = stripWitness(rawTxHex); // safe no-op for legacy transactions
```

If you cannot run the relayer's TypeScript directly, implement the 7 steps above in any language — the varint format is standard Bitcoin `CompactSize` encoding (single byte if `< 0xfd`; `0xfd` + 2-byte LE if it fits in `u16`; `0xfe` + 4-byte LE for `u32`; `0xff` + 8-byte LE for larger).

## Verifying you stripped correctly

Compute `SHA256d(nonWitnessHex)` and compare it against the txid your Bitcoin node reports for the transaction (e.g. `bitcoin-cli getrawtransaction <txid> 1`, or a block explorer's txid field — not its "wtxid" field, if shown separately). They must match exactly.
