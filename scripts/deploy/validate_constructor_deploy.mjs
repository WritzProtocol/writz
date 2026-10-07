#!/usr/bin/env node
/**
 * Live testnet check for the constructor-based deploy path. Deploys a
 * THROWAWAY commitment-tree instance (not the production one), then verifies:
 *   1. the constructor ran in the same transaction as the deploy - the
 *      on-chain Merkle root equals the depth-20 empty-tree root;
 *   2. no `initialize` entry point exists any more - calling it fails.
 *
 * Usage: WRITZ_DEV_SECRET=<testnet S... key, funded> node validate_constructor_deploy.mjs
 */
import * as StellarSdk from '@stellar/stellar-sdk';
import { deployWithConstructor } from './constructor_deploy.mjs';

const { Keypair, Networks, Contract, Address, nativeToScVal, rpc: SorobanRpc, TransactionBuilder, scValToNative } = StellarSdk;

const RPC_URL = 'https://soroban-testnet.stellar.org';
const NETWORK = Networks.TESTNET;
const WASM = new URL('../../contracts/target/wasm32v1-none/release/commitment_tree.wasm', import.meta.url);
// Must match EMPTY_TREE_ROOT in contracts/contracts/commitment-tree/src/lib.rs.
const EMPTY_TREE_ROOT = '2134e76ac5d21aab186c2be1dd8f84ee880a1e46eaf712f9d371b6df22191f3e';

const secret = process.env.WRITZ_DEV_SECRET;
if (!secret) throw new Error('WRITZ_DEV_SECRET is not set');
const keypair = Keypair.fromSecret(secret);
const server = new SorobanRpc.Server(RPC_URL);
const fs = await import('fs');

const admin = keypair.publicKey();
const ctor = [
  Address.fromString(admin).toScVal(),           // admin
  Address.fromString(admin).toScVal(),           // spv (placeholder)
  Address.fromString(admin).toScVal(),           // zk_verifier (placeholder)
  Address.fromString(admin).toScVal(),           // usdc (placeholder)
  Address.fromString(admin).toScVal(),           // oracle (placeholder)
  nativeToScVal(6, { type: 'u32' }),             // min_confirmations
  nativeToScVal(Buffer.alloc(34), { type: 'bytes' }), // zk_vault_script_pubkey
];

console.log('Deploying throwaway commitment-tree with constructor args…');
const contractId = await deployWithConstructor({
  server,
  networkPassphrase: NETWORK,
  keypair,
  wasm: fs.readFileSync(WASM),
  constructorArgs: ctor,
});
console.log(`  deployed: ${contractId}`);

async function simulate(method, args = []) {
  const account = await server.getAccount(admin);
  const tx = new TransactionBuilder(account, { fee: '100000', networkPassphrase: NETWORK })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  return server.simulateTransaction(tx);
}

const root = await simulate('get_merkle_root');
if (SorobanRpc.Api.isSimulationError(root)) throw new Error(`get_merkle_root failed: ${JSON.stringify(root.error)}`);
const rootHex = Buffer.from(scValToNative(root.result.retval)).toString('hex');
if (rootHex !== EMPTY_TREE_ROOT) throw new Error(`root ${rootHex} != empty-tree root - constructor did not run`);
console.log('  ✓ constructor ran atomically: root is the empty-tree root');

const init = await simulate('initialize', [Address.fromString(admin).toScVal()]);
if (!SorobanRpc.Api.isSimulationError(init)) {
  throw new Error('initialize still exists - it must not be callable after the constructor change');
}
console.log('  ✓ no initialize entry point: calling it fails');
console.log('\nValidation passed.');
