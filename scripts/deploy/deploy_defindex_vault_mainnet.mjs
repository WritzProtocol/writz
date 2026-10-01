#!/usr/bin/env node
/**
 * Deploy the mainnet Writz DeFindex USDC vault via the factory (#123).
 *
 * The caller is the Manager multisig (2-of-4 on LOBSTR Vault), so this script
 * never signs: it builds the create-vault-deposit transaction and, with
 * --submit, hands the unsigned XDR to LOBSTR Vault for the co-signers to
 * approve. LOBSTR submits it once two have signed. The 20 USDC seed deposit's
 * vault shares therefore land in the multisig treasury.
 *
 * Dry run by default: checks balances and prints the transaction for review.
 *
 * Env: DEFINDEX_API_KEY (mainnet key from console.defindex.io)
 * Usage: bun run deploy_defindex_vault_mainnet.mjs [--submit]
 *
 * Every address below is recorded in contracts/deployments/defindex-vault-mainnet.md.
 */
import { Horizon, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { DefindexSDK, SupportedNetworks } from '@defindex/sdk';

const MANAGER = 'GBQRR7SXDZFKQCUHFAIVYEDVQTD6DTWC2OKMNS63ETF2ORG6KJZUO7NH';
const EMERGENCY_MANAGER = 'GCAOWPTQDGIDCGQG4EVUB4BNGYNSRV2AC2QWUZ5KQBALW4KT4RZ4523T';
const REBALANCE_MANAGER = 'GAUFESKIVW5CZC5ASHQ6IG64KCJPGDTA6VQOVM6I3HMSERFIHHUHXN52';
const FEE_RECEIVER = MANAGER;

// Circle USDC's Stellar Asset Contract (USDC:GA5ZSE...KZVN), and DeFindex's
// Blend "fixed" USDC autocompound strategy from paltalabs/defindex
// public/mainnet.contracts.json - both verified on-chain (strategy.asset() == USDC SAC).
// The Etherfuse-pool strategy is deliberately not used: it carries CETES/USTRY
// collateral risk that docs/research/etherfuse-partnership.md defers until after audit.
const USDC_SAC = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const USDC_BLEND_FIXED_STRATEGY = 'CDB2WMKQQNVZMEBY7Q7GZ5C7E7IAFSNMZ7GGVD6WKTCEWK7XOIAVZSAP';

const VAULT_NAME = 'Writz USDC Vault';
const VAULT_SYMBOL = 'wzUSDC';
const VAULT_FEE_BPS = 100;
const UPGRADABLE = true;
// 20 USDC: below this, DeFindex's historical APY endpoint shows approximation errors.
const FIRST_DEPOSIT_STROOPS = '200000000';
const MIN_FREE_XLM = 5;

const LOBSTR_VAULT_API = 'https://vault.lobstr.co/api/transactions/';

function fail(msg) {
  console.error(`\nError: ${msg}`);
  process.exit(1);
}

const submit = process.argv.includes('--submit');
const API_KEY = process.env.DEFINDEX_API_KEY;
if (!API_KEY) fail('Set DEFINDEX_API_KEY (mainnet key from console.defindex.io)');

const horizon = new Horizon.Server('https://horizon.stellar.org');
const account = await horizon.loadAccount(MANAGER);

const usdc = account.balances.find((b) => b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER);
const usdcStroops = usdc ? BigInt(usdc.balance.replace('.', '')) : 0n;
if (usdcStroops < BigInt(FIRST_DEPOSIT_STROOPS)) {
  fail(`Manager holds ${usdc?.balance ?? 0} USDC, needs at least ${Number(FIRST_DEPOSIT_STROOPS) / 1e7}`);
}
const xlm = Number(account.balances.find((b) => b.asset_type === 'native').balance);
const reservedXlm = (2 + account.subentry_count + (account.num_sponsoring ?? 0) - (account.num_sponsored ?? 0)) * 0.5;
const freeXlm = xlm - reservedXlm;
if (freeXlm < MIN_FREE_XLM) {
  fail(`Manager has ${freeXlm.toFixed(2)} spendable XLM, needs at least ${MIN_FREE_XLM} for Soroban fees`);
}

const sdk = new DefindexSDK({ apiKey: API_KEY });
const { xdr, error } = await sdk.createVaultWithDeposit(
  {
    roles: {
      manager: MANAGER,
      emergencyManager: EMERGENCY_MANAGER,
      rebalanceManager: REBALANCE_MANAGER,
      feeReceiver: FEE_RECEIVER,
    },
    vaultFeeBps: VAULT_FEE_BPS,
    assets: [
      {
        address: USDC_SAC,
        strategies: [{ address: USDC_BLEND_FIXED_STRATEGY, name: 'Blend USDC Fixed Strategy', paused: false }],
      },
    ],
    name: VAULT_NAME,
    symbol: VAULT_SYMBOL,
    upgradable: UPGRADABLE,
    caller: MANAGER,
    depositAmounts: [FIRST_DEPOSIT_STROOPS],
  },
  SupportedNetworks.MAINNET,
);
if (error || !xdr) fail(`DeFindex did not build the transaction: ${error ?? '(no xdr returned)'}`);

const tx = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC);
if (tx.source !== MANAGER) fail(`transaction source is ${tx.source}, expected the Manager multisig`);
const maxTime = Number(tx.timeBounds?.maxTime ?? 0);
const secondsLeft = maxTime ? maxTime - Math.floor(Date.now() / 1000) : Infinity;

console.log(`\nCaller / source:   ${MANAGER} (2-of-4 multisig)`);
console.log(`Manager:           ${MANAGER}`);
console.log(`Emergency Manager: ${EMERGENCY_MANAGER}`);
console.log(`Rebalance Manager: ${REBALANCE_MANAGER}`);
console.log(`Fee Receiver:      ${FEE_RECEIVER}`);
console.log(`Asset / strategy:  Circle USDC ${USDC_SAC} -> Blend fixed ${USDC_BLEND_FIXED_STRATEGY}`);
console.log(`Vault:             "${VAULT_NAME}" (${VAULT_SYMBOL}), fee ${VAULT_FEE_BPS} bps, upgradable ${UPGRADABLE}`);
console.log(`Seed deposit:      ${Number(FIRST_DEPOSIT_STROOPS) / 1e7} USDC (manager holds ${usdc.balance})`);
console.log(`Spendable XLM:     ${freeXlm.toFixed(2)}`);
console.log(`Max fee:           ${(Number(tx.fee) / 1e7).toFixed(4)} XLM`);
console.log(`Expires in:        ${secondsLeft === Infinity ? 'no time bound' : `${Math.floor(secondsLeft / 60)} min`}`);
console.log(`Tx hash:           ${tx.hash().toString('hex')}`);

if (!submit) {
  console.log('\nDry run - nothing sent. Re-run with --submit to send it to LOBSTR Vault for co-signing.');
  process.exit(0);
}

if (secondsLeft < 300) fail('transaction expires in under 5 minutes - not enough time to collect two signatures');

const res = await fetch(LOBSTR_VAULT_API, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ xdr }),
});
const body = await res.text();
if (!res.ok) fail(`LOBSTR Vault rejected the transaction (${res.status}): ${body}`);

console.log('\nSent to LOBSTR Vault. Two co-signers must approve it before it expires.');
console.log(`Watch: https://stellar.expert/explorer/public/tx/${tx.hash().toString('hex')}`);
console.log('Once it lands, record the vault address from the tx result in contracts/deployments/defindex-vault-mainnet.md.');
