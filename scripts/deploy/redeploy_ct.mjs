#!/usr/bin/env node
/**
 * Redeploy the production commitment-tree to testnet with the new enc_note
 * interface (#18): deploy (constructor-initialized) + supply pool. No demo position is
 * inserted, so the on-chain tree starts empty and the relayer leaf store can be
 * reset to match. Prints the new contract id + wasm hash for the .env wiring.
 *
 * Usage: WRITZ_DEV_SECRET=<key> node redeploy_ct.mjs
 */
import * as StellarSdk from '@stellar/stellar-sdk';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deployWithConstructor } from './constructor_deploy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CONTRACTS = path.join(ROOT, 'contracts');

const { Keypair, Networks, TransactionBuilder, Contract, Address, xdr, rpc: SorobanRpc,
        Horizon, Asset, Operation, BASE_FEE } = StellarSdk;

const RPC_URL          = 'https://soroban-testnet.stellar.org';
const NETWORK          = Networks.TESTNET;
const SPV_CONTRACT     = 'CB2BD6QCSZVNZN5NLI7C5NF356WXVJDSXT6LVAQFWHHS4SZ4NCKKNIVA';
const ZK_VERIFIER      = 'CBNZU23QGCZATJB2QMNF2K6IST2SVP7FSGCKASQNBULTWDWGANDBYLFY';
// Testnet USDC (USDC:GBBD47IF…) - a classic asset with deep XLM/USDC liquidity
// on the Stellar DEX, so the deployer can swap XLM→USDC (path payment) and seed
// the pool itself. 7 decimals. SAC id below.
const USDC_ISSUER      = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC_SAC         = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const MIN_CONFIRMATIONS = 1;
const SUPPLY_USDC      = 500n;        // USDC to seed the pool
const SUPPLY_STROOPS   = SUPPLY_USDC * 10_000_000n;
const SWAP_SEND_MAX_XLM = '400';      // max XLM to spend acquiring SUPPLY_USDC

const HORIZON_URL = 'https://horizon-testnet.stellar.org';

const SECRET_KEY = process.env.WRITZ_DEV_SECRET;
if (!SECRET_KEY) { console.error('Set WRITZ_DEV_SECRET'); process.exit(1); }

const keypair = Keypair.fromSecret(SECRET_KEY);
const server = new SorobanRpc.Server(RPC_URL);
const horizon = new Horizon.Server(HORIZON_URL);
const USDC_ASSET = new Asset('USDC', USDC_ISSUER);
console.log(`\n🔑 Deployer / admin: ${keypair.publicKey()}`);

// Establish a USDC trustline (if needed) and swap XLM→USDC on the classic DEX so
// the deployer holds SUPPLY_USDC to seed the pool.
async function acquireUsdc() {
  let acct = await horizon.loadAccount(keypair.publicKey());
  const hasTrust = acct.balances.some(
    (b) => b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER,
  );
  if (!hasTrust) {
    const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: NETWORK })
      .addOperation(Operation.changeTrust({ asset: USDC_ASSET }))
      .setTimeout(60)
      .build();
    tx.sign(keypair);
    await horizon.submitTransaction(tx);
    console.log('✓ USDC trustline established');
  } else {
    console.log('✓ USDC trustline already present');
  }

  acct = await horizon.loadAccount(keypair.publicKey());
  const swapTx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(Operation.pathPaymentStrictReceive({
      sendAsset: Asset.native(),
      sendMax: SWAP_SEND_MAX_XLM,
      destination: keypair.publicKey(),
      destAsset: USDC_ASSET,
      destAmount: SUPPLY_USDC.toString(),
      path: [],
    }))
    .setTimeout(60)
    .build();
  swapTx.sign(keypair);
  const res = await horizon.submitTransaction(swapTx);
  console.log(`✓ swapped XLM→${SUPPLY_USDC} USDC on the DEX - tx ${res.hash}`);
}

const addressToScVal = (pub) => Address.fromString(pub).toScVal();
const u32ToScVal = (n) => xdr.ScVal.scvU32(n);
function i128ToScVal(n) {
  const lo = n & 0xFFFFFFFFFFFFFFFFn;
  const hi = n >> 64n;
  return xdr.ScVal.scvI128(new xdr.Int128Parts({
    hi: xdr.Int64.fromString(hi.toString()),
    lo: xdr.Uint64.fromString(lo.toString()),
  }));
}

