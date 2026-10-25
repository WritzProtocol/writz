# AGENTS.md

Guidance for AI coding agents.

## Integrating Writz from another project

Use only these values; anything not listed here or in the linked pages does not exist.

- Stellar network: testnet, passphrase `Test SDF Network ; September 2015`, RPC `https://soroban-testnet.stellar.org`
- Bitcoin network: signet (no mainnet, testnet3 or testnet4 verification)
- `bitcoin-spv`: `CAHHY4S4WCIFU4LBSKBI3IP6A4QYR2COV6EACDEBXGPJFDWBJWGOMCLP`
- `writz-lend`: `CCMSOCBVX2S645MQFFXJRHVHRWH2NY62KLOJXNDYFOJRYHIC47EO6ZZK`
- Test USDC (SAC): `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`
- Relayer: `https://api.testnet.writz.xyz`, proof route `GET /spv-proof/:txid?confirmations=N`
- Yield on USDC: the `writz-lend` lender side, `supply_usdc(supplier, amount)` and `withdraw_supply(supplier, amount)` signed by the supplier, read with `get_supply_balance(lender)` and `get_supply_rate_bp()`. The rate is variable and zero while nothing is borrowed: read it live, never hard-code an APY
- Main primitive: `verify_transaction(block_hash: BytesN<32>, merkle_proof: Vec<BytesN<32>>, tx_index: u32, raw_tx: Bytes, min_confirmations: u32) -> Result<SpvVerificationResult, SPVError>`, where `SpvVerificationResult` is `{ txid, block_hash, block_height, confirmations }`
- Packages: `@writz/sdk` is published on npm (source `packages/sdk`). `writz-spv-client` is published on crates.io (source `contracts/contracts/writz-spv-client`). There is no other Writz package.
- Machine-readable IDs: `contracts/deployments/testnet.json`, generated from `contracts/deployments/testnet.md` by `node scripts/sync-deployments.mjs`.

Full reference: [`docs/developers/for-ai-agents.md`](docs/developers/for-ai-agents.md) (also at https://docs.writz.xyz/developers/for-ai-agents.md). Walkthrough: [`docs/developers/integrate.md`](docs/developers/integrate.md). Runnable examples: [`examples/`](examples). Contract IDs of record: [`contracts/deployments/testnet.md`](contracts/deployments/testnet.md).

## Working in this repository

Start with [`docs/developers/quick-start.md`](docs/developers/quick-start.md) and [`docs/developers/contribution-guide.md`](docs/developers/contribution-guide.md). Commits follow Conventional Commits. After a redeploy, record it in `contracts/deployments/testnet.md` first, then run `node scripts/sync-deployments.mjs` (regenerates `testnet.json` and the `@writz/sdk` preset). Before changing a contract address or a test count in any doc, run `node scripts/check-docs-sync.mjs`; it fails on a superseded `bitcoin-spv` or `writz-lend` ID in `AGENTS.md`, `docs/developers/`, `examples/` or the packages.
