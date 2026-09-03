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
| **Vault fee** | 100 bps (1%) |
| **Upgradable** | Yes |
| **First deposit** | 20 USDC (200,000,000 stroops) |
| **First rebalance tx** | [`436b224c7b...`](https://stellar.expert/explorer/testnet/tx/436b224c7b49970adc0c70ec18ec7d5e224bab3f10dfa12e6e3baf5f23482038) (2026-09-02, ledger 4473971) - full 20 USDC invested into the Blend USDC Strategy; vault's idle balance confirmed `0` afterward |

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
