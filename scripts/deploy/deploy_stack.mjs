#!/usr/bin/env node
/**
 * The coordinated redeploy (#177): every Writz Soroban contract, deployed
 * through its constructor, then wired together in the order the contracts
 * require.
 *
 *   1. zk-verifier      __constructor(admin)
 *   2. bitcoin-spv      __constructor(admin, pow_limit_bits)
 *                       set_checkpoint(...)            (callable once)
 *                       set_submitter(admin, relayer)  (mandatory on signet)
 *   3. commitment-tree  __constructor(admin, spv, zk_verifier, usdc, oracle,
 *                                     min_confirmations, protocol_pubkey)
 *   4. private-lend     __constructor(admin, spv, usdc, oracle, keeper,
 *                                     relayer, protocol_pubkey)
 *   5. verification keys for Deposit, BorrowRepay, Liquidation, ZeroDebt, Insert
 *   6. set_consumer on bitcoin-spv for both lenders
 *   7. set_max_total_borrowed on both lenders, when MAX_TOTAL_BORROWED is set
 *
 * Without --execute it only validates the inputs and prints the plan; nothing
 * is sent. Do not run it with --execute without the project owner's explicit
 * sign-off for that network. Mainnet also needs CONFIRM_MAINNET=I_HAVE_SIGN_OFF
 * and a production ceremony manifest (circuits/keys/CEREMONY_MANIFEST.json).
 *
 * The admin is the deployer account (ADMIN_SECRET). Move it behind the 2-of-3
 * multisig (docs/security/security-model.md) right after the run - the
 * contracts check the admin address, not its signer setup, so this needs no
 * contract call.
 *
 * Usage:
 *   (cd contracts && cargo build --release --target wasm32v1-none --locked)
 *   STELLAR_NETWORK=testnet BITCOIN_NETWORK=signet ADMIN_SECRET=S... \
 *   RELAYER_ADDRESS=G... KEEPER_ADDRESS=G... USDC_TOKEN=C... ORACLE=C... \
 *   PROTOCOL_PUBKEY=02... CHECKPOINT_HEIGHT=... CHECKPOINT_HASH=... \
 *   CHECKPOINT_BITS=0x... CHECKPOINT_TIME=... CHECKPOINT_PERIOD_START_TIME=... \
 *     node deploy_stack.mjs [--execute]
 */
import * as StellarSdk from '@stellar/stellar-sdk';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deployWithConstructor } from './constructor_deploy.mjs';

const { Keypair, Networks, Address, Contract, StrKey, TransactionBuilder, xdr, nativeToScVal, rpc: SorobanRpc } = StellarSdk;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const WASM_DIR = path.join(ROOT, 'contracts/target/wasm32v1-none/release');
const KEYS_DIR = path.join(ROOT, 'circuits/keys');

const EXECUTE = process.argv.includes('--execute');

// ── inputs ───────────────────────────────────────────────────────────────────
const STELLAR = {
  // The quickstart standalone network, for rehearsing the whole run.
  local: { rpc: 'http://localhost:8000/soroban/rpc', passphrase: Networks.STANDALONE },
  testnet: { rpc: 'https://soroban-testnet.stellar.org', passphrase: Networks.TESTNET },
  // SDF runs no public mainnet RPC: set RPC_URL to a provider's endpoint.
  mainnet: { rpc: undefined, passphrase: Networks.PUBLIC },
};
// Proof-of-work floors bitcoin-spv validates headers against.
const POW_LIMIT_BITS = { mainnet: 0x1d00ffff, signet: 0x1e0377ae };

const errors = [];
const env = (name, check, hint) => {
  const v = process.env[name]?.trim();
  if (!v) { errors.push(`${name} is not set${hint ? ` (${hint})` : ''}`); return undefined; }
  if (check && !check(v)) { errors.push(`${name} is invalid${hint ? ` (${hint})` : ''}`); return undefined; }
  return v;
};
const isAccount = (v) => StrKey.isValidEd25519PublicKey(v);
const isContract = (v) => StrKey.isValidContract(v);
const isUint = (v) => /^(0x[0-9a-f]+|\d+)$/i.test(v);
const toUint = (v) => (v === undefined ? undefined : Number(v));

