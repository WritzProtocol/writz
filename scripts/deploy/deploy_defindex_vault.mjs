#!/usr/bin/env node
/**
 * Deploy Writz's own DeFindex USDC vault on testnet via the DeFindex factory
 * (#102, part of the DeFindex vault integration epic #101).
 *
 * Calls POST /factory/create-vault-deposit through @defindex/sdk: creates the
 * vault and makes the initial deposit in one transaction. All four vault
 * roles (Manager, Emergency Manager, Rebalance Manager, Fee Receiver) are set
 * to the deployer address - fine for a testnet rehearsal, not for mainnet.
 *
 * Funds are NOT invested by this script. The vault holds the initial deposit
 * idle until someone calls rebalance (sdk.rebalanceVault, or stellar-cli -
 * see docs.defindex.io/integration-guide/creating-a-defindex-vault#step-5-first-rebalance).
 * That's a separate, deliberate step - not part of this issue's acceptance
 * criteria (address + deploy tx hash, recorded and verifiable).
 *
 * Prerequisites (see scripts/deploy/.env.example):
 * - WRITZ_DEV_SECRET: funded testnet Stellar secret key (XLM for fees, via
 *   https://friendbot.stellar.org/?addr=<pubkey>)
 * - DEFINDEX_API_KEY: from console.defindex.io -> API Keys
 * - The deployer account needs BlendUSDC on testnet - a trustline + faucet
 *   claim from https://testnet.blend.capital (NOT real Circle USDC; testnet
 *   DeFindex strategies run against Blend's testnet pools).
 *
 * Usage: WRITZ_DEV_SECRET=<key> DEFINDEX_API_KEY=<key> bun run deploy_defindex_vault.mjs
 */
import * as StellarSdk from '@stellar/stellar-sdk';
import { DefindexSDK, SupportedNetworks } from '@defindex/sdk';

const { Keypair, TransactionBuilder, Networks } = StellarSdk;

// Testnet DeFindex + Blend addresses, from docs.defindex.io/contract-deployments
// and defindex-io/stellar-contracts:public/testnet.contracts.json. Testnet
// resets periodically (next scheduled reset per the docs: 2026-12-16) - if
// deployment fails with an address-not-found style error, re-check both
// sources before re-running.
const BLEND_USDC = 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU';
const USDC_BLEND_STRATEGY = 'CALLOM5I7XLQPPOPQMYAHUWW4N7O3JKT42KQ4ASEEVBXDJQNJOALFSUY';

const VAULT_NAME = 'Writz USDC Vault';
const VAULT_SYMBOL = 'wzUSDC';
const VAULT_FEE_BPS = 100; // 1% - testnet rehearsal value, revisit before mainnet
const UPGRADABLE = true;

// 20 USDC (7 decimals) rather than the bare 1001-stroop minimum: the docs
// call out that a first deposit below ~20 USDC causes approximation errors
// on the historical APY endpoint. Requires 20 BlendUSDC in the deployer
// wallet (see Prerequisites above).
const FIRST_DEPOSIT_STROOPS = '200000000';

const API_KEY = process.env.DEFINDEX_API_KEY;
const SECRET_KEY = process.env.WRITZ_DEV_SECRET;
if (!API_KEY) { console.error('Set DEFINDEX_API_KEY'); process.exit(1); }
if (!SECRET_KEY) { console.error('Set WRITZ_DEV_SECRET'); process.exit(1); }

const keypair = Keypair.fromSecret(SECRET_KEY);
const deployer = keypair.publicKey();
console.log(`\nDeployer (all four roles): ${deployer}`);

const sdk = new DefindexSDK({ apiKey: API_KEY });

const vaultConfig = {
  roles: {
    manager: deployer,
    emergencyManager: deployer,
    rebalanceManager: deployer,
    feeReceiver: deployer,
  },
  vaultFeeBps: VAULT_FEE_BPS,
  assets: [
    {
      address: BLEND_USDC,
      strategies: [
        { address: USDC_BLEND_STRATEGY, name: 'Blend USDC Strategy', paused: false },
      ],
    },
  ],
  name: VAULT_NAME,
  symbol: VAULT_SYMBOL,
  upgradable: UPGRADABLE,
  caller: deployer,
  depositAmounts: [FIRST_DEPOSIT_STROOPS],
};

console.log('Building create-vault-deposit transaction...');
const { xdr, error } = await sdk.createVaultWithDeposit(vaultConfig, SupportedNetworks.TESTNET);
if (error || !xdr) {
  console.error('Failed to build transaction:', error ?? '(no xdr returned)');
  process.exit(1);
}

console.log('Signing with deployer key...');
const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
tx.sign(keypair);
const signedXdr = tx.toXDR();

console.log('Submitting...');
const sendResult = await sdk.sendTransaction(signedXdr, SupportedNetworks.TESTNET);

if (!sendResult.success) {
  console.error('\nTransaction failed:', JSON.stringify(sendResult, null, 2));
  process.exit(1);
}

// The SDK's SendTransactionResponse.result is meant to come back tagged
// 'vault_create' with a parsed vaultAddress for this endpoint, but in
// practice (SDK 0.3.0) create-vault-deposit returns it tagged 'unknown'
// with the same contract address as its raw scValToNative() value - so fall
// back to reading that directly when the tag doesn't match.
const CONTRACT_ADDRESS_RE = /^C[A-Z2-7]{55}$/;
const vaultAddress =
  sendResult.result?.type === 'vault_create'
    ? sendResult.result.vaultAddress
    : sendResult.result?.type === 'unknown' && CONTRACT_ADDRESS_RE.test(sendResult.result.value)
      ? sendResult.result.value
      : undefined;

console.log('\nVault deployed');
console.log('==============');
console.log(`Vault address: ${vaultAddress ?? '(not parsed - see raw result below)'}`);
console.log(`Deploy tx:     ${sendResult.txHash}`);
console.log(`Explorer:      https://stellar.expert/explorer/testnet/tx/${sendResult.txHash}`);
if (vaultAddress) {
  console.log(`Vault explorer: https://stellar.expert/explorer/testnet/contract/${vaultAddress}`);
}
console.log(`Ledger:        ${sendResult.ledger}`);
if (!vaultAddress) {
  console.log('\nRaw result:', JSON.stringify(sendResult.result, null, 2));
}

console.log(
  '\nNext: record these values in contracts/deployments/defindex-vault-testnet.md, ' +
    'then run a first rebalance (funds are idle until invested) - see the ' +
    "'After Deployment: First Rebalance' section of " +
    'docs.defindex.io/integration-guide/creating-a-defindex-vault/using-the-api.',
);
