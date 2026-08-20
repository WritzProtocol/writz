# Writz Protocol - Testnet Deployments

**Network:** Soroban Testnet (`Test SDF Network ; September 2015`)
**Deployer:** `writz-deployer`

---

## Current deployment (2026-08-19)

Redeployed all four contracts together after the Elliot code-quality pass:
`is_borrow` soundness fix + collateral/price range checks in the ZK circuits
(new verification keys, since the constraint system changed), the
`Config.paused` flag, the `set_spv_contract`/`set_zk_verifier`/`set_oracle`
setters, `supply`/`withdraw` events, and the oracle-stub dedup into
`spv-types`, per `docs/architecture/contract-migration-runbook.md` § Track 1
(planned migration, no funds at risk on the superseded testnet contracts -
straight redeploy rather than a wind-down). Built via `stellar contract
build` (wasm-opt applied). Per the immutability ADR
(`docs/architecture/adr/0001-contract-immutability.md`) there is no in-place
upgrade path, so this is four fresh Contract IDs, not an upgrade of the ones
below.

### bitcoin-spv

| Field | Value |
|---|---|
| **Contract ID** | `CB2BD6QCSZVNZN5NLI7C5NF356WXVJDSXT6LVAQFWHHS4SZ4NCKKNIVA` |
| **WASM Hash** | `5b9de530d01873fa78baf03f6064321b5ce68742eff6ce0be34bcabe6846e3ff` |
| **WASM Size** | 12,030 bytes |
| **Deploy tx** | [`67377456f5...`](https://stellar.expert/explorer/testnet/tx/67377456f55360c5f3c2cfcf9bf6d945faffdec21833f1a08037cdfcae3b250e) |
| **Initialize tx** | [`bf8279224e...`](https://stellar.expert/explorer/testnet/tx/bf8279224e607db4b9ea5cdb339a04db84be49dd1dd640e58a23ccbb1d41091e) |
| **set_checkpoint tx** | [`d5fb18330e...`](https://stellar.expert/explorer/testnet/tx/d5fb18330eefb85ab840579f213a8ccfae98641623c7d296397f9b23a77910fe) |
| **Deployed** | 2026-08-19 |

Checkpoint anchored to Bitcoin Signet tip at deploy time:

| Field | Value |
|---|---|
| `height` | `318363` |
| `block_hash` (internal order) | `66a086bdd1ad395d75bec65805ecc1734b8c8a7f9bb62ca0304d3f560f000000` |
| `bits` | `0x1d146a9f` (`487877279`) |

**Verified:** `get_checkpoint` reads back exactly these values. ✓ The checkpoint must be refreshed periodically (recommended: weekly) - see `docs/security/security-model.md` for the full trust-model discussion. Before mainnet, convert the admin account to a multisig (2-of-3) rather than a single key.

### zk-verifier

| Field | Value |
|---|---|
| **Contract ID** | `CBNZU23QGCZATJB2QMNF2K6IST2SVP7FSGCKASQNBULTWDWGANDBYLFY` |
| **WASM Hash** | `2fc6bcc24c8bb4f6a0646d2fd3fd9aee8a1126f39b593dba9745ad41d7a06f88` |
| **WASM Size** | 14,498 bytes |
| **Deploy tx** | [`be52af6018...`](https://stellar.expert/explorer/testnet/tx/be52af6018255608c7f82dc4a40e6fc4083f97752bce8efcb25ff85a764924a6) |
| **Admin** | `GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT` (`writz-deployer`) |
| **Deployed** | 2026-08-19 |

Verification keys set (regenerated from the range-checked circuits - IC lengths unchanged, but the key material itself differs from the superseded deployment since the constraint system changed):

| Circuit | IC length | Set tx |
|---------|-----------|--------|
| Deposit | 6 | [`81bb495360...`](https://stellar.expert/explorer/testnet/tx/81bb495360217ae5438f70a3311ff1ed6b9665d1cfffebc556c60cc09a7f1861) |
| BorrowRepay | 9 | [`ff1f320b5c...`](https://stellar.expert/explorer/testnet/tx/ff1f320b5c30eec4d936c300307ddd1c1b2a9f7615fdba9e21e51b717bb6e5cb) |
| Liquidation | 6 | [`5d4c843f73...`](https://stellar.expert/explorer/testnet/tx/5d4c843f732b3d78b0d73dfee174f16ad8aa3e1ca5cd5d4f4d41dd15d53a9924) |

**Verified:** `get_verification_key --circuit BorrowRepay` reads back IC length 9 with all four curve-point fields populated. ✓

> **Note:** These keys are from the development trusted setup (`pot15`). They are for testnet only and will be replaced by the multi-party ceremony keys before mainnet.

### commitment-tree

| Field | Value |
|---|---|
| **Contract ID** | `CDQCTFO3FK3M47QS47O2A4WLNPSQAQBSXBFPJ6RZEHFO5D7RY34FSBBP` |
| **WASM Hash** | `1acf95d04afb85c98f88b844e1b9eabbfa60965728e084e533b057e754896097` |
| **WASM Size** | 31,692 bytes |
| **Deploy tx** | [`4e88f6a592...`](https://stellar.expert/explorer/testnet/tx/4e88f6a592c688800210f33bca047c072cdc2ee988270eaae28f40a4340c69d3) |
| **Init tx** | [`0e71dc8304...`](https://stellar.expert/explorer/testnet/tx/0e71dc8304cd7cec65be60bf478988a51f71889861603ffaa2ab7a9da8eaabb2) |
| **Deployed** | 2026-08-19 |
| **Interface** | Adds `Config.paused` + `set_paused`, `set_spv_contract`, `set_zk_verifier`, `set_oracle`, `supply`/`withdraw` events (Tyler architecture pass, #26-adjacent) on top of the existing `enc_note` interface (#18) |

#### Configuration

| Parameter | Value |
|-----------|-------|
| `admin` | `GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT` (`writz-deployer`) |
| `spv_contract` | `CB2BD6QCSZVNZN5NLI7C5NF356WXVJDSXT6LVAQFWHHS4SZ4NCKKNIVA` |
| `zk_verifier` | `CBNZU23QGCZATJB2QMNF2K6IST2SVP7FSGCKASQNBULTWDWGANDBYLFY` |
| `usdc_token` | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` (testnet USDC SAC - `USDC:GBBD47IF…`, DEX-liquid, 7 decimals) |
| `oracle` | `GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT` (stub - `writz-deployer`) |
| `min_confirmations` | `1` (testnet) |

**Verified:** `get_merkle_root` → `"2134e76ac5d21aab186c2be1dd8f84ee880a1e46eaf712f9d371b6df22191f3e"`, matching the Poseidon-2 empty Merkle tree root at depth 20. ✓

**Pool seeded:** 500 USDC supplied by `writz-deployer` - [`5241a90817...`](https://stellar.expert/explorer/testnet/tx/5241a908176a0ae32e0b1b8ce108608e51ae30dbe6f87e8c97aa69a95a025f21). `get_pool_state` → `total_supplied: 5,000,000,000` stroops (500 USDC), `total_borrowed: 0`. ✓

### private-lend

| Field | Value |
|---|---|
| **Contract ID** | `CAAWVMDRUPEJNELSQ6RU2VMVX5EJLQ2E77T7IXDWGMW4DGSNAGECGSWR` |
| **WASM Hash** | `fcd672a16cb62393b7c24965c817076df0d219c402b8d8219f9ebf6fff7c9e0d` |
| **WASM Size** | 36,005 bytes |
| **Deploy tx** | [`0438ac105b...`](https://stellar.expert/explorer/testnet/tx/0438ac105beed426a5c24fa1168125bf9af83a2b81da15de593443c2e626b8e9) |
| **Init tx** | [`1e18318538...`](https://stellar.expert/explorer/testnet/tx/1e183185380df3be5284c13134f13df2eb9632868eeebd90c4d9d2ebd3c07738) |
| **Deployed** | 2026-08-19 |
| **Interface** | Adds `Config.paused` + `set_paused`, `set_keeper`, `set_keeper_stale_window`, `set_relayer`, `set_oracle`, `set_spv_contract`, keeper stale-window liquidation fallback, `supply`/`withdraw` events |

#### Configuration

| Parameter | Value |
|-----------|-------|
| `admin` | `GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT` (`writz-deployer`) |
| `spv_contract` | `CB2BD6QCSZVNZN5NLI7C5NF356WXVJDSXT6LVAQFWHHS4SZ4NCKKNIVA` |
| `usdc_token` | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| `oracle` | `GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT` (stub - `writz-deployer`) |
| `keeper` | `GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT` (`writz-deployer` - no separate keeper bot running on testnet yet) |
| `relayer` | `GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT` (`writz-deployer` - same caveat) |

**Verified:** `get_protocol_state` → `total_supplied: 0`, `total_borrowed: 0`, `last_keeper_heartbeat` set to init time. ✓

**Pool seeded:** 500 USDC supplied by `writz-deployer` - [`baf32ae36b...`](https://stellar.expert/explorer/testnet/tx/baf32ae36be8bd4d57a60b7e417115bc8064f103a52d5047614c2ffe5e2450e4). `get_protocol_state` → `total_supplied: 5,000,000,000` stroops (500 USDC). ✓

### End-to-End ZK Flow Test ✓ (2026-08-19, against the current deployment)

**Test instance:** `CCCT2CQUOMICS3IULYYQKCZ6PBUMUKE7EA77NQPDHHHVLUPLNOVQR2UU`
**Token:** XLM native SAC (`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`)

Running `scripts/deploy/e2e_zkflow.js` against the new `zk-verifier`
(`CBNZU23Q…`) surfaced a real gap: the script's synthetic single-tx-block
header had always used `bits = 0`/`nonce = 0` (no actual mining), which the
*current* `bitcoin-spv` correctly rejects with `InsufficientProofOfWork` -
this only ever "worked" historically against a build that didn't yet
enforce real proof-of-work. Rather than weaken the shared production
`bitcoin-spv`'s checkpoint (which is anchored to real Bitcoin Signet
difficulty specifically to reject easy fake chains), the script now deploys
its **own throwaway `bitcoin-spv` per run** with an easy checkpoint
(`EASY_TEST_BITS = 0x207fffff`, same constant the Rust test suite uses) and
mines its test header for real against it. Production `bitcoin-spv`'s
security is unaffected.

| Step | Transaction |
|------|-------------|
| bitcoin-spv (test) deploy + initialize | [`9f0713766b…`](https://stellar.expert/explorer/testnet/tx/9f0713766b95ee183f11b452e63c628bb3d6ef8652fdae60d8762538061438e4) |
| bitcoin-spv (test) set_checkpoint (easy) | [`9829cc94ab…`](https://stellar.expert/explorer/testnet/tx/9829cc94ab1736ec5007ab3b2f96e9c74d9435bd5a37467e9aaf32319ef3da86) |
| initialize (commitment-tree test instance) | [`953e198668…`](https://stellar.expert/explorer/testnet/tx/953e198668f64d606b6f41a37152b78e57511693b1614507a9dc2f2f5abc99b4) |
| supply_usdc (500 XLM) | [`a2f0fa8db6…`](https://stellar.expert/explorer/testnet/tx/a2f0fa8db6c3ca51fd105af126d32d42c14967cf252e42812e0ba64804c2366f) |
| **deposit** (ZK proof ✓) | [`9d749fdc08…`](https://stellar.expert/explorer/testnet/tx/9d749fdc08f7ac48725479916653f566596affa059550e9fee6f3ad75b73e73f) |
| insert_commitment | [`4bc0a30a76…`](https://stellar.expert/explorer/testnet/tx/4bc0a30a76fee3bc2259363f441111bd5408dca667bf4735f789cef1e5b544fd) |
| **borrow** 200 XLM (ZK proof ✓) | [`33b50b0dc1…`](https://stellar.expert/explorer/testnet/tx/33b50b0dc1895896e1199f62efd2a2c21793b4ecf088e2297ea78b3b59504055) |
| **repay** 200 XLM (ZK proof ✓) | [`aa963eed8b…`](https://stellar.expert/explorer/testnet/tx/aa963eed8b7e00fc7d4804d4cb5938f2d9ed2a3466ea4b22f4b8ecfd4bc59b02) |

**What this confirms:** the freshly-generated `borrow_repay` verification
key (with the `is_borrow` soundness fix + the new collateral/price range
checks, both from the Elliot pass) correctly verifies real Groth16 proofs
from the current circuits - deposit, borrow, and a full repay all passed
on-chain against `zk-verifier` `CBNZU23Q…`. ✓

### Follow-ups this redeploy did not do

- **Doc sweep:** done - every non-historical reference to the superseded Contract IDs across `docs/`, `README.md`, `docs.json`, `mint.json`, `relayer/README.md`, and `packages/commitment-tree/README.md` now points at the current deployment; `scripts/check-docs-sync.mjs` reports zero drift. Test counts across all docs were re-synced from `docs/_data/facts.json` (191 contract tests + 60 bitcoin-script + 59 relayer + 29 circuits = 339 total) via `scripts/update-test-counts.mjs`.
- **Relayer live `.env`:** no relayer instance's real `.env` exists in this checkout (only `.env.example`, which had no hardcoded contract IDs to begin with) - nothing to update. If a deployed relayer instance exists elsewhere, its env needs the new `COMMITMENT_TREE_ID`/`PRIVATE_LEND_ID` by hand.
- **`docs/developers/contract-reference.md` and a couple of quick-start/milestone-plan snippets** document function signatures and CLI calls (`set_vkey`, `verify_groth16`, commitment-tree/private-lend `initialize` argument lists, a `bitcoin-spv::get_version` call) that don't match the actual current contract interfaces - this predates this redeploy and is a separate, larger doc-accuracy gap (API reference, not contract addresses). Contract IDs and test counts in those files are now correct; the signatures themselves were not rewritten here - flag if a full rewrite is wanted.

---

## Superseded deployment (2026-06-22 / 2026-06-30)

Left running per the migration runbook's default (no forced state transplant); kept here for history. No known funds are at risk on these - they predate real usage.

### bitcoin-spv

| Field | Value |
|---|---|
| **Contract ID** | `CAE5L7BO2GNF7MIZWXB2BTUMLYNIMQZUSWN2BWLZQS7HRHLOUSL6VLWJ` |
| **WASM Hash** | `cd7df01c483149dcde2db7921b51270329b980db0e8c605238dc2ce612bbe2e9` |
| **WASM Size** | 5,225 bytes |
| **Deploy tx** | [`8d2427337f...`](https://stellar.expert/explorer/testnet/tx/8d2427337f3907914841c7c0e8cfbe529992c229725d35a7903822e098f86986) |
| **First invocation** | [`c9aacc05b2...`](https://stellar.expert/explorer/testnet/tx/c9aacc05b298bd7306ad63c899da23fa563572f322e32159c5053b47127f4944) |
| **Deployed** | 2026-06-22 |

### Verified call

```bash
stellar contract invoke \
  --id CAE5L7BO2GNF7MIZWXB2BTUMLYNIMQZUSWN2BWLZQS7HRHLOUSL6VLWJ \
  --source writz-deployer \
  --network testnet \
  --send=yes \
  -- \
  verify_transaction \
  --headers '["010000000000000000000000000000000000000000000000000000000000000000000000e5d196bfb21caca9dbd654cafb3b4dc0c4882c8927d2eb300d9539dd0b93422800f153650000000000000000"]' \
  --merkle_proof '[]' \
  --tx_index 0 \
  --raw_tx '010000000000000000' \
  --min_confirmations 1
```

**Result:**
```json
{
  "block_hash": "72778d2b274a779441240c90f6faba8dfbfe75497393fb4f6c3b6e13821013c6",
  "confirmations": 1,
  "txid": "e5d196bfb21caca9dbd654cafb3b4dc0c4882c8927d2eb300d9539dd0b934228"
}
```

**Verified:** `txid` and `block_hash` match SHA256d values exactly. ✓

> **[SUPERSEDED]** This deployment predates the current contract build (pre-dates the `is_borrow`/range-check circuit fixes, the `paused` flag, and the `VerificationResult` → `SpvVerificationResult` rename). Use the "Current deployment" section above instead.

---

## zk-verifier (superseded)

| Field | Value |
|---|---|
| **Contract ID** | `CDV45GLXG4AOU6BDZSY5YHHVNGQIAYAPD3PUGXIIIYLIO6V2XGO6SMFV` |
| **WASM Hash** | `f3943a2b22c9d3e653735736803a1781bdc6802fbb02bf14550e3c1e072c1c77` |
| **WASM Size** | 11,781 bytes |
| **Deploy tx** | [`5e9e47a9c4...`](https://stellar.expert/explorer/testnet/tx/5e9e47a9c4dbb2e555e81c17114760e0c1aa530f21306a89e37515c6e2de693f) |
| **Admin** | `GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT` (`writz-deployer`) |
| **Deployed** | 2026-06-22 |

### Verification keys set

| Circuit | IC length | Set tx |
|---------|-----------|--------|
| Deposit | 6 | [`64488e2acc...`](https://stellar.expert/explorer/testnet/tx/64488e2accecc1051e7761d3c4359db4a448db891f6f58c2dfefa5a8a47097c2) |
| BorrowRepay | 9 | [`2f7e21ab5b...`](https://stellar.expert/explorer/testnet/tx/2f7e21ab5b67a5aa98d3036bfac823c06f79095336439e4a61c20604ebdcb7b8) |
| Liquidation | 6 | [`b5d6613498...`](https://stellar.expert/explorer/testnet/tx/b5d66134982611ffbdcba3b568de644698791c35ede4521f70469a66de043193) |

> **[SUPERSEDED]** VKs here are from the pre-range-check circuits - proofs generated by the current `circuits/` tree will NOT verify against this instance. Use the "Current deployment" section above.

---

## commitment-tree (superseded)

| Field | Value |
|---|---|
| **Contract ID** | `CC2OZ3LG5U6RE3U7QC2R5QMID5GHQBE7QXTJQ4ZSTP5W73WDTKQPRW7E` |
| **WASM Hash** | `679af82a7441649a69bdba3be88bd8ce1f4d6e9693d96c2e50a6d2196a117e1b` |
| **WASM Size** | 26,580 bytes |
| **Init tx** | [`1502ecb851...`](https://stellar.expert/explorer/testnet/tx/1502ecb851bf6109a66b37ed3d6fb80406379e1af58e97360d8b426079a99bfc) |
| **Deployed** | 2026-06-30 |
| **Interface** | `deposit`/`borrow`/`repay` carry `enc_note` (sealed recovery note, #18) |

### Configuration

| Parameter | Value |
|-----------|-------|
| `admin` | `GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT` (`writz-deployer`) |
| `spv_contract` | `CAE5L7BO2GNF7MIZWXB2BTUMLYNIMQZUSWN2BWLZQS7HRHLOUSL6VLWJ` |
| `zk_verifier` | `CDV45GLXG4AOU6BDZSY5YHHVNGQIAYAPD3PUGXIIIYLIO6V2XGO6SMFV` |
| `usdc_token` | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` (testnet USDC SAC - `USDC:GBBD47IF…`, DEX-liquid, 7 decimals) |
| `min_confirmations` | `1` (testnet) |
| `min_deposit_satoshis` | `10,000` (0.0001 BTC - lowered for signet faucet testing) |
| `min_collateral_ratio_bp` | `15,000` (150%) |
| `liquidation_threshold_bp` | `12,000` (120%) |

### Verified call

```bash
stellar contract invoke \
  --id CC2OZ3LG5U6RE3U7QC2R5QMID5GHQBE7QXTJQ4ZSTP5W73WDTKQPRW7E \
  --source writz-deployer \
  --network testnet \
  -- \
  get_merkle_root
```

**Result:** `"2134e76ac5d21aab186c2be1dd8f84ee880a1e46eaf712f9d371b6df22191f3e"`

**Verified:** matches the Poseidon-2 empty Merkle tree root at depth 20. ✓

> **[SUPERSEDED]** Predates `paused`/setters/`supply`/`withdraw` events and the current `zk-verifier`'s keys. Use the "Current deployment" section above.

---

## private-lend (superseded)

| Field | Value |
|---|---|
| **Contract ID** | `CCLH2GJYG3QSHZJI7V7VK3DNMNK3I3QJCECBSFGX3AC6CK4I7EF7ZJ2G` |
| **WASM Hash** | `43a60a269ecc20e62653513e45a7eb4f585258f112cd7d8fc4a4a3e814407f40` |
| **WASM Size** | 26,477 bytes |
| **Deploy tx** | [`4bf1edc3ee...`](https://stellar.expert/explorer/testnet/tx/4bf1edc3eea480e0b1aa568128e39ee103033ce2e50b995920e28d569337e044) |
| **Deployed** | 2026-06-22 |

> **[SUPERSEDED]** Predates `paused`/setters/`supply`/`withdraw` events and the keeper stale-window liquidation fallback. Use the "Current deployment" section above.

---

## P2WSH End-to-End Test (Bitcoin Signet)

**Script:** `bitcoin-script/scripts/e2e_testnet.mjs`  
**Run:** `node scripts/e2e_testnet.mjs --dry-run` · `node scripts/e2e_testnet.mjs` (live broadcast)  
**Date:** 2026-06-23  
**Network:** Bitcoin Signet (Blockstream Esplora)

### Deposit address

```
tb1q2ewa3444emmn80sxg9ncfsr9v8pn0cc2ae2fy5u2qqm4a4jewwhsqwjt2m
```

| Key | Value |
|-----|-------|
| Protocol pubkey | `031918f1cf7f7c5ce714251bc1c757ea9c855fb11fca316aec6108668379f231ed` |
| User pubkey | `02bbcf244d0b968684729fc7d82722466048e584907f045d8b8810d7f831655ad7` |
| CLTV timelock | `700,000` (fixed for test reproducibility; Signet tip ~310k) |
| User return addr | `tb1qx8kdpw7aj8v2dppxggfw9mm2ckjwvp7mx00325` |

### Live broadcast results ✓

| Field | Value |
|-------|-------|
| Funding tx | [`61deea44`](https://blockstream.info/signet/tx/61deea4439ecd6c325c5b23ecf4b27694ce3cb0474adbbcc6221968ecbd583a4) (89,631 sat to P2WSH) |
| Release tx | [`11932100`](https://blockstream.info/signet/tx/119321009b2f92dac8f25f6bcddb2ed6a3ae778e8748ec52910cce90742e4098) (88,131 sat → user) |
| TX size | 347 bytes / **149 vbytes** |
| Fee | 1,500 sat (10.1 sat/vbyte) |
| Witness items | 4: `[user_sig (72B), protocol_sig (71B), 0x01, redeemScript (114B)]` |

**What was verified:**
- P2WSH address derived correctly from (protocol_key, user_key, CLTV=700,000) ✓
- Both keys signed the PSBT independently (multi-party flow) ✓
- `finalizePathA` assembled witness `[user_sig, protocol_sig, 0x01, redeemScript]` correctly ✓
- Transaction broadcast and accepted by Bitcoin Signet mempool ✓

---

## End-to-End ZK Flow Test ✓

**Test instance:** `CDCH7C5TBJOZWIUKVSDGLWPTLTBIC55WH4447ZVIOA4NRDWKOXPVKOHB`  
**Token:** XLM native SAC (`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`)  
**Date:** 2026-06-22

| Step | Transaction |
|------|-------------|
| initialize | [`b6527209c4...`](https://stellar.expert/explorer/testnet/tx/b6527209c4b9a7dfafaad54232319161f649534ff4f22958bc979b1ada2bb599) |
| supply_usdc (500 XLM) | [`d340e51655...`](https://stellar.expert/explorer/testnet/tx/d340e51655b7d2ec3b2ac4fcf46a89f43fe13fb5bd457f756088927b2685540c) |
| **deposit** (ZK proof ✓) | [`ae3c8eeba4...`](https://stellar.expert/explorer/testnet/tx/ae3c8eeba4462872087f3ab11f0f737845b7af0d94fc400df01e725e4305e4db) |
| insert_commitment | [`32d263a550...`](https://stellar.expert/explorer/testnet/tx/32d263a5508efb006dfffc2535a19d89df0f6d636d639765f13c8290de5ce111) |
| **borrow** 200 XLM (ZK proof ✓) | [`046a116582...`](https://stellar.expert/explorer/testnet/tx/046a1165822ab754600174299a0a0fe5683c3939aef8efab2a6c28f8e21dd0df) |
| **repay** 200 XLM (ZK proof ✓) | [`11c94e34d8...`](https://stellar.expert/explorer/testnet/tx/11c94e34d8be2c8ea1836354fd178715d88ded5717ac0dea59943feaafb1e6ce) |

**What was verified on-chain:**
- Groth16 deposit proof: BN254 pairing check via `bn254.pairing_check` host function ✓
- Commitment inserted into Poseidon Merkle tree (root updated) ✓
- Groth16 borrow proof: collateral ratio enforced by ZK circuit (150% min) ✓
- USDC (XLM) transferred from pool to borrower ✓
- Groth16 repay proof: field-negation repay amount recovered correctly ✓
- Pool accounting updated after each operation ✓
- All proofs verified against `zk-verifier` contract `CDV45GLXG4AOU6BDZSY5YHHVNGQIAYAPD3PUGXIIIYLIO6V2XGO6SMFV` ✓

### Re-run after the `enc_note` interface change (#18)

The 2026-06-22 run above predates `enc_note`. `e2e_zkflow.js` was not updated
alongside the contract, so it failed at the deposit step until fixed (#15).
Re-verified against the current interface:

**Test instance:** `CBM5OUBYBICB3QB4T5PAGYUWWLZOIVWQCUHKV3HCSNZGB72GYM5Q5ID4`
**Token:** XLM native SAC (`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`)
**Date:** 2026-07-30 · whole run completes in about a minute

| Step | Transaction |
|------|-------------|
| initialize | [`aed32de63b…`](https://stellar.expert/explorer/testnet/tx/aed32de63bcb4888defb564f703e01eb50907732ee10f2b966a9b286b675a034) |
| supply_usdc (500 XLM) | [`512b91d750…`](https://stellar.expert/explorer/testnet/tx/512b91d750d39bdcc196b2ec38266b6e9ffc5f0ebda4573bd1a4ac1c76936ffa) |
| **deposit** (ZK proof ✓) | [`c3320d79f9…`](https://stellar.expert/explorer/testnet/tx/c3320d79f955ad35ad32ebae2d849024d6d69d597a0b355d8ec2ebb5e22f7e29) |
| insert_commitment | [`9fbed23db3…`](https://stellar.expert/explorer/testnet/tx/9fbed23db3b91e2520cf54ab54f715284d700fb011c16d2b64d5e9fade2635bb) |
| **borrow** 200 XLM (ZK proof ✓) | [`b7b83f7501…`](https://stellar.expert/explorer/testnet/tx/b7b83f750128df68b1cd2f91a375b6e5393d7daac764bba1fa87cf3484a6541a) |
| **repay** 200 XLM (ZK proof ✓) | [`261d8b14ab…`](https://stellar.expert/explorer/testnet/tx/261d8b14ab83414b712a0ba8a817ccbc0a6b36de2ef03896ea986beecdb82f14) |

Reproduction steps, build prerequisites, and the trusted-setup caveat:
[`docs/developers/runbook.md`](../../docs/developers/runbook.md).
