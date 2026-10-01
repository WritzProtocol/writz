# Writz DeFindex USDC Vault - Mainnet Deployment

Part of the mainnet go-live epic (#122), sub-issue #123. Independent from the
[testnet vault](./defindex-vault-testnet.md): no shared address, keys, or state.

**Network:** Stellar Public (`Public Global Stellar Network ; September 2015`)

---

## Vault

Deployed via `scripts/deploy/deploy_defindex_vault_mainnet.mjs` (`POST /factory/create-vault-deposit`),
with the Manager multisig as caller: two co-signers approved it in LOBSTR Vault, which also
verified that the multisig can authorize Soroban invocations.

| Field | Value |
|---|---|
| **Vault address** | [`CDODNWQY54F4WS7AZ5Z3AAIWRLKBFUMXHNOFEM4H3UNCTMFK4RF2A6GU`](https://stellar.expert/explorer/public/contract/CDODNWQY54F4WS7AZ5Z3AAIWRLKBFUMXHNOFEM4H3UNCTMFK4RF2A6GU) |
| **Deploy tx** | [`a157bddff9...`](https://stellar.expert/explorer/public/tx/a157bddff915ecbfea9bab72dd0ed0fd5d324bf9b3e571b323521e281e51357d) |
| **Deployed** | 2026-10-01 (ledger 64706364), fee charged 0.4786 XLM |
| **Factory** | `CDKFHFJIET3A73A2YN4KV7NSV32S6YGQMUFH3DNJXLBWL4SKEGVRNFKI` |
| **Vault name / symbol** | `DeFindex-Vault-Writz USDC Vault` / `wzUSDC` (the prefix is added by the vault contract) |
| **Underlying asset** | Circle USDC (`USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`, SAC `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`) |
| **Strategy** | Blend USDC Fixed autocompound (`CDB2WMKQQNVZMEBY7Q7GZ5C7E7IAFSNMZ7GGVD6WKTCEWK7XOIAVZSAP`) - not the Etherfuse-pool strategy, which carries RWA collateral risk |
| **Vault fee** | 100 bps (1%); DeFindex reports `defindexFee` 5000 |
| **Upgradable** | Yes (controlled by the Manager multisig) |
| **Seed deposit** | 20 USDC from the Manager multisig; it holds 199,999,000 dfTokens (1,000 locked as minimum liquidity) |
| **First rebalance** | [`85b3819274...`](https://stellar.expert/explorer/public/tx/85b381927492196310e7457cb928b3ff3831fdf3d81feaa114ce3f8db354e5ae) (2026-10-01, ledger 64706504) - full 20 USDC invested into the Blend fixed strategy by the Rebalance Manager; `fetch_total_managed_funds` read back on-chain as idle `0`, invested `200000008` |

The mainnet relayer serves this vault with `DEFINDEX_VAULT_ID=CDODNWQY54F4WS7AZ5Z3AAIWRLKBFUMXHNOFEM4H3UNCTMFK4RF2A6GU`
and a mainnet-only `DEFINDEX_API_KEY` (see [deploy targets](../../docs/developers/deploy-targets.md)).

---

## Roles

Split across dedicated keys, unlike testnet's single deployer. See
[DeFindex vault roles](https://docs.defindex.io/getting-started/vault-roles).

| Role | Address | Custody |
|---|---|---|
| Manager | [`GBQRR7SXDZFKQCUHFAIVYEDVQTD6DTWC2OKMNS63ETF2ORG6KJZUO7NH`](https://stellar.expert/explorer/public/account/GBQRR7SXDZFKQCUHFAIVYEDVQTD6DTWC2OKMNS63ETF2ORG6KJZUO7NH) | 2-of-4 multisig, co-signers on LOBSTR Vault |
| Emergency Manager | [`GCAOWPTQDGIDCGQG4EVUB4BNGYNSRV2AC2QWUZ5KQBALW4KT4RZ4523T`](https://stellar.expert/explorer/public/account/GCAOWPTQDGIDCGQG4EVUB4BNGYNSRV2AC2QWUZ5KQBALW4KT4RZ4523T) | Single key, Freighter ("Writz Emergency") |
| Rebalance Manager | [`GAUFESKIVW5CZC5ASHQ6IG64KCJPGDTA6VQOVM6I3HMSERFIHHUHXN52`](https://stellar.expert/explorer/public/account/GAUFESKIVW5CZC5ASHQ6IG64KCJPGDTA6VQOVM6I3HMSERFIHHUHXN52) | Single key, used by the rebalance script |
| Fee Receiver | `GBQRR7SXDZFKQCUHFAIVYEDVQTD6DTWC2OKMNS63ETF2ORG6KJZUO7NH` | Same multisig as Manager (treasury) |

### Manager multisig

Configured with `scripts/deploy/create_manager_multisig.mjs` (`LOBSTR_VAULT=1`, `THRESHOLD=2`).

| Signer | Weight |
|---|---|
| `GD7TQTMKGNYL2ZL5KJUUJJPR3U3W24LRWC6LCHAO33CZKPBSEPDN3AH4` | 10 |
| `GDQ2PW7KCKPSW6RZLNU235WQIW7A5XQJJUJ4ZURZ4B2ULSWG5GSV66LX` | 10 |
| `GDXHYSHMQZSI3445FOIY5FKFSLRKLSD7JNHKWC22MFHKQ2FORYQ3W5YG` | 10 |
| `GBKN437KLCNSBCYLHW6ZASXWT4Y24JJUDXAOTCF3KYURRHHY2YUKI3IG` | 10 |
| `GA2T6GR7VXXXBETTERSAFETHANSORRYXXXPROTECTEDBYLOBSTRVAULT` (LOBSTR Vault marker, no known secret) | 1 |
| Master key | 0 |

Thresholds low/med/high: 20. Any two co-signers authorize; the marker can never close the gap.

| Event | Tx |
|---|---|
| Multisig configured | [`19340257...`](https://stellar.expert/explorer/public/tx/19340257689331ba8259603ea635df47ae6f20bde9b46c7f80bfb30db1e3858e) |
| Signing test via LOBSTR Vault (no-op, 2 signatures) | [`81bdb68b...`](https://stellar.expert/explorer/public/tx/81bdb68b6772f83cb835b0be313432fb4791e7a81f208d72fd9322da02db6273) |
| USDC trustline for fee receipt (2 signatures) | [`33f260fe...`](https://stellar.expert/explorer/public/tx/33f260fea901d7c74789883532ff6c841b7e525efbb6592a92b23aa0a4978782) |
| Vault deploy, a Soroban invocation (2 signatures) | [`a157bddf...`](https://stellar.expert/explorer/public/tx/a157bddff915ecbfea9bab72dd0ed0fd5d324bf9b3e571b323521e281e51357d) |