const stellarNetwork = env('STELLAR_NETWORK', (v) => v in STELLAR, 'local, testnet or mainnet');
const bitcoinNetwork = env('BITCOIN_NETWORK', (v) => v in POW_LIMIT_BITS, 'mainnet or signet');
if (stellarNetwork === 'mainnet' && bitcoinNetwork && bitcoinNetwork !== 'mainnet') {
  errors.push('a mainnet deployment must verify Bitcoin mainnet headers');
}
const adminSecret = env('ADMIN_SECRET', (v) => StrKey.isValidEd25519SecretSeed(v), 'S... secret of the deployer and admin');
const relayer = env('RELAYER_ADDRESS', isAccount, "G... account of the relayer's RELAYER_SECRET");
const keeper = env('KEEPER_ADDRESS', isAccount, 'G... liquidation keeper');
const usdc = env('USDC_TOKEN', isContract, 'C... USDC Stellar Asset Contract');
const oracle = env('ORACLE', isContract, "C... Reflector oracle (docs/research/oracle-design.md)");
const protocolPubkey = env('PROTOCOL_PUBKEY', (v) => /^0[23][0-9a-f]{64}$/i.test(v),
  'compressed 33-byte hex key matching the relayer KMS key or PROTOCOL_SIGNING_KEY');
const checkpoint = {
  height: toUint(env('CHECKPOINT_HEIGHT', isUint)),
  hash: env('CHECKPOINT_HASH', (v) => /^[0-9a-f]{64}$/i.test(v), 'block hash, display (explorer) byte order'),
  bits: toUint(env('CHECKPOINT_BITS', isUint)),
  time: toUint(env('CHECKPOINT_TIME', isUint)),
  periodStartTime: toUint(env('CHECKPOINT_PERIOD_START_TIME', isUint)),
};
const minConfirmations = toUint(process.env.MIN_CONFIRMATIONS ?? '6');
const maxTotalBorrowed = process.env.MAX_TOTAL_BORROWED ? BigInt(process.env.MAX_TOTAL_BORROWED) : undefined;
const rpcUrl = process.env.RPC_URL ?? (stellarNetwork ? STELLAR[stellarNetwork].rpc : undefined);
if (stellarNetwork && !rpcUrl) errors.push('RPC_URL is not set (a mainnet Soroban RPC provider endpoint)');

if (stellarNetwork === 'mainnet') {
  if (process.env.CONFIRM_MAINNET !== 'I_HAVE_SIGN_OFF') {
    errors.push('mainnet needs CONFIRM_MAINNET=I_HAVE_SIGN_OFF (the project owner\'s explicit sign-off)');
  }
  if (!fs.existsSync(path.join(KEYS_DIR, 'CEREMONY_MANIFEST.json'))) {
    errors.push('mainnet needs the production ceremony keys (circuits/keys/CEREMONY_MANIFEST.json is missing)');
  }
  if (minConfirmations < 6) errors.push('mainnet needs MIN_CONFIRMATIONS >= 6');
}

const WASMS = ['zk_verifier', 'bitcoin_spv', 'commitment_tree', 'private_lend'];
const wasm = {};
for (const name of WASMS) {
  const file = path.join(WASM_DIR, `${name}.wasm`);
  if (!fs.existsSync(file)) { errors.push(`${file} not built`); continue; }
  wasm[name] = fs.readFileSync(file);
}
const CIRCUITS = [
  ['Deposit', 'deposit'], ['BorrowRepay', 'borrow_repay'], ['Liquidation', 'liquidation'],
  ['ZeroDebt', 'zero_debt'], ['Insert', 'insert'],
];
const vkeys = {};
for (const [circuit, file] of CIRCUITS) {
  const p = path.join(KEYS_DIR, `${file}_vkey.json`);
  if (!fs.existsSync(p)) { errors.push(`${p} is missing`); continue; }
  vkeys[circuit] = JSON.parse(fs.readFileSync(p, 'utf8'));
}

