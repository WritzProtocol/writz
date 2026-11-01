#!/usr/bin/env node
/**
 * Read-only smoke check of a testnet deployment (#260). Signs and sends
 * nothing: every contract call is a simulation.
 *
 * For each contract it checks that the wasm running on chain is the one
 * recorded in contracts/deployments/testnet.md (sha256 of the on-chain code
 * against the recorded `wasm sha256`), then reads it:
 *   bitcoin-spv  checkpoint and best tip, and that the tip is recent
 *   writz-lend   protocol state, supply index, borrow and supply rates,
 *                timelock margin and tip age, and that it is a registered
 *                consumer of bitcoin-spv's txid registry
 *   relayer      /health: status ok, header sync running without error
 *
 * Usage:
 *   node scripts/deploy/smoke_testnet.mjs
 *   node scripts/deploy/smoke_testnet.mjs --writz-lend C... --bitcoin-spv C...
 *
 * Without flags it checks the current IDs in contracts/deployments/testnet.json.
 * Pass --writz-lend to check a new deployment before the app points at it.
 * Exits 1 if any check fails.
 */
import * as StellarSdk from '@stellar/stellar-sdk';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Account, Contract, Keypair, Networks, StrKey, TransactionBuilder, xdr, scValToNative, rpc: SorobanRpc } = StellarSdk;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const deployments = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts/deployments/testnet.json'), 'utf8'));
const testnetMd = fs.readFileSync(path.join(ROOT, 'contracts/deployments/testnet.md'), 'utf8');

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};
const ids = {
  bitcoinSpv: arg('--bitcoin-spv') ?? deployments.contracts.bitcoinSpv,
  writzLend: arg('--writz-lend') ?? deployments.contracts.writzLend,
};
for (const [name, id] of Object.entries(ids)) {
  if (!StrKey.isValidContract(id ?? '')) {
    console.error(`${name}: ${id} is not a contract ID`);
    process.exit(2);
  }
}

const server = new SorobanRpc.Server(deployments.rpcUrl);
const passphrase = Networks.TESTNET;
// Simulations need a source account but never touch it.
const source = new Account(Keypair.random().publicKey(), '0');

let failed = 0;
const pass = (msg) => console.log(`  ok    ${msg}`);
const fail = (msg) => { failed++; console.log(`  FAIL  ${msg}`); };

async function read(contractId, method, ...args) {
  const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: passphrase })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) throw new Error(`${method}: ${sim.error}`);
  return scValToNative(sim.result.retval);
}

/**
 * The `wasm sha256` recorded for this contract in testnet.md, if any: the one
 * in the same table as its `**Contract ID**` row, not wherever else the ID
 * appears (constructor arguments, history).
 */
function recordedSha256(contractId) {
  const at = testnetMd.indexOf(`**Contract ID** | \`${contractId}\``);
  if (at === -1) return undefined;
  const table = testnetMd.slice(at).split(/\n\s*\n/)[0];
  return table.match(/wasm sha256 \| `([0-9a-f]{64})`/)?.[1];
}

async function checkWasm(name, contractId) {
  const expected = recordedSha256(contractId);
  if (!expected) return fail(`${name} ${contractId} has no wasm sha256 in testnet.md`);
  const code = await server.getContractWasmByContractId(contractId);
  const actual = crypto.createHash('sha256').update(code).digest('hex');
  if (actual === expected) pass(`${name} wasm matches testnet.md (${actual.slice(0, 12)}…, ${code.length} bytes)`);
  else fail(`${name} wasm ${actual} does not match testnet.md ${expected}`);
}

async function step(label, fn) {
  try {
    await fn();
  } catch (e) {
    fail(`${label}: ${e.message}`);
  }
}

console.log(`Smoke check, testnet (read-only)\n  bitcoin-spv ${ids.bitcoinSpv}\n  writz-lend  ${ids.writzLend}\n`);

console.log('bitcoin-spv');
await step('bitcoin-spv wasm', () => checkWasm('bitcoin-spv', ids.bitcoinSpv));
await step('bitcoin-spv tip', async () => {
  const checkpoint = await read(ids.bitcoinSpv, 'get_checkpoint');
  const tip = await read(ids.bitcoinSpv, 'get_best_tip');
  if (!checkpoint || !tip) return fail('bitcoin-spv has no checkpoint or tip');
  pass(`checkpoint ${checkpoint.height}, best tip ${tip.height}`);
  const header = await read(ids.bitcoinSpv, 'get_header', xdr.ScVal.scvBytes(Buffer.from(tip.hash)));
  const ageSecs = Math.floor(Date.now() / 1000) - Number(header.time);
  // Signet mines about every 10 minutes; the relayer submits each block.
  if (ageSecs <= 6 * 3600) pass(`tip is ${Math.round(ageSecs / 60)} min old`);
  else fail(`tip is ${(ageSecs / 3600).toFixed(1)} h old: is the relayer submitting headers?`);
});

console.log('writz-lend');
await step('writz-lend wasm', () => checkWasm('writz-lend', ids.writzLend));
await step('writz-lend state', async () => {
  const p = await read(ids.writzLend, 'get_protocol_state');
  if (BigInt(p.supply_index) < 10n ** 18n) fail(`supply_index ${p.supply_index} is below 1e18`);
  else pass(`supply_index ${p.supply_index}, borrow_index ${p.borrow_index}`);
  pass(`total_scaled_supply ${p.total_scaled_supply}, total_borrowed ${p.total_borrowed}, reserve ${p.reserve_usdc} (stroops)`);
  const [borrowBp, supplyBp] = [await read(ids.writzLend, 'get_borrow_rate_bp'), await read(ids.writzLend, 'get_supply_rate_bp')];
  pass(`borrow rate ${borrowBp} bp, supply rate ${supplyBp} bp`);
  // Added by #356: a wasm built before it has neither view.
  try {
    const margin = await read(ids.writzLend, 'get_borrow_timelock_margin');
    const tipAge = await read(ids.writzLend, 'get_max_tip_age');
    pass(`borrow timelock margin ${margin} blocks, max tip age ${tipAge} s`);
  } catch (e) {
    if (!e.message.includes('non-existent contract function')) throw e;
    console.log('  --    no borrow timelock margin in this wasm (built before #356)');
  }
});
await step('writz-lend consumer', async () => {
  // A deposit on a lender that is not a registered consumer fails.
  // bitcoin-spv has no view for it, so read its DataKey::Consumer entry.
  const key = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Consumer'), new StellarSdk.Address(ids.writzLend).toScVal()]);
  let registered = false;
  try {
    const entry = await server.getContractData(ids.bitcoinSpv, key, SorobanRpc.Durability.Persistent);
    registered = scValToNative(entry.val.contractData().val()) === true;
  } catch {
    registered = false;
  }
  if (registered) pass('registered as a bitcoin-spv consumer');
  else fail('not a registered bitcoin-spv consumer (or its entry is archived): deposits will fail');
});

console.log('relayer');
await step('relayer health', async () => {
  const res = await fetch(`${deployments.relayerUrl}/health`);
  const h = await res.json();
  if (res.ok && h.status === 'ok') pass(`${deployments.relayerUrl}/health ok, target ${h.target}`);
  else fail(`/health returned ${res.status} ${h.status}`);
  const sync = h.headerSync;
  if (sync?.enabled && !sync.lastError) pass(`header sync at ${sync.contractTipHeight} (bitcoin tip ${sync.bitcoinTipHeight})`);
  else fail(`header sync: ${sync?.lastError ?? 'disabled'}`);
});

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