async function waitForTx(hash) {
  let result;
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    result = await server.getTransaction(hash);
    if (result.status !== 'NOT_FOUND') break;
  }
  if (result.status !== 'SUCCESS') throw new Error(`Tx failed: ${result.status}`);
  return result;
}

async function invoke(contractId, method, args) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const account = await server.getAccount(keypair.publicKey());
    const contract = new Contract(contractId);
    const tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: NETWORK })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) {
      if (attempt < 4) { await new Promise((r) => setTimeout(r, 3000)); continue; }
      throw new Error(`Sim failed (${method}): ${JSON.stringify(sim.error)}`);
    }
    const prepared = SorobanRpc.assembleTransaction(tx, sim).build();
    prepared.sign(keypair);
    const sent = await server.sendTransaction(prepared);
    if (sent.status === 'ERROR') {
      if (JSON.stringify(sent).includes('txBadSeq') && attempt < 4) { await new Promise((r) => setTimeout(r, 2500)); continue; }
      throw new Error(`Send failed (${method}): ${JSON.stringify(sent.errorResult)}`);
    }
    let got;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      got = await server.getTransaction(sent.hash);
      if (got.status !== 'NOT_FOUND') break;
    }
    if (got.status !== 'SUCCESS') {
      if (attempt < 4) { await new Promise((r) => setTimeout(r, 2500)); continue; }
      throw new Error(`Tx failed (${method}): ${got.status}`);
    }
    return { hash: sent.hash, result: got };
  }
}

async function main() {
  const wasmPath = path.join(CONTRACTS, 'target/wasm32v1-none/release/commitment_tree.wasm');
  console.log(`\nDeploying ${wasmPath} (${fs.statSync(wasmPath).size} bytes)…`);
  const vaultScriptHex = process.env.ZK_VAULT_SCRIPT_PUBKEY;
  if (!vaultScriptHex || !/^[0-9a-f]{68}$/i.test(vaultScriptHex)) {
    throw new Error('ZK_VAULT_SCRIPT_PUBKEY must be the 34-byte (68 hex chars) shared ZK vault scriptPubKey');
  }
  // Constructor runs atomically with the deploy - no separate initialize tx
  // for anyone to front-run (GHSA-422m-f73x-fh58).
  const contractId = await deployWithConstructor({
    server,
    networkPassphrase: NETWORK,
    keypair,
    wasm: fs.readFileSync(wasmPath),
    constructorArgs: [
      addressToScVal(keypair.publicKey()), // admin
      addressToScVal(SPV_CONTRACT),
      addressToScVal(ZK_VERIFIER),
      addressToScVal(USDC_SAC),
      addressToScVal(keypair.publicKey()), // oracle (stub)
      u32ToScVal(MIN_CONFIRMATIONS),
      StellarSdk.nativeToScVal(Buffer.from(vaultScriptHex, 'hex'), { type: 'bytes' }),
    ],
  });
  console.log(`✓ commitment-tree deployed and configured: ${contractId}`);

  const root = await invoke(contractId, 'get_merkle_root', []);
  console.log(`✓ empty merkle root: ${root.result.returnValue?.bytes()?.toString('hex')}`);

  // Seed the pool: deployer swaps XLM→USDC on the DEX, then supplies.
  await acquireUsdc();
  const supply = await invoke(contractId, 'supply_usdc', [
    addressToScVal(keypair.publicKey()),
    i128ToScVal(SUPPLY_STROOPS),
  ]);
  console.log(`✓ supplied ${SUPPLY_USDC} USDC to pool - tx ${supply.hash}`);

  console.log('\n══════════════════════════════════════');
  console.log('REDEPLOY COMPLETE');
  console.log('══════════════════════════════════════');
  console.log(`CONTRACT_ID=${contractId}`);
  console.log(`INIT_TX=${init.hash}`);
}

main().catch((e) => { console.error('\n✗ FAILED:', e); process.exit(1); });
