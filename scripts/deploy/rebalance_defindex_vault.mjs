#!/usr/bin/env node
/**
 * First rebalance for the Writz DeFindex USDC vault (testnet) - invests the
 * idle initial deposit into the Blend USDC strategy. Without this, deposited
 * funds sit uninvested in the vault (see contracts/deployments/defindex-vault-testnet.md).
 * Companion to deploy_defindex_vault.mjs; same env vars.
 *
 * Usage: WRITZ_DEV_SECRET=<key> DEFINDEX_API_KEY=<key> bun run rebalance_defindex_vault.mjs
 */
import * as StellarSdk from '@stellar/stellar-sdk';
import { DefindexSDK, SupportedNetworks } from '@defindex/sdk';

const { Keypair, TransactionBuilder, Networks } = StellarSdk;

const VAULT_ADDRESS = 'CBMHGL7GGGHODEDDJ5H2LKJEFHJWBRSQUKOXMC4FKOFDZK5HBKW6PI2S';
const USDC_BLEND_STRATEGY = 'CALLOM5I7XLQPPOPQMYAHUWW4N7O3JKT42KQ4ASEEVBXDJQNJOALFSUY';
// Number, not string: unlike create-vault-deposit's depositAmounts, the
// rebalance endpoint's instruction.amount rejects a numeric string with a
// misleading "strategy address is required" validation error.
const INVEST_AMOUNT_STROOPS = 200000000; // full idle balance (20 USDC) at deploy time

const API_KEY = process.env.DEFINDEX_API_KEY;
const SECRET_KEY = process.env.WRITZ_DEV_SECRET;
if (!API_KEY) { console.error('Set DEFINDEX_API_KEY'); process.exit(1); }
if (!SECRET_KEY) { console.error('Set WRITZ_DEV_SECRET'); process.exit(1); }

const keypair = Keypair.fromSecret(SECRET_KEY);
const rebalancer = keypair.publicKey();
console.log(`\nRebalance manager: ${rebalancer}`);
console.log(`Vault: ${VAULT_ADDRESS}`);

const sdk = new DefindexSDK({ apiKey: API_KEY });

console.log(`Building rebalance transaction (Invest ${INVEST_AMOUNT_STROOPS} stroops into ${USDC_BLEND_STRATEGY})...`);
const { xdr, error } = await sdk.rebalanceVault(
  VAULT_ADDRESS,
  {
    caller: rebalancer,
    instructions: [
      { type: 'Invest', strategy_address: USDC_BLEND_STRATEGY, amount: INVEST_AMOUNT_STROOPS },
    ],
  },
  SupportedNetworks.TESTNET,
);
if (error || !xdr) {
  console.error('Failed to build transaction:', error ?? '(no xdr returned)');
  process.exit(1);
}

console.log('Signing with rebalance manager key...');
const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
tx.sign(keypair);
const signedXdr = tx.toXDR();

console.log('Submitting...');
const sendResult = await sdk.sendTransaction(signedXdr, SupportedNetworks.TESTNET);

if (!sendResult.success) {
  console.error('\nTransaction failed:', JSON.stringify(sendResult, null, 2));
  process.exit(1);
}

console.log('\nRebalance complete');
console.log('===================');
console.log(`Tx:       ${sendResult.txHash}`);
console.log(`Explorer: https://stellar.expert/explorer/testnet/tx/${sendResult.txHash}`);
console.log(`Ledger:   ${sendResult.ledger}`);
