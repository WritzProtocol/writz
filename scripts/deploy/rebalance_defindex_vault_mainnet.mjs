#!/usr/bin/env node
/**
 * Invest the mainnet Writz DeFindex vault's idle USDC into the Blend fixed
 * strategy (#123). Signs with the Rebalance Manager key; dry run by default.
 *
 * Env: DEFINDEX_API_KEY, MAINNET_REBALANCE_SECRET (scripts/deploy/.env)
 * Usage: bun run rebalance_defindex_vault_mainnet.mjs [--submit]
 */
import { Address, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { DefindexSDK, SupportedNetworks } from '@defindex/sdk';

const VAULT = 'CDODNWQY54F4WS7AZ5Z3AAIWRLKBFUMXHNOFEM4H3UNCTMFK4RF2A6GU';
const REBALANCE_MANAGER = 'GAUFESKIVW5CZC5ASHQ6IG64KCJPGDTA6VQOVM6I3HMSERFIHHUHXN52';
const USDC_SAC = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75';
const USDC_BLEND_FIXED_STRATEGY = 'CDB2WMKQQNVZMEBY7Q7GZ5C7E7IAFSNMZ7GGVD6WKTCEWK7XOIAVZSAP';

function fail(msg) {
  console.error(`\nError: ${msg}`);
  process.exit(1);
}

const submit = process.argv.includes('--submit');
const { DEFINDEX_API_KEY, MAINNET_REBALANCE_SECRET } = process.env;
if (!DEFINDEX_API_KEY) fail('Set DEFINDEX_API_KEY');
if (!MAINNET_REBALANCE_SECRET) fail('Set MAINNET_REBALANCE_SECRET');

const keypair = Keypair.fromSecret(MAINNET_REBALANCE_SECRET);
if (keypair.publicKey() !== REBALANCE_MANAGER) {
  fail(`MAINNET_REBALANCE_SECRET belongs to ${keypair.publicKey()}, not the vault's Rebalance Manager`);
}

const sdk = new DefindexSDK({ apiKey: DEFINDEX_API_KEY });
const info = await sdk.getVaultInfo(VAULT, SupportedNetworks.MAINNET);
if (info.roles.rebalanceManager !== REBALANCE_MANAGER) {
  fail(`vault's Rebalance Manager is ${info.roles.rebalanceManager}, expected ${REBALANCE_MANAGER}`);
}
const funds = info.totalManagedFunds.find((f) => f.asset === USDC_SAC);
const idle = Number(funds?.idle_amount ?? 0);
if (idle <= 0) fail('vault has no idle USDC to invest');

// Number, not string: the rebalance endpoint rejects a numeric string here.
const { xdr, error } = await sdk.rebalanceVault(
  VAULT,
  {
    caller: REBALANCE_MANAGER,
    instructions: [{ type: 'Invest', strategy_address: USDC_BLEND_FIXED_STRATEGY, amount: idle }],
  },
  SupportedNetworks.MAINNET,
);
if (error || !xdr) fail(`DeFindex did not build the transaction: ${error ?? '(no xdr returned)'}`);

const tx = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC);
if (tx.source !== REBALANCE_MANAGER) fail(`transaction source is ${tx.source}, expected the Rebalance Manager`);
const call = tx.operations[0]?.func?.invokeContract?.();
const target = call ? Address.fromScAddress(call.contractAddress()).toString() : '(not a contract call)';
const fn = call ? call.functionName().toString() : '';
if (target !== VAULT || fn !== 'rebalance') fail(`transaction calls ${target}.${fn}, expected ${VAULT}.rebalance`);

console.log(`\nVault:      ${VAULT}`);
console.log(`Caller:     ${REBALANCE_MANAGER} (Rebalance Manager)`);
console.log(`Call:       ${target}.${fn}`);
console.log(`Invest:     ${idle / 1e7} USDC -> Blend fixed ${USDC_BLEND_FIXED_STRATEGY}`);
console.log(`Before:     idle ${Number(funds.idle_amount) / 1e7}, invested ${Number(funds.invested_amount) / 1e7}`);
console.log(`Max fee:    ${(Number(tx.fee) / 1e7).toFixed(4)} XLM`);

if (!submit) {
  console.log('\nDry run - nothing submitted. Re-run with --submit to send it.');
  process.exit(0);
}

tx.sign(keypair);
const sent = await sdk.sendTransaction(tx.toXDR(), SupportedNetworks.MAINNET);
if (!sent.success) fail(`transaction failed: ${JSON.stringify(sent, null, 2)}`);

const after = (await sdk.getVaultInfo(VAULT, SupportedNetworks.MAINNET)).totalManagedFunds.find((f) => f.asset === USDC_SAC);
console.log(`\nTx:         ${sent.txHash}`);
console.log(`Explorer:   https://stellar.expert/explorer/public/tx/${sent.txHash}`);
console.log(`Ledger:     ${sent.ledger}`);
console.log(`After:      idle ${Number(after.idle_amount) / 1e7}, invested ${Number(after.invested_amount) / 1e7}`);
