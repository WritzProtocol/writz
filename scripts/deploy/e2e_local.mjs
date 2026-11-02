#!/usr/bin/env node
/**
 * End-to-end check on a LOCAL Stellar network (no testnet, no real keys).
 *
 * Deploys bitcoin-spv and writz-lend through their constructors and runs a
 * real SPV-verified deposit, with supply and withdrawal of the pool. It also
 * runs the attacks the security remediation closed and expects each to fail:
 *   - a deposit claiming an output locked to another key, or with a timelock
 *     outside the allowed window (#177)
 *   - a deposit without a signature from the Bitcoin key it names, or with
 *     that signature replayed from another account (GHSA-862g)
 *   - the same Bitcoin txid deposited into a lender that is not a registered
 *     consumer, and into a second lender after the first (GHSA-2975)
 *
 * Unit tests run with mocked auth; this runs with real auth, including the
 * lending contract calling bitcoin-spv's consumed-txid registry on its own
 * behalf (GHSA-2975). Borrow and repay read the oracle, so they are covered by
 * writz-lend's unit tests against a mock oracle, not here.
 *
 * Usage:
 *   docker run -d --rm --name writz-local-stellar -p 8000:8000 \
 *     stellar/quickstart:latest --local --enable rpc
 *   (cd contracts && stellar contract build)
 *   node scripts/deploy/e2e_local.mjs
 *
 * It refuses to run against anything but the local standalone network.
 */
import * as StellarSdk from '@stellar/stellar-sdk';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deployWithConstructor } from './constructor_deploy.mjs';
import { secp256k1 } from '@noble/curves/secp256k1';

const {
  Keypair, Address, Contract, TransactionBuilder, Operation, Asset, xdr, nativeToScVal, scValToNative,
  rpc: SorobanRpc,
} = StellarSdk;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const WASM = (name) => fs.readFileSync(path.join(ROOT, 'contracts', 'target/wasm32v1-none/release', `${name}.wasm`));

const RPC_URL = process.env.RPC_URL ?? 'http://localhost:8000/soroban/rpc';
const FRIENDBOT = process.env.FRIENDBOT_URL ?? 'http://localhost:8000/friendbot';
const PASSPHRASE = 'Standalone Network ; February 2017';
if (process.env.NETWORK_PASSPHRASE && process.env.NETWORK_PASSPHRASE !== PASSPHRASE) {
  throw new Error('e2e_local only runs against the local standalone network');
}

const server = new SorobanRpc.Server(RPC_URL, { allowHttp: true });

// ── constants shared with the contracts ──────────────────────────────────────
const COLLATERAL = 1_000_000n;            // sats paid to the vault
const EASY_BITS = 0x207f_ffff;
const CHECKPOINT_HEIGHT = 100_000;
const DEPOSIT_HEIGHT = CHECKPOINT_HEIGHT + 1;   // the first mined header holds the deposit
const TIMELOCK = DEPOSIT_HEIGHT + 52_560;      // ~1 year, inside 1,008..=105,000 above it
// Compressed secp256k1 encodings; the contracts check the prefix, not the point.
const PROTOCOL_PUBKEY = Buffer.concat([Buffer.from([0x02]), Buffer.alloc(32, 0x11)]);
// Real Bitcoin keys: deposits must be signed by the key they name (GHSA-862g).
const USER_KEY = Buffer.alloc(32, 0x42);
const OTHER_KEY = Buffer.alloc(32, 0x77);
const USER_PUBKEY = Buffer.from(secp256k1.getPublicKey(USER_KEY, true));
const OTHER_PUBKEY = Buffer.from(secp256k1.getPublicKey(OTHER_KEY, true));

// Error numbers, from writz-lend and from bitcoin-spv through its registry.
const ERR = { BadKeySig: 25, ScriptMismatch: 21, BadTimelock: 22, NotConsumer: 27, AlreadyConsumed: 26 };

// ── output ───────────────────────────────────────────────────────────────────
let passed = 0;
const ok = (msg) => { passed++; console.log(`  ✓ ${msg}`); };
const step = (msg) => console.log(`\n${msg}`);