if (errors.length) {
  console.error('Cannot deploy:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}

const admin = Keypair.fromSecret(adminSecret);
const passphrase = STELLAR[stellarNetwork].passphrase;
const powLimitBits = POW_LIMIT_BITS[bitcoinNetwork];
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ── plan ─────────────────────────────────────────────────────────────────────
console.log(`Writz coordinated redeploy - ${stellarNetwork} (Bitcoin ${bitcoinNetwork})`);
console.log(`  rpc               ${rpcUrl}`);
console.log(`  admin / deployer  ${admin.publicKey()}`);
console.log(`  relayer           ${relayer}  (private-lend relayer${bitcoinNetwork === 'signet' ? ', bitcoin-spv submitter' : ''})`);
console.log(`  keeper            ${keeper}`);
console.log(`  usdc              ${usdc}`);
console.log(`  oracle            ${oracle}`);
console.log(`  protocol pubkey   ${protocolPubkey}`);
console.log(`  pow limit bits    0x${powLimitBits.toString(16)}`);
console.log(`  checkpoint        height ${checkpoint.height}, ${checkpoint.hash}, bits 0x${checkpoint.bits.toString(16)}`);
console.log(`  min confirmations ${minConfirmations}`);
console.log(`  exposure cap      ${maxTotalBorrowed === undefined ? 'contract default (50,000 USDC per lender)' : `${maxTotalBorrowed} stroops per lender`}`);
console.log('  wasm sha256');
for (const name of WASMS) console.log(`    ${name.padEnd(16)} ${sha256(wasm[name])}`);
console.log('  verification keys');
for (const [circuit] of CIRCUITS) console.log(`    ${circuit.padEnd(16)} ${vkeys[circuit].IC.length} IC points`);

if (!EXECUTE) {
  console.log('\nDry run: inputs are valid, nothing was sent. Re-run with --execute once deploying is signed off.');
  process.exit(0);
}

// ── chain helpers ────────────────────────────────────────────────────────────
const server = new SorobanRpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });

