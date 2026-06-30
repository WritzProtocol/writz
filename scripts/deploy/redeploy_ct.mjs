#!/usr/bin/env node
/**
 * Redeploy the production commitment-tree to testnet with the new enc_note
 * interface (#18): deploy + initialize + supply pool. No demo position is
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CONTRACTS = path.join(ROOT, 'contracts');

const { Keypair, Networks, TransactionBuilder, Contract, Address, xdr, rpc: SorobanRpc } = StellarSdk;

const RPC_URL          = 'https://soroban-testnet.stellar.org';
const NETWORK          = Networks.TESTNET;
const SPV_CONTRACT     = 'CAE5L7BO2GNF7MIZWXB2BTUMLYNIMQZUSWN2BWLZQS7HRHLOUSL6VLWJ';
const ZK_VERIFIER      = 'CDV45GLXG4AOU6BDZSY5YHHVNGQIAYAPD3PUGXIIIYLIO6V2XGO6SMFV';
const XLM_SAC          = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const SUPPLY_AMOUNT    = 5_000_000_000n; // 500 XLM stroops
const MIN_CONFIRMATIONS = 1;

const SECRET_KEY = process.env.WRITZ_DEV_SECRET;
if (!SECRET_KEY) { console.error('Set WRITZ_DEV_SECRET'); process.exit(1); }

const keypair = Keypair.fromSecret(SECRET_KEY);
const server = new SorobanRpc.Server(RPC_URL);
console.log(`\n🔑 Deployer / admin: ${keypair.publicKey()}`);

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

async function deployContractOnce(wasm) {
  const account = await server.getAccount(keypair.publicKey());
  const uploadTx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: NETWORK })
    .addOperation(StellarSdk.Operation.uploadContractWasm({ wasm }))
    .setTimeout(30)
    .build();
  const uploadSim = await server.simulateTransaction(uploadTx);
  if (SorobanRpc.Api.isSimulationError(uploadSim)) throw new Error(`Upload sim failed: ${JSON.stringify(uploadSim.error)}`);
  const wasmHash = uploadSim.result?.retval?.bytes?.();
  if (!wasmHash) throw new Error('No WASM hash from sim');
  const uploadPrep = SorobanRpc.assembleTransaction(uploadTx, uploadSim).build();
  uploadPrep.sign(keypair);
  const uploadSend = await server.sendTransaction(uploadPrep);
  await waitForTx(uploadSend.hash);

  const account2 = await server.getAccount(keypair.publicKey());
  const deployTx = new TransactionBuilder(account2, { fee: '1000000', networkPassphrase: NETWORK })
    .addOperation(StellarSdk.Operation.createCustomContract({
      wasmHash,
      address: Address.fromString(keypair.publicKey()),
      salt: crypto.randomBytes(32),
    }))
    .setTimeout(30)
    .build();
  const deploySim = await server.simulateTransaction(deployTx);
  if (SorobanRpc.Api.isSimulationError(deploySim)) throw new Error(`Deploy sim failed: ${JSON.stringify(deploySim.error)}`);
  const retVal = deploySim.result?.retval;
  if (!retVal || retVal.switch().name !== 'scvAddress') throw new Error('Deploy sim did not return address');
  const contractId = StellarSdk.StrKey.encodeContract(retVal.address().contractId());
  const deployPrep = SorobanRpc.assembleTransaction(deployTx, deploySim).build();
  deployPrep.sign(keypair);
  const deploySend = await server.sendTransaction(deployPrep);
  await waitForTx(deploySend.hash);
  return { contractId, wasmHash: Buffer.from(wasmHash).toString('hex') };
}

async function deployContract(wasmPath) {
  const wasm = fs.readFileSync(wasmPath);
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await deployContractOnce(wasm); }
    catch (e) { lastErr = e; console.log(`  deploy attempt ${attempt} failed (${e.message}); retrying…`); await new Promise((r) => setTimeout(r, 3000)); }
  }
  throw lastErr;
}

async function main() {
  const wasmPath = path.join(CONTRACTS, 'target/wasm32v1-none/release/commitment_tree.wasm');
  console.log(`\nDeploying ${wasmPath} (${fs.statSync(wasmPath).size} bytes)…`);
  const { contractId, wasmHash } = await deployContract(wasmPath);
  console.log(`✓ commitment-tree deployed: ${contractId}`);
  console.log(`  wasm hash: ${wasmHash}`);

  const init = await invoke(contractId, 'initialize', [
    addressToScVal(keypair.publicKey()), // admin
    addressToScVal(SPV_CONTRACT),
    addressToScVal(ZK_VERIFIER),
    addressToScVal(XLM_SAC),
    addressToScVal(keypair.publicKey()), // oracle (stub)
    u32ToScVal(MIN_CONFIRMATIONS),
  ]);
  console.log(`✓ initialized — tx ${init.hash}`);

  const root = await invoke(contractId, 'get_merkle_root', []);
  console.log(`✓ empty merkle root: ${root.result.returnValue?.bytes()?.toString('hex')}`);

  const supply = await invoke(contractId, 'supply_usdc', [
    addressToScVal(keypair.publicKey()),
    i128ToScVal(SUPPLY_AMOUNT),
  ]);
  console.log(`✓ supplied ${Number(SUPPLY_AMOUNT) / 1e7} XLM to pool — tx ${supply.hash}`);

  console.log('\n══════════════════════════════════════');
  console.log('REDEPLOY COMPLETE');
  console.log('══════════════════════════════════════');
  console.log(`CONTRACT_ID=${contractId}`);
  console.log(`WASM_HASH=${wasmHash}`);
  console.log(`INIT_TX=${init.hash}`);
}

main().catch((e) => { console.error('\n✗ FAILED:', e); process.exit(1); });