// ── chain helpers ────────────────────────────────────────────────────────────
// The friendbot inside the quickstart image starts after the RPC reports healthy, so
// a fresh container answers 502 for a while. Retry instead of failing the run.
async function fund(pub) {
  let last = '';
  for (let attempt = 1; attempt <= 40; attempt++) {
    try {
      const res = await fetch(`${FRIENDBOT}?addr=${pub}`);
      if (res.ok) return;
      last = `${res.status} ${(await res.text()).slice(0, 120)}`;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`friendbot never became ready for ${pub}: ${last}`);
}

async function sendAndWait(tx) {
  const sent = await server.sendTransaction(tx);
  if (sent.status === 'ERROR') throw new Error(`submit failed: ${JSON.stringify(sent.errorResult)}`);
  for (let i = 0; i < 60; i++) {
    const res = await server.getTransaction(sent.hash);
    if (res.status === 'SUCCESS') return res;
    if (res.status === 'FAILED') throw new Error(`tx ${sent.hash} failed`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`tx ${sent.hash} timed out`);
}

async function build(source, contractId, method, args) {
  const account = await server.getAccount(source.publicKey());
  return new TransactionBuilder(account, { fee: '10000000', networkPassphrase: PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(60)
    .build();
}

/** Simulates a call and returns its decoded result, or throws with the contract error. */
async function simulate(source, contractId, method, args) {
  const sim = await server.simulateTransaction(await build(source, contractId, method, args));
  if (SorobanRpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return sim.result?.retval ? scValToNative(sim.result.retval) : undefined;
}

async function invoke(source, contractId, method, args) {
  const res = await invokeTx(source, contractId, method, args);
  return res.returnValue ? scValToNative(res.returnValue) : undefined;
}

/** Like `invoke`, but returns the confirmed transaction (with its events). */
async function invokeTx(source, contractId, method, args) {
  const tx = await build(source, contractId, method, args);
  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) throw new Error(`${method} simulation failed: ${sim.error}`);
  const prepared = SorobanRpc.assembleTransaction(tx, sim).build();
  prepared.sign(source);
  return sendAndWait(prepared);
}

/** Asserts a call is rejected with the given contract error number. */
async function expectError(source, contractId, method, args, errorNumber, what) {
  let message = '';
  try {
    await simulate(source, contractId, method, args);
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  if (!message.includes(`Error(Contract, #${errorNumber})`)) {
    throw new Error(`${what}: expected Error(Contract, #${errorNumber}), got: ${message || 'success'}`);
  }
  ok(`${what} is rejected (#${errorNumber})`);
}

// ── ScVal encoding ───────────────────────────────────────────────────────────
const addr = (pub) => Address.fromString(pub).toScVal();
const bytes = (buf) => xdr.ScVal.scvBytes(Buffer.from(buf));
const u32 = (n) => nativeToScVal(n, { type: 'u32' });
const i128 = (n) => nativeToScVal(n, { type: 'i128' });

// ── Bitcoin helpers ──────────────────────────────────────────────────────────
const sha256d = (d) => crypto.createHash('sha256').update(crypto.createHash('sha256').update(d).digest()).digest();

/** A BIP-137 signature (what a wallet's ECDSA "sign message" returns) over the
 * deposit authorization `spv-types::key_proof` rebuilds on-chain. */
function signDeposit(key, contractId, depositor, txidInternal) {
  const msg = Buffer.from(
    `Writz deposit\ncontract:${contractId}\ndepositor:${depositor}\ntxid:${Buffer.from(txidInternal).reverse().toString('hex')}`,
  );
  const magic = Buffer.from('Bitcoin Signed Message:\n');
  const framed = Buffer.concat([Buffer.from([magic.length]), magic, Buffer.from([msg.length]), msg]);
  const digest = sha256d(framed);
  const sig = secp256k1.sign(digest, key, { lowS: true });
  return Buffer.concat([Buffer.from([31 + sig.recovery]), Buffer.from(sig.toCompactRawBytes())]);
}

/** Minimal Bitcoin script number push, as `spv-types::script` encodes it. */
function scriptNumber(n) {
  const le = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) le.push(v % 256);
  if (le[le.length - 1] & 0x80) le.push(0);
  return Buffer.from([le.length, ...le]);
}

/** The Writz P2WSH scriptPubKey both lending contracts rebuild on deposit. */
function writzScriptPubKey(protocolPubkey, userPubkey, timelock) {
  const push33 = (k) => Buffer.concat([Buffer.from([0x21]), k]);
  const redeem = Buffer.concat([
    Buffer.from([0x63]), push33(protocolPubkey), Buffer.from([0xad]), push33(userPubkey), Buffer.from([0xac]),
    Buffer.from([0x67]), scriptNumber(timelock), Buffer.from([0xb1, 0x75]), push33(userPubkey), Buffer.from([0xac]),
    Buffer.from([0x68]),
  ]);
  return Buffer.concat([Buffer.from([0x00, 0x20]), crypto.createHash('sha256').update(redeem).digest()]);
}

function buildDepositTx(valueSat, spk) {
  const parts = [
    Buffer.from([1, 0, 0, 0]),                                  // version
    Buffer.from([1]), Buffer.alloc(32), Buffer.from([0xff, 0xff, 0xff, 0xff]), // 1 input, null prevout
    Buffer.from([0]), Buffer.from([0xfe, 0xff, 0xff, 0xff]),    // empty scriptSig, sequence
    Buffer.from([1]),                                           // 1 output
  ];
  const value = Buffer.alloc(8); value.writeBigUInt64LE(valueSat);
  parts.push(value, Buffer.from([spk.length]), spk, Buffer.alloc(4)); // locktime
  return Buffer.concat(parts);
}

function bitsToTarget(bits) {
  const exponent = (bits >>> 24) & 0xff;
  const mantissa = BigInt(bits & 0x007f_ffff);
  return mantissa << BigInt(8 * (exponent - 3));
}

/** Mines an 80-byte header at the easy difficulty (about two attempts on average). */
function mineHeader(prevHash, merkleRoot, time) {
  const h = Buffer.alloc(80);
  h.writeUInt32LE(1, 0);
  prevHash.copy(h, 4);
  merkleRoot.copy(h, 36);
  h.writeUInt32LE(time, 68);
  h.writeUInt32LE(EASY_BITS, 72);
  const target = bitsToTarget(EASY_BITS);
  for (let nonce = 0; nonce < 1_000_000; nonce++) {
    h.writeUInt32LE(nonce, 76);
    if (BigInt('0x' + Buffer.from(sha256d(h)).reverse().toString('hex')) < target) return h;
  }
  throw new Error('could not mine a header');
}

// ── the run ──────────────────────────────────────────────────────────────────
async function main() {
  step('Accounts');
  const admin = Keypair.random();
  const borrower = Keypair.random();
  const attacker = Keypair.random();
  await Promise.all([admin, borrower, attacker].map((k) => fund(k.publicKey())));
  ok('funded admin, borrower and attacker through the local friendbot');

  step('Token (the native asset stands in for USDC)');
  const nativeSac = Asset.native().contractId(PASSPHRASE);
  try {
    const account = await server.getAccount(admin.publicKey());
    const tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: PASSPHRASE })
      .addOperation(Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeCreateContract(new xdr.CreateContractArgs({
          contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAsset(Asset.native().toXDRObject()),
          executable: xdr.ContractExecutable.contractExecutableStellarAsset(),
        })),
        auth: [],
      })).setTimeout(60).build();
    const sim = await server.simulateTransaction(tx);
    if (!SorobanRpc.Api.isSimulationError(sim)) {
      const prepared = SorobanRpc.assembleTransaction(tx, sim).build();
      prepared.sign(admin);
      await sendAndWait(prepared);
    }
  } catch { /* already deployed */ }
  ok(`native asset contract ${nativeSac}`);

  step('Deploy through constructors (no separate initialize transaction)');
  const deployer = { server, networkPassphrase: PASSPHRASE, keypair: admin };
  const spvId = await deployWithConstructor({
    ...deployer, wasm: WASM('bitcoin_spv'), constructorArgs: [addr(admin.publicKey()), u32(EASY_BITS), u32(90 * 17_280), u32(90 * 17_280)],
  });
  ok(`bitcoin-spv  ${spvId}`);
  // The oracle is only read by borrow and liquidate, which this run does not call.
  const deployLender = () => deployWithConstructor({
    ...deployer, wasm: WASM('writz_lend'),
    constructorArgs: [
      addr(admin.publicKey()), addr(spvId), addr(nativeSac), addr(admin.publicKey()),
      addr(admin.publicKey()), addr(admin.publicKey()), bytes(PROTOCOL_PUBKEY),
      u32(6), nativeToScVal(100_000n, { type: 'u64' }), u32(180 * 17_280),
    ],
  });
  const lendId = await deployLender();
  ok(`writz-lend  ${lendId}`);
  const secondLendId = await deployLender();
  ok(`second writz-lend  ${secondLendId}`);

  step('Bitcoin side: a checkpoint, then six mined headers, the first holding the deposit');
  const rawTx = buildDepositTx(COLLATERAL, writzScriptPubKey(PROTOCOL_PUBKEY, USER_PUBKEY, TIMELOCK));
  const txid = sha256d(rawTx);
  const now = Math.floor(Date.now() / 1000);
  const checkpointHash = crypto.randomBytes(32);
  await invoke(admin, spvId, 'set_checkpoint', [
    addr(admin.publicKey()), u32(CHECKPOINT_HEIGHT), bytes(checkpointHash), u32(EASY_BITS), u32(now - 3600), u32(now - 7200),
  ]);
  const headers = [];
  let prev = checkpointHash;
  for (let i = 0; i < 6; i++) {
    const h = mineHeader(prev, i === 0 ? txid : crypto.randomBytes(32), now - 600 + i);
    headers.push(h);
    prev = sha256d(h);
  }
  await invoke(admin, spvId, 'submit_headers', [xdr.ScVal.scvVec(headers.map((h) => bytes(h)))]);
  const blockHash = sha256d(headers[0]);
  ok('bitcoin-spv accepted the header chain (proof-of-work and parentage checked on-chain)');

  step('Lending pool');
  const supplied = 10_000_000_000n;
  await invoke(admin, lendId, 'supply_usdc', [addr(admin.publicKey()), i128(supplied)]);
  ok('pool funded');
  await invoke(admin, lendId, 'withdraw_supply', [addr(admin.publicKey()), i128(1_000_000_000n)]);
  const balance = await simulate(admin, lendId, 'get_supply_balance', [addr(admin.publicKey())]);
  if (BigInt(balance) !== supplied - 1_000_000_000n) throw new Error(`unexpected supply balance ${balance}`);
  ok('a lender withdrew part of their supply and the balance followed');

  step('Deposit: real SPV verification');
  const depositScript = bytes(writzScriptPubKey(PROTOCOL_PUBKEY, USER_PUBKEY, TIMELOCK));
  const signFor = (key, contractId, who = borrower.publicKey()) => signDeposit(key, contractId, who, txid);
  const depositArgs = (contractId, { pubkey = USER_PUBKEY, timelock = TIMELOCK, script = depositScript, keySig = signFor(USER_KEY, contractId) } = {}) => [
    addr(borrower.publicKey()), bytes(blockHash), xdr.ScVal.scvVec([]), u32(0), bytes(rawTx),
    script, u32(timelock), bytes(pubkey), bytes(keySig),
  ];
  await expectError(borrower, lendId, 'deposit', depositArgs(lendId), ERR.NotConsumer,
    'a deposit into a lender bitcoin-spv has not registered');
  await invoke(admin, spvId, 'set_consumer', [addr(admin.publicKey()), addr(lendId), nativeToScVal(true)]);
  ok('writz-lend registered as a consumer of the shared txid registry');
  await expectError(borrower, lendId, 'deposit', depositArgs(lendId, { keySig: signFor(OTHER_KEY, lendId) }), ERR.BadKeySig,
    "a deposit of someone else's Writz output, without their Bitcoin key");
  await expectError(borrower, lendId, 'deposit', depositArgs(lendId, { keySig: signFor(USER_KEY, lendId, attacker.publicKey()) }), ERR.BadKeySig,
    'a key proof replayed from another account');
  await expectError(borrower, lendId, 'deposit', depositArgs(lendId, { pubkey: OTHER_PUBKEY, keySig: signFor(OTHER_KEY, lendId) }), ERR.ScriptMismatch,
    'a deposit claiming an output locked to another Bitcoin key');
  // The script commits to the same timelock, or the script check answers first.
  const earlyTimelock = DEPOSIT_HEIGHT + 1_007;
  await expectError(borrower, lendId, 'deposit', depositArgs(lendId, {
    timelock: earlyTimelock, script: bytes(writzScriptPubKey(PROTOCOL_PUBKEY, USER_PUBKEY, earlyTimelock)),
  }), ERR.BadTimelock,
    'a deposit whose timelock opens under 1,008 blocks after confirmation');
  await invoke(borrower, lendId, 'deposit', depositArgs(lendId));
  ok('deposit to the depositor\'s own Writz script accepted');
  if (!(await simulate(admin, spvId, 'is_deposit_consumed', [bytes(txid)]))) throw new Error('txid was not consumed in the shared registry');
  ok('the deposit txid is now consumed in bitcoin-spv (the lending contract called the registry with real auth)');

  await invoke(admin, spvId, 'set_consumer', [addr(admin.publicKey()), addr(secondLendId), nativeToScVal(true)]);
  await expectError(borrower, secondLendId, 'deposit', depositArgs(secondLendId), ERR.AlreadyConsumed,
    'the same txid deposited into a second lender');

  console.log(`\nAll ${passed} checks passed on the local network.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(`\nFAILED: ${e instanceof Error ? e.message : JSON.stringify(e)}`); process.exit(1); });
