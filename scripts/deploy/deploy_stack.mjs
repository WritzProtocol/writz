#!/usr/bin/env node
/**
 * The coordinated redeploy (#177): every Writz Soroban contract, deployed
 * through its constructor, then wired together in the order the contracts
 * require.
 *
 *   1. bitcoin-spv      __constructor(admin, pow_limit_bits,
 *                                     header_ttl_ledgers, consumed_ttl_ledgers)
 *                       set_checkpoint(...)            (callable once)
 *                       set_submitter(admin, relayer)  (mandatory on signet)
 *   2. writz-lend       __constructor(admin, spv, usdc, oracle, keeper,
 *                                     relayer, protocol_pubkey,
 *                                     min_confirmations, min_deposit_satoshis,
 *                                     entry_ttl_ledgers)
 *   3. set_consumer on bitcoin-spv for writz-lend
 *   4. set_max_total_borrowed on writz-lend, when MAX_TOTAL_BORROWED is set
 *
 * --lend-only redeploys writz-lend alone against an existing bitcoin-spv
 * (SPV_CONTRACT=C...), for a writz-lend change that leaves bitcoin-spv as it
 * is (#260): steps 2 to 4, with no checkpoint inputs.
 * The deployer must be bitcoin-spv's admin, since step 3 calls set_consumer
 * on it. The previous writz-lend stays a consumer until its admin removes it.
 *
 * Without --execute it only validates the inputs and prints the plan; nothing
 * is sent. Do not run it with --execute without the project owner's explicit
 * sign-off for that network. Mainnet also needs CONFIRM_MAINNET=I_HAVE_SIGN_OFF.
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
 *   PROTOCOL_PUBKEY=02... \
 *   CHECKPOINT_HEIGHT=... CHECKPOINT_HASH=... \
 *   CHECKPOINT_BITS=0x... CHECKPOINT_TIME=... CHECKPOINT_PERIOD_START_TIME=... \
 *     node deploy_stack.mjs [--execute]
 *
 *   # writz-lend alone, against the bitcoin-spv already deployed:
 *   (cd contracts && cargo build --release --target wasm32v1-none --locked -p writz-lend)
 *   STELLAR_NETWORK=testnet BITCOIN_NETWORK=signet ADMIN_SECRET=S... \
 *   SPV_CONTRACT=C... RELAYER_ADDRESS=G... KEEPER_ADDRESS=G... USDC_TOKEN=C... \
 *   ORACLE=C... PROTOCOL_PUBKEY=02... \
 *     node deploy_stack.mjs --lend-only [--execute]
 *
 * After a testnet run, check it read-only with smoke_testnet.mjs.
 *
 * Optional: MIN_CONFIRMATIONS (default 6), MIN_DEPOSIT_SATS (writz-lend,
 * default 100000; testnet runs 1 and 5000), MAX_TOTAL_BORROWED.
 *
 * Storage TTL windows, in ledgers (17,280 a day). The transaction that creates
 * an entry pays rent for its whole window, so where rent is priced high
 * (testnet) they run short:
 *   ENTRY_TTL_LEDGERS        writz-lend per-user entries (position, supply
 *                            balance, release PSBT). Default 3110400 (180 days);
 *                            testnet runs 691200 (40 days).
 *   SPV_HEADER_TTL_LEDGERS   bitcoin-spv header and height-index entries, two
 *                            per submitted block. Default 1555200 (90 days);
 *                            testnet runs 120960 (7 days, the network minimum).
 *   SPV_CONSUMED_TTL_LEDGERS bitcoin-spv consumed-deposit markers. Default
 *                            1555200 (90 days); testnet runs 120960.
 * Mainnet refuses anything shorter than the defaults.
 *
 * MAX_RESOURCE_FEE_XLM caps the resource fee any one transaction may declare;
 * the run refuses to sign above it. Required on mainnet, unlimited elsewhere
 * when unset (a testnet wasm upload declares several thousand XLM).
 */
import * as StellarSdk from '@stellar/stellar-sdk';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildSigned, deployWithConstructor, sendAndConfirm } from './constructor_deploy.mjs';