async function invoke(contractId, method, args) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const account = await server.getAccount(admin.publicKey());
    const tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: passphrase })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(60)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) throw new Error(`${method} simulation failed: ${sim.error}`);
    const prepared = SorobanRpc.assembleTransaction(tx, sim).build();
    prepared.sign(admin);
    const sent = await server.sendTransaction(prepared);
    if (sent.status === 'ERROR') {
      if (JSON.stringify(sent).includes('txBadSeq') && attempt < 5) { await new Promise((r) => setTimeout(r, 2500)); continue; }
      throw new Error(`${method} submit failed: ${JSON.stringify(sent.errorResult)}`);
    }
    for (let i = 0; i < 60; i++) {
      const res = await server.getTransaction(sent.hash);
      if (res.status === 'SUCCESS') return sent.hash;
      if (res.status === 'FAILED') throw new Error(`${method} failed: tx ${sent.hash}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error(`${method} timed out: tx ${sent.hash}`);
  }
  throw new Error(`${method}: exhausted retries`);
}

const addr = (a) => Address.fromString(a).toScVal();
const u32 = (n) => nativeToScVal(n, { type: 'u32' });
const bytes = (buf) => xdr.ScVal.scvBytes(Buffer.from(buf));
const hex32 = (n) => BigInt(n).toString(16).padStart(64, '0');
const point = (hex) => xdr.ScVal.scvMap([
  new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('bytes'), val: xdr.ScVal.scvBytes(Buffer.from(hex, 'hex')) }),
]);
const g1 = (p) => point(hex32(p[0]) + hex32(p[1]));
// G2 in EIP-197 order: x.c1 || x.c0 || y.c1 || y.c0
const g2 = (p) => point(hex32(p[0][1]) + hex32(p[0][0]) + hex32(p[1][1]) + hex32(p[1][0]));
const entry = (k, v) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v });
const vkeyVal = (vk) => xdr.ScVal.scvMap([
  entry('alpha_g1', g1(vk.vk_alpha_1)), entry('beta_g2', g2(vk.vk_beta_2)), entry('delta_g2', g2(vk.vk_delta_2)),
  entry('gamma_g2', g2(vk.vk_gamma_2)), entry('ic', xdr.ScVal.scvVec(vk.IC.map(g1))),
]);

// ── run ──────────────────────────────────────────────────────────────────────
const deployer = { server, networkPassphrase: passphrase, keypair: admin };
const out = { network: stellarNetwork, bitcoinNetwork, admin: admin.publicKey(), txs: {} };

console.log('\n1. zk-verifier');
out.zkVerifier = await deployWithConstructor({ ...deployer, wasm: wasm.zk_verifier, constructorArgs: [addr(admin.publicKey())] });
console.log(`   ${out.zkVerifier}`);

console.log('2. bitcoin-spv');
out.bitcoinSpv = await deployWithConstructor({
  ...deployer, wasm: wasm.bitcoin_spv, constructorArgs: [addr(admin.publicKey()), u32(powLimitBits)],
});
console.log(`   ${out.bitcoinSpv}`);
// The contract stores block hashes in internal byte order; explorers show them reversed.
out.txs.setCheckpoint = await invoke(out.bitcoinSpv, 'set_checkpoint', [
  addr(admin.publicKey()), u32(checkpoint.height), bytes(Buffer.from(checkpoint.hash, 'hex').reverse()),
  u32(checkpoint.bits), u32(checkpoint.time), u32(checkpoint.periodStartTime),
]);
console.log(`   checkpoint set at ${checkpoint.height}`);
if (bitcoinNetwork === 'signet') {
  // Signet blocks are authenticated by a signature bitcoin-spv does not verify;
  // only the relayer may submit headers there.
  out.txs.setSubmitter = await invoke(out.bitcoinSpv, 'set_submitter', [addr(admin.publicKey()), addr(relayer)]);
  console.log(`   header submitter restricted to ${relayer}`);
}

const protocolKey = Buffer.from(protocolPubkey, 'hex');
console.log('3. commitment-tree');
out.commitmentTree = await deployWithConstructor({
  ...deployer, wasm: wasm.commitment_tree,
  constructorArgs: [
    addr(admin.publicKey()), addr(out.bitcoinSpv), addr(out.zkVerifier), addr(usdc), addr(oracle),
    u32(minConfirmations), bytes(protocolKey),
  ],
});
console.log(`   ${out.commitmentTree}`);

console.log('4. private-lend');
out.privateLend = await deployWithConstructor({
  ...deployer, wasm: wasm.private_lend,
  constructorArgs: [
    addr(admin.publicKey()), addr(out.bitcoinSpv), addr(usdc), addr(oracle), addr(keeper), addr(relayer),
    bytes(protocolKey),
  ],
});
console.log(`   ${out.privateLend}`);

console.log('5. verification keys');
for (const [circuit] of CIRCUITS) {
  out.txs[`vkey${circuit}`] = await invoke(out.zkVerifier, 'set_verification_key', [
    addr(admin.publicKey()), xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(circuit)]), vkeyVal(vkeys[circuit]),
  ]);
  console.log(`   ${circuit}`);
}

console.log('6. register both lenders with the shared txid registry');
for (const [name, id] of [['commitment-tree', out.commitmentTree], ['private-lend', out.privateLend]]) {
  out.txs[`consumer_${name}`] = await invoke(out.bitcoinSpv, 'set_consumer', [
    addr(admin.publicKey()), addr(id), nativeToScVal(true),
  ]);
  console.log(`   ${name}`);
}

if (maxTotalBorrowed !== undefined) {
  // A borrower can reclaim BTC through the timelock exit while still owing
  // USDC, so each lender's total exposure is capped (GHSA-5rxp).
  console.log('7. exposure cap');
  for (const [name, id] of [['commitment-tree', out.commitmentTree], ['private-lend', out.privateLend]]) {
    out.txs[`maxTotalBorrowed_${name}`] = await invoke(id, 'set_max_total_borrowed', [
      addr(admin.publicKey()), nativeToScVal(maxTotalBorrowed, { type: 'i128' }),
    ]);
    console.log(`   ${name}: ${maxTotalBorrowed} stroops`);
  }
}

out.wasmSha256 = Object.fromEntries(WASMS.map((n) => [n, sha256(wasm[n])]));
const record = path.join(__dirname, `deployment-${stellarNetwork}-${Date.now()}.json`);
fs.writeFileSync(record, JSON.stringify(out, null, 2) + '\n');

console.log(`\nDeployed. Record written to ${path.relative(ROOT, record)}.`);
console.log('\nfrontend/app/.env');
console.log(`NEXT_PUBLIC_ZK_VERIFIER_ID=${out.zkVerifier}`);
console.log(`NEXT_PUBLIC_BITCOIN_SPV_ID=${out.bitcoinSpv}`);
console.log(`NEXT_PUBLIC_COMMITMENT_TREE_ID=${out.commitmentTree}`);
console.log(`NEXT_PUBLIC_PRIVATE_LEND_ID=${out.privateLend}`);
console.log('\nrelayer/.env');
console.log(`COMMITMENT_TREE_ID=${out.commitmentTree}`);
console.log(`PRIVATE_LEND_ID=${out.privateLend}`);
console.log(`BITCOIN_SPV_ID=${out.bitcoinSpv}`);
console.log(`SPV_SYNC_FROM_HEIGHT=${checkpoint.height}`);
console.log('\nNext: put the admin account behind the multisig, then record the addresses in contracts/deployments/.');
