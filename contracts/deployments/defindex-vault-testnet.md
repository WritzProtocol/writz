# Writz DeFindex USDC Vault - Testnet Deployment

Part of the DeFindex vault integration epic (#101), sub-issue #102. Unlike the
contracts in `testnet.md`, this vault is not Writz-authored code - it's
deployed through the [DeFindex factory](https://docs.defindex.io/advanced-documentation/direct-contract-calls/factory-methods)
via `scripts/deploy/deploy_defindex_vault.mjs`, which wraps
`POST /factory/create-vault-deposit` (`@defindex/sdk`).

**Network:** Soroban Testnet (`Test SDF Network ; September 2015`)
**Deployer:** `writz-deployer` (holds all four vault roles on testnet - not the mainnet role split)

---

## Deployment

Deployed via `POST /factory/create-vault-deposit` (`@defindex/sdk`, `scripts/deploy/deploy_defindex_vault.mjs`).

| Field | Value |
|---|---|
| **Vault address** | [`CBMHGL7GGGHODEDDJ5H2LKJEFHJWBRSQUKOXMC4FKOFDZK5HBKW6PI2S`](https://stellar.expert/explorer/testnet/contract/CBMHGL7GGGHODEDDJ5H2LKJEFHJWBRSQUKOXMC4FKOFDZK5HBKW6PI2S) |
| **Deploy tx** | [`e80b9bab14...`](https://stellar.expert/explorer/testnet/tx/e80b9bab145824fab252846b1c95da9d57cfb93cbdeab7ae7a91d4105450bf61) |
| **Deployed** | 2026-09-02 (ledger 4473923) |
| **Vault name / symbol** | `DeFindex-Vault-Writz USDC Vault` / `wzUSDC` - `name` submitted was `"Writz USDC Vault"`; the `DeFindex-Vault-` prefix is added by the vault contract itself, not a naming mistake on our end. Read back on-chain via `name`/`symbol`. |
| **Underlying asset** | BlendUSDC (`CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU`) - testnet-only test token from [testnet.blend.capital](https://testnet.blend.capital), not real Circle USDC |
| **Strategy** | Blend USDC Strategy (`CALLOM5I7XLQPPOPQMYAHUWW4N7O3JKT42KQ4ASEEVBXDJQNJOALFSUY`) |
| **Fees** | `get_fees()` returns `[100, 2000]`: `vault_fee` 100 bps, `defindex_fee` 2000 bps. See the fee section below. |
| **Upgradable** | Yes |
| **First deposit** | 20 USDC (200,000,000 stroops) |
| **First rebalance tx** | [`436b224c7b...`](https://stellar.expert/explorer/testnet/tx/436b224c7b49970adc0c70ec18ec7d5e224bab3f10dfa12e6e3baf5f23482038) (2026-09-02, ledger 4473971) - full 20 USDC invested into the Blend USDC Strategy; vault's idle balance confirmed `0` afterward |

## Fees

Verified on-chain 2026-09-09 by simulation (`--send=no`, costs nothing, submits nothing):

```bash
stellar contract invoke --id CBMHGL7GGGHODEDDJ5H2LKJEFHJWBRSQUKOXMC4FKOFDZK5HBKW6PI2S \
  --network testnet --source-account <any-funded-account> --send=no -- get_fees
# [100, 2000]
```

| Field | Value | Set by | Mutable |
|---|---|---|---|
| `vault_fee` | 100 bps (1%) | Writz, at creation | Yes, Manager only, via `lock_fees(Some(new_bps))`. Not retroactive, capped at 9000 bps |
| `defindex_fee` | 2000 bps (20%) | The factory, stamped at creation | **No. Frozen for this vault's life** |

**The two are a split, not a sum.** `vault_fee` is the entire performance fee taken from yield; `defindex_fee` is DeFindex's cut *of that fee*, not an extra charge on the depositor. DeFindex's own documentation confirms the model ("fees are split between the partner and DeFindex", and "fees are only charged on the yield generated, never on the deposited capital" - [partner-fees](https://docs.defindex.io/getting-started/partner-fees)) but does not publish the split percentage anywhere, so the only source for it is the on-chain read above.

On 100 USDC of gross yield with these values: total fee 1 USDC, of which DeFindex takes 0.20 and the Writz fee receiver gets 0.80. The depositor keeps 99.

**The mainnet factory charges a different rate, and it is not negotiable after deployment.** Read the same day:

```bash
# testnet factory
stellar contract invoke --id CDSCWE4GLNBYYTES2OCYDFQA2LLY4RBIAX6ZI32VSUXD7GO6HRPO4A32 \
  --network testnet --send=no -- defindex_fee
# 2000

# mainnet factory
stellar contract invoke --id CDKFHFJIET3A73A2YN4KV7NSV32S6YGQMUFH3DNJXLBWL4SKEGVRNFKI \
  --rpc-url https://mainnet.sorobanrpc.com \
  --network-passphrase "Public Global Stellar Network ; September 2015" --send=no -- defindex_fee
# 5000
```

A vault created on mainnet today is stamped `defindex_fee = 5000` (50%) for life. With `vault_fee` unchanged, that moves DeFindex's share of every 1 USDC of fee from 0.20 to 0.50. The depositor pays the same either way; what changes is Writz's share. Re-read `defindex_fee()` on the target network before the mainnet deployment (#123) rather than assuming testnet's value carries over.

**Roles (testnet, single deployer key for all four - not the mainnet role split):**

| Role | Address |
|---|---|
| Manager | `GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT` (`writz-deployer`) |
| Emergency Manager | `GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT` (`writz-deployer`) |
| Rebalance Manager | `GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT` (`writz-deployer`) |
| Fee Receiver | `GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT` (`writz-deployer`) |

> Before mainnet: split roles across dedicated keys (Manager on a
> multisig/cold wallet, Emergency Manager on a hot wallet for fast response)
> per [DeFindex vault roles](https://docs.defindex.io/getting-started/vault-roles).