const { Keypair, Networks, Address, Contract, StrKey, TransactionBuilder, xdr, nativeToScVal, rpc: SorobanRpc } = StellarSdk;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const WASM_DIR = path.join(ROOT, 'contracts/target/wasm32v1-none/release');
const EXECUTE = process.argv.includes('--execute');
const LEND_ONLY = process.argv.includes('--lend-only');

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
// --lend-only wires writz-lend to this bitcoin-spv instead of deploying one,
// so it needs no checkpoint.
const existingSpv = LEND_ONLY ? env('SPV_CONTRACT', isContract, 'C... bitcoin-spv already deployed') : undefined;
const checkpoint = LEND_ONLY ? undefined : {
  height: toUint(env('CHECKPOINT_HEIGHT', isUint)),
  hash: env('CHECKPOINT_HASH', (v) => /^[0-9a-f]{64}$/i.test(v), 'block hash, display (explorer) byte order'),
  bits: toUint(env('CHECKPOINT_BITS', isUint)),
  time: toUint(env('CHECKPOINT_TIME', isUint)),
  periodStartTime: toUint(env('CHECKPOINT_PERIOD_START_TIME', isUint)),
};
const minConfirmations = toUint(process.env.MIN_CONFIRMATIONS ?? '6');
// writz-lend's smallest deposit. Signet runs lower so one faucet payout covers a deposit.
const minDepositSats = BigInt(process.env.MIN_DEPOSIT_SATS ?? '100000');
// Storage TTL windows (see the header). Mainnet keeps the long defaults.
const DAY = 17_280;
const ttl = (name, fallback) => {
  const v = toUint(process.env[name] ?? String(fallback));
  if (!Number.isInteger(v) || v < DAY || v > 180 * DAY) errors.push(`${name} must be ${DAY} to ${180 * DAY} ledgers`);
  if (stellarNetwork === 'mainnet' && v < fallback) errors.push(`mainnet needs ${name} >= ${fallback}`);
  return v;
};
const entryTtl = ttl('ENTRY_TTL_LEDGERS', 180 * DAY);
const headerTtl = ttl('SPV_HEADER_TTL_LEDGERS', 90 * DAY);
const consumedTtl = ttl('SPV_CONSUMED_TTL_LEDGERS', 90 * DAY);
const maxTotalBorrowed = process.env.MAX_TOTAL_BORROWED ? BigInt(process.env.MAX_TOTAL_BORROWED) : undefined;
const rpcUrl = process.env.RPC_URL ?? (stellarNetwork ? STELLAR[stellarNetwork].rpc : undefined);
if (stellarNetwork && !rpcUrl) errors.push('RPC_URL is not set (a mainnet Soroban RPC provider endpoint)');

if (stellarNetwork === 'mainnet') {
  if (process.env.CONFIRM_MAINNET !== 'I_HAVE_SIGN_OFF') {
    errors.push('mainnet needs CONFIRM_MAINNET=I_HAVE_SIGN_OFF (the project owner\'s explicit sign-off)');
  }
  if (minConfirmations < 6) errors.push('mainnet needs MIN_CONFIRMATIONS >= 6');
  if (minDepositSats < 100_000n) errors.push('mainnet needs MIN_DEPOSIT_SATS >= 100000');
  if (!process.env.MAX_RESOURCE_FEE_XLM?.trim()) errors.push('mainnet needs MAX_RESOURCE_FEE_XLM (the most resource fee, in XLM, to sign for)');
}

const WASMS = LEND_ONLY ? ['writz_lend'] : ['bitcoin_spv', 'writz_lend'];
const wasm = {};
for (const name of WASMS) {
  const file = path.join(WASM_DIR, `${name}.wasm`);
  if (!fs.existsSync(file)) { errors.push(`${file} not built`); continue; }
  wasm[name] = fs.readFileSync(file);
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
console.log(`Writz coordinated redeploy - ${stellarNetwork} (Bitcoin ${bitcoinNetwork})${LEND_ONLY ? ', writz-lend only' : V1_ONLY ? ', v1 only' : ''}`);
console.log(`  rpc               ${rpcUrl}`);
console.log(`  admin / deployer  ${admin.publicKey()}`);
console.log(`  relayer           ${relayer}  (writz-lend relayer${bitcoinNetwork === 'signet' && !LEND_ONLY ? ', bitcoin-spv submitter' : ''})`);
console.log(`  keeper            ${keeper}`);
console.log(`  usdc              ${usdc}`);
console.log(`  oracle            ${oracle}`);
console.log(`  protocol pubkey   ${protocolPubkey}`);
if (LEND_ONLY) {
  console.log(`  bitcoin-spv       ${existingSpv}  (existing, not redeployed)`);
} else {
  console.log(`  pow limit bits    0x${powLimitBits.toString(16)}`);
  console.log(`  checkpoint        height ${checkpoint.height}, ${checkpoint.hash}, bits 0x${checkpoint.bits.toString(16)}`);
}
console.log(`  min confirmations ${minConfirmations}`);
console.log(`  min deposit       ${minDepositSats} sats (writz-lend)`);
const days = (l) => `${l} ledgers (${(l / DAY).toFixed(1)} days)`;
console.log(`  entry ttl         ${days(entryTtl)} (writz-lend positions, supply balances, release PSBTs)`);
if (!LEND_ONLY) {
  console.log(`  header ttl        ${days(headerTtl)} (bitcoin-spv)`);
  console.log(`  consumed ttl      ${days(consumedTtl)} (bitcoin-spv)`);
}
console.log(`  exposure cap      ${maxTotalBorrowed === undefined ? 'contract default (50,000 USDC)' : `${maxTotalBorrowed} stroops per lender`}`);
console.log('  wasm sha256');
for (const name of WASMS) console.log(`    ${name.padEnd(16)} ${sha256(wasm[name])}`);
if (!EXECUTE) {
  console.log('\nDry run: inputs are valid, nothing was sent. Re-run with --execute once deploying is signed off.');
  process.exit(0);
}

// ── chain helpers ────────────────────────────────────────────────────────────
const server = new SorobanRpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });

async function invoke(contractId, method, args) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    let prepared;
    try {
      prepared = await buildSigned(server, passphrase, admin, new Contract(contractId).call(method, ...args));
    } catch (e) {
      throw new Error(`${method}: ${e.message}`);
    }
    try {
      await sendAndConfirm(server, prepared);
      return prepared.hash().toString('hex');
    } catch (e) {
      if (e.message.includes('txBadSeq') && attempt < 5) { await new Promise((r) => setTimeout(r, 2500)); continue; }
      throw new Error(`${method}: ${e.message}`);
    }
  }
  throw new Error(`${method}: exhausted retries`);
}

const addr = (a) => Address.fromString(a).toScVal();
const u32 = (n) => nativeToScVal(n, { type: 'u32' });
const u64 = (n) => nativeToScVal(n, { type: 'u64' });
const bytes = (buf) => xdr.ScVal.scvBytes(Buffer.from(buf));

// ── run ──────────────────────────────────────────────────────────────────────
const deployer = { server, networkPassphrase: passphrase, keypair: admin };
const out = { network: stellarNetwork, bitcoinNetwork, admin: admin.publicKey(), txs: {} };

if (LEND_ONLY) {
  out.bitcoinSpv = existingSpv;
  console.log(`\n1. bitcoin-spv: reusing ${existingSpv}`);
} else {
  console.log('\n1. bitcoin-spv');
  out.bitcoinSpv = await deployWithConstructor({
    ...deployer, wasm: wasm.bitcoin_spv, constructorArgs: [addr(admin.publicKey()), u32(powLimitBits), u32(headerTtl), u32(consumedTtl)],
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
}

const protocolKey = Buffer.from(protocolPubkey, 'hex');
console.log('2. writz-lend');
out.writzLend = await deployWithConstructor({
  ...deployer, wasm: wasm.writz_lend,
  constructorArgs: [
    addr(admin.publicKey()), addr(out.bitcoinSpv), addr(usdc), addr(oracle), addr(keeper), addr(relayer),
    bytes(protocolKey), u32(minConfirmations), u64(minDepositSats), u32(entryTtl),
  ],
});
console.log(`   ${out.writzLend}`);

console.log('3. register writz-lend with the shared txid registry');
out.txs.consumer_writz_lend = await invoke(out.bitcoinSpv, 'set_consumer', [
  addr(admin.publicKey()), addr(out.writzLend), nativeToScVal(true),
]);

if (maxTotalBorrowed !== undefined) {
  // A borrower can reclaim BTC through the timelock exit while still owing
  // USDC, so total exposure is capped (GHSA-5rxp).
  console.log('4. exposure cap');
  out.txs.maxTotalBorrowed = await invoke(out.writzLend, 'set_max_total_borrowed', [
    addr(admin.publicKey()), nativeToScVal(maxTotalBorrowed, { type: 'i128' }),
  ]);
  console.log(`   ${maxTotalBorrowed} stroops`);
}

out.wasmSha256 = Object.fromEntries(WASMS.map((n) => [n, sha256(wasm[n])]));
const record = path.join(__dirname, `deployment-${stellarNetwork}-${Date.now()}.json`);
fs.writeFileSync(record, JSON.stringify(out, null, 2) + '\n');

console.log(`\nDeployed. Record written to ${path.relative(ROOT, record)}.`);
console.log('\nfrontend/app/.env');
console.log(`NEXT_PUBLIC_BITCOIN_SPV_ID=${out.bitcoinSpv}`);
console.log(`NEXT_PUBLIC_WRITZ_LEND_ID=${out.writzLend}`);
console.log('\nrelayer/.env');
console.log(`WRITZ_LEND_ID=${out.writzLend}`);
console.log(`BITCOIN_SPV_ID=${out.bitcoinSpv}`);
if (!LEND_ONLY) console.log(`SPV_SYNC_FROM_HEIGHT=${checkpoint.height}`);
console.log('\nNext: put the admin account behind the multisig, then record the addresses in contracts/deployments/.');
