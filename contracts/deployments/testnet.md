# Writz Protocol — Testnet Deployments

**Network:** Soroban Testnet (`Test SDF Network ; September 2015`)
**Deployer:** `writz-deployer`

---

## bitcoin-spv

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

**Verified:** `txid` and `block_hash` match SHA256d values exactly. ✅

---

## zk-verifier

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

> **Note:** These keys are from the development trusted setup (`pot15`). They are for testnet only and will be replaced by the multi-party ceremony keys before mainnet.

---

## commitment-tree

| Field | Value |
|---|---|
| **Contract ID** | `CDFAP3J4WLFZC2N5U66X5EO62POBBIBXOKCCMCM3IRLJNXT73C4IBKA7` |
| **WASM Hash** | `28422f9213f1b624942634158c7504b1efc68f2debc3d9892563cf201a1da43d` |
| **WASM Size** | 25,754 bytes |
| **Deploy tx** | [`11f0b18857...`](https://stellar.expert/explorer/testnet/tx/11f0b1885714e265d72a54686f4885f137c23af67f1ab800bae009a671f1365b) |
| **Init tx** | [`4dfa50b9a5...`](https://stellar.expert/explorer/testnet/tx/4dfa50b9a525fdcf63c1e4e5caf4c760b02ac6b7b7477bc9b78d2e56120cdf33) |
| **Deployed** | 2026-06-22 |

### Configuration

| Parameter | Value |
|-----------|-------|
| `admin` | `GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT` (`writz-deployer`) |
| `spv_contract` | `CAE5L7BO2GNF7MIZWXB2BTUMLYNIMQZUSWN2BWLZQS7HRHLOUSL6VLWJ` |
| `zk_verifier` | `CDV45GLXG4AOU6BDZSY5YHHVNGQIAYAPD3PUGXIIIYLIO6V2XGO6SMFV` |
| `usdc_token` | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` (Circle testnet USDC SAC) |
| `min_confirmations` | `1` (testnet) |
| `min_deposit_satoshis` | `100,000` (0.001 BTC) |
| `min_collateral_ratio_bp` | `15,000` (150%) |
| `liquidation_threshold_bp` | `12,000` (120%) |

### Verified call

```bash
stellar contract invoke \
  --id CDFAP3J4WLFZC2N5U66X5EO62POBBIBXOKCCMCM3IRLJNXT73C4IBKA7 \
  --source writz-deployer \
  --network testnet \
  -- \
  get_merkle_root
```

**Result:** `"2134e76ac5d21aab186c2be1dd8f84ee880a1e46eaf712f9d371b6df22191f3e"`

**Verified:** matches the Poseidon-2 empty Merkle tree root at depth 20. ✅

---

## private-lend

| Field | Value |
|---|---|
| **Contract ID** | `CCLH2GJYG3QSHZJI7V7VK3DNMNK3I3QJCECBSFGX3AC6CK4I7EF7ZJ2G` |
| **WASM Hash** | `43a60a269ecc20e62653513e45a7eb4f585258f112cd7d8fc4a4a3e814407f40` |
| **WASM Size** | 26,477 bytes |
| **Deploy tx** | [`4bf1edc3ee...`](https://stellar.expert/explorer/testnet/tx/4bf1edc3eea480e0b1aa568128e39ee103033ce2e50b995920e28d569337e044) |
| **Deployed** | 2026-06-22 |

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

### Live broadcast results ✅

| Field | Value |
|-------|-------|
| Funding tx | [`61deea44`](https://blockstream.info/signet/tx/61deea4439ecd6c325c5b23ecf4b27694ce3cb0474adbbcc6221968ecbd583a4) (89,631 sat to P2WSH) |
| Release tx | [`11932100`](https://blockstream.info/signet/tx/119321009b2f92dac8f25f6bcddb2ed6a3ae778e8748ec52910cce90742e4098) (88,131 sat → user) |
| TX size | 347 bytes / **149 vbytes** |
| Fee | 1,500 sat (10.1 sat/vbyte) |
| Witness items | 4: `[user_sig (72B), protocol_sig (71B), 0x01, redeemScript (114B)]` |

**What was verified:**
- P2WSH address derived correctly from (protocol_key, user_key, CLTV=700,000) ✅
- Both keys signed the PSBT independently (multi-party flow) ✅
- `finalizePathA` assembled witness `[user_sig, protocol_sig, 0x01, redeemScript]` correctly ✅
- Transaction broadcast and accepted by Bitcoin Signet mempool ✅

---

## End-to-End ZK Flow Test ✅

**Test instance:** `CDCH7C5TBJOZWIUKVSDGLWPTLTBIC55WH4447ZVIOA4NRDWKOXPVKOHB`  
**Token:** XLM native SAC (`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`)  
**Date:** 2026-06-22

| Step | Transaction |
|------|-------------|
| initialize | [`b6527209c4...`](https://stellar.expert/explorer/testnet/tx/b6527209c4b9a7dfafaad54232319161f649534ff4f22958bc979b1ada2bb599) |
| supply_usdc (500 XLM) | [`d340e51655...`](https://stellar.expert/explorer/testnet/tx/d340e51655b7d2ec3b2ac4fcf46a89f43fe13fb5bd457f756088927b2685540c) |
| **deposit** (ZK proof ✅) | [`ae3c8eeba4...`](https://stellar.expert/explorer/testnet/tx/ae3c8eeba4462872087f3ab11f0f737845b7af0d94fc400df01e725e4305e4db) |
| insert_commitment | [`32d263a550...`](https://stellar.expert/explorer/testnet/tx/32d263a5508efb006dfffc2535a19d89df0f6d636d639765f13c8290de5ce111) |
| **borrow** 200 XLM (ZK proof ✅) | [`046a116582...`](https://stellar.expert/explorer/testnet/tx/046a1165822ab754600174299a0a0fe5683c3939aef8efab2a6c28f8e21dd0df) |
| **repay** 200 XLM (ZK proof ✅) | [`11c94e34d8...`](https://stellar.expert/explorer/testnet/tx/11c94e34d8be2c8ea1836354fd178715d88ded5717ac0dea59943feaafb1e6ce) |

**What was verified on-chain:**
- Groth16 deposit proof: BN254 pairing check via `bn254.pairing_check` host function ✅
- Commitment inserted into Poseidon Merkle tree (root updated) ✅
- Groth16 borrow proof: collateral ratio enforced by ZK circuit (150% min) ✅
- USDC (XLM) transferred from pool to borrower ✅
- Groth16 repay proof: field-negation repay amount recovered correctly ✅
- Pool accounting updated after each operation ✅
- All proofs verified against `zk-verifier` contract `CDV45GLXG4AOU6BDZSY5YHHVNGQIAYAPD3PUGXIIIYLIO6V2XGO6SMFV` ✅
