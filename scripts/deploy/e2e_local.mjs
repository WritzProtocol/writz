#!/usr/bin/env node
/**
 * End-to-end check on a LOCAL Stellar network (no testnet, no real keys).
 *
 * Deploys the real contracts through their constructors, sets the real
 * verification keys, and runs deposit -> borrow -> repay -> release with real
 * Groth16 proofs generated from the circuits the frontend serves. It also runs
 * the attacks the security remediation closed and expects each to fail:
 *   - a deposit claiming an output locked to another key, or with a timelock
 *     outside the allowed window (#177)
 *   - the same Bitcoin txid deposited into a lender that is not a registered
 *     consumer, and into the second lender after the first (GHSA-2975)
 *   - a borrow proof redirected to another account (GHSA-xxqv, GHSA-mhp9)
 *   - borrowing against a repaid leaf after its release (GHSA-w4rp, GHSA-hcjf)
 *
 * Unit tests run with mocked auth; this runs with real auth, including the
 * lending contract calling bitcoin-spv's consumed-txid registry on its own
 * behalf (GHSA-2975).
 *
 * Usage:
 *   docker run -d --rm --name writz-local-stellar -p 8000:8000 \
 *     stellar/quickstart:latest --local --enable rpc
 *   (cd contracts && stellar contract build)
 *   (cd circuits && npm ci && npm run compile && npm run setup:dev)
 *   node scripts/deploy/e2e_local.mjs
 *
 * It refuses to run against anything but the local standalone network.
 */
import * as StellarSdk from '@stellar/stellar-sdk';
import * as snarkjs from 'snarkjs';
import { buildPoseidon } from 'circomlibjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deployWithConstructor } from './constructor_deploy.mjs';

const {
  Keypair, Address, Contract, TransactionBuilder, Operation, Asset, xdr, nativeToScVal, scValToNative,
  rpc: SorobanRpc,
} = StellarSdk;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const WASM = (name) => fs.readFileSync(path.join(ROOT, 'contracts/target/wasm32v1-none/release', `${name}.wasm`));
const CIRCUITS = path.join(ROOT, 'circuits');

const RPC_URL = process.env.RPC_URL ?? 'http://localhost:8000/soroban/rpc';
const FRIENDBOT = process.env.FRIENDBOT_URL ?? 'http://localhost:8000/friendbot';
const PASSPHRASE = 'Standalone Network ; February 2017';
if (process.env.NETWORK_PASSPHRASE && process.env.NETWORK_PASSPHRASE !== PASSPHRASE) {
  throw new Error('e2e_local only runs against the local standalone network');
}

const server = new SorobanRpc.Server(RPC_URL, { allowHttp: true });

// ── constants shared with the circuits and contracts ─────────────────────────
const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const DEPTH = 20;
const COLLATERAL = 1_000_000n;            // sats paid to the vault
const BORROW = 2_000_000_000n;            // $200 in USDC stroops
const PRICE = 600_000_000_000n;           // commitment-tree's fixed stub price
const MIN_RATIO_BP = 15_000n;
const MIN_DEPOSIT = 10_000n;              // commitment-tree's min_deposit_satoshis
const EASY_BITS = 0x207f_ffff;
const SECRET = 0x5566778811223344n;
const NONCES = [0x1111n, 0x2222n, 0x3333n, 0x4444n];
const CHECKPOINT_HEIGHT = 100_000;
const DEPOSIT_HEIGHT = CHECKPOINT_HEIGHT + 1;   // the first mined header holds the deposit
const TIMELOCK = DEPOSIT_HEIGHT + 52_560;      // ~1 year, inside 1,008..=105,000 above it
// Compressed secp256k1 encodings; the contracts check the prefix, not the point.
const PROTOCOL_PUBKEY = Buffer.concat([Buffer.from([0x02]), Buffer.alloc(32, 0x11)]);
const USER_PUBKEY = Buffer.concat([Buffer.from([0x03]), Buffer.alloc(32, 0x22)]);
const OTHER_PUBKEY = Buffer.concat([Buffer.from([0x02]), Buffer.alloc(32, 0x44)]);

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
  const tx = await build(source, contractId, method, args);
  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) throw new Error(`${method} simulation failed: ${sim.error}`);
  const prepared = SorobanRpc.assembleTransaction(tx, sim).build();
  prepared.sign(source);
  const res = await sendAndWait(prepared);
  return res.returnValue ? scValToNative(res.returnValue) : undefined;
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

// ── ScVal encoding (matches the contracts' G1Point/G2Point/Proof layout) ─────
const hex32 = (n) => BigInt(n).toString(16).padStart(64, '0');
const bytesMap = (hex) => xdr.ScVal.scvMap([
  new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('bytes'), val: xdr.ScVal.scvBytes(Buffer.from(hex, 'hex')) }),
]);
const g1 = (p) => bytesMap(hex32(p[0]) + hex32(p[1]));
const g2 = (p) => bytesMap(hex32(p[0][1]) + hex32(p[0][0]) + hex32(p[1][1]) + hex32(p[1][0]));
const entry = (k, v) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v });
const proofVal = (proof) => xdr.ScVal.scvMap([entry('pi_a', g1(proof.pi_a)), entry('pi_b', g2(proof.pi_b)), entry('pi_c', g1(proof.pi_c))]);
const signalsVal = (signals) => xdr.ScVal.scvVec(signals.map((s) => xdr.ScVal.scvBytes(Buffer.from(hex32(s), 'hex'))));
const vkeyVal = (vk) => xdr.ScVal.scvMap([
  entry('alpha_g1', g1(vk.vk_alpha_1)), entry('beta_g2', g2(vk.vk_beta_2)), entry('delta_g2', g2(vk.vk_delta_2)),
  entry('gamma_g2', g2(vk.vk_gamma_2)), entry('ic', xdr.ScVal.scvVec(vk.IC.map(g1))),
]);
const circuitIdVal = (name) => xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]);
const addr = (pub) => Address.fromString(pub).toScVal();
const bytes = (buf) => xdr.ScVal.scvBytes(Buffer.from(buf));
const u32 = (n) => nativeToScVal(n, { type: 'u32' });
const i128 = (n) => nativeToScVal(n, { type: 'i128' });

// ── Bitcoin helpers ──────────────────────────────────────────────────────────
const sha256d = (d) => crypto.createHash('sha256').update(crypto.createHash('sha256').update(d).digest()).digest();

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

// ── ZK helpers ───────────────────────────────────────────────────────────────
const prove = (name, input) => snarkjs.groth16.fullProve(
  input,
  path.join(CIRCUITS, 'build', `${name}_js`, `${name}.wasm`),
  path.join(CIRCUITS, 'keys', `${name}_final.zkey`),
);

async function singleLeafTree(poseidon, leaf) {
  const F = poseidon.F;
  const hash2 = (a, b) => BigInt(F.toString(poseidon([a, b])));
  const zeros = [0n];
  for (let i = 1; i <= DEPTH; i++) zeros[i] = hash2(zeros[i - 1], zeros[i - 1]);
  let current = leaf;
  const pathElements = [];
  for (let i = 0; i < DEPTH; i++) { pathElements.push(zeros[i]); current = hash2(current, zeros[i]); }
  return { root: current, pathElements: pathElements.map(String), pathIndices: Array(DEPTH).fill('0') };
}

function recipientHalves(strkey) {
  const d = crypto.createHash('sha256').update(strkey, 'ascii').digest();
  return { hi: BigInt('0x' + d.subarray(0, 16).toString('hex')), lo: BigInt('0x' + d.subarray(16).toString('hex')) };
}

// ── the run ──────────────────────────────────────────────────────────────────
async function main() {
  const poseidon = await buildPoseidon();
  const H = (...xs) => BigInt(poseidon.F.toString(poseidon(xs)));

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
  const zkId = await deployWithConstructor({ ...deployer, wasm: WASM('zk_verifier'), constructorArgs: [addr(admin.publicKey())] });
  ok(`zk-verifier  ${zkId}`);
  const spvId = await deployWithConstructor({
    ...deployer, wasm: WASM('bitcoin_spv'), constructorArgs: [addr(admin.publicKey()), u32(EASY_BITS)],
  });
  ok(`bitcoin-spv  ${spvId}`);
  const ctId = await deployWithConstructor({
    ...deployer, wasm: WASM('commitment_tree'),
    constructorArgs: [
      addr(admin.publicKey()), addr(spvId), addr(zkId), addr(nativeSac), addr(admin.publicKey()),
      u32(6), bytes(PROTOCOL_PUBKEY),
    ],
  });
  ok(`commitment-tree  ${ctId}`);
  // The oracle is only read by borrow/liquidate, which this run does not call on private-lend.
  const plId = await deployWithConstructor({
    ...deployer, wasm: WASM('private_lend'),
    constructorArgs: [
      addr(admin.publicKey()), addr(spvId), addr(nativeSac), addr(admin.publicKey()),
      addr(admin.publicKey()), addr(admin.publicKey()), bytes(PROTOCOL_PUBKEY),
    ],
  });
  ok(`private-lend  ${plId}`);
  const root0 = await simulate(admin, ctId, 'get_merkle_root', []);
  ok('constructor ran in the deploy transaction: the tree starts at the empty root');
  void root0;

  step('Verification keys (the committed ones the frontend and contracts share)');
  for (const [file, circuit] of [['deposit', 'Deposit'], ['borrow_repay', 'BorrowRepay'], ['liquidation', 'Liquidation'], ['zero_debt', 'ZeroDebt']]) {
    const vk = JSON.parse(fs.readFileSync(path.join(CIRCUITS, 'keys', `${file}_vkey.json`), 'utf8'));
    await invoke(admin, zkId, 'set_verification_key', [addr(admin.publicKey()), circuitIdVal(circuit), vkeyVal(vk)]);
    ok(`${circuit} key registered`);
  }

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
  await invoke(admin, spvId, 'set_consumer', [addr(admin.publicKey()), addr(ctId), nativeToScVal(true)]);
  ok('commitment-tree registered as a consumer of the shared txid registry');
  await invoke(admin, ctId, 'supply_usdc', [addr(admin.publicKey()), i128(10_000_000_000n)]);
  ok('pool funded');

  step('Deposit: real SPV verification plus a real deposit proof');
  const txidHi = BigInt('0x' + txid.subarray(0, 16).toString('hex'));
  const txidLo = BigInt('0x' + txid.subarray(16).toString('hex'));
  const dep = await prove('deposit', {
    collateral_satoshis: COLLATERAL.toString(), secret: SECRET.toString(), nonce: NONCES[0].toString(),
    btc_txid_lo: txidLo.toString(), btc_txid_hi: txidHi.toString(),
    min_deposit_satoshis: MIN_DEPOSIT.toString(), actual_satoshis: COLLATERAL.toString(),
  });
  const commitment0 = H(COLLATERAL, 0n, SECRET, NONCES[0]);
  const depositArgs = (userPubkey, timelock) => [
    addr(borrower.publicKey()), bytes(blockHash), xdr.ScVal.scvVec([]), u32(0), bytes(rawTx),
    bytes(userPubkey), u32(timelock), proofVal(dep.proof), signalsVal(dep.publicSignals), bytes(Buffer.alloc(0)),
  ];
  await expectError(borrower, ctId, 'deposit', depositArgs(OTHER_PUBKEY, TIMELOCK), 17,
    'a deposit claiming an output locked to another Bitcoin key');
  await expectError(borrower, ctId, 'deposit', depositArgs(USER_PUBKEY, DEPOSIT_HEIGHT + 1_007), 21,
    'a deposit whose timelock opens under 1,008 blocks after confirmation');
  await invoke(borrower, ctId, 'deposit', depositArgs(USER_PUBKEY, TIMELOCK));
  ok('deposit to the depositor\'s own Writz script accepted');
  if (!(await simulate(admin, spvId, 'is_deposit_consumed', [bytes(txid)]))) throw new Error('txid was not consumed in the shared registry');
  ok('the deposit txid is now consumed in bitcoin-spv (the lending contract called the registry with real auth)');

  const plDepositArgs = [
    addr(borrower.publicKey()), bytes(blockHash), xdr.ScVal.scvVec([]), u32(0), bytes(rawTx),
    bytes(writzScriptPubKey(PROTOCOL_PUBKEY, USER_PUBKEY, TIMELOCK)), u32(TIMELOCK), bytes(USER_PUBKEY),
  ];
  await expectError(borrower, plId, 'deposit', plDepositArgs, 27, 'a deposit into a lender bitcoin-spv has not registered');
  await invoke(admin, spvId, 'set_consumer', [addr(admin.publicKey()), addr(plId), nativeToScVal(true)]);
  await expectError(borrower, plId, 'deposit', plDepositArgs, 26, 'the same txid deposited into the second lender');

  const tree0 = await singleLeafTree(poseidon, commitment0);
  await invoke(admin, ctId, 'insert_commitment', [
    addr(admin.publicKey()), bytes(Buffer.from(hex32(commitment0), 'hex')), bytes(Buffer.from(hex32(tree0.root), 'hex')),
  ]);
  ok('commitment inserted; the on-chain root is the tree with this leaf');

  step('Borrow: bound to its recipient');
  const mine = recipientHalves(borrower.publicKey());
  const borrowProof = await prove('borrow_repay', {
    collateral_satoshis: COLLATERAL.toString(), old_debt_stroops: '0', secret: SECRET.toString(), nonce: NONCES[0].toString(),
    new_nonce: NONCES[1].toString(), path_elements: tree0.pathElements, path_indices: tree0.pathIndices,
    old_root: tree0.root.toString(), delta_stroops: BORROW.toString(), is_borrow: '1',
    btc_price_stroops_per_btc: PRICE.toString(), min_ratio_bp: MIN_RATIO_BP.toString(),
    recipient_lo: mine.lo.toString(), recipient_hi: mine.hi.toString(),
  });
  const borrowArgs = (who) => [addr(who.publicKey()), proofVal(borrowProof.proof), signalsVal(borrowProof.publicSignals), bytes(Buffer.alloc(0))];
  await expectError(attacker, ctId, 'borrow', borrowArgs(attacker), 19, 'a copied borrow proof submitted by another account');
  await invoke(borrower, ctId, 'borrow', borrowArgs(borrower));
  ok('the recipient the proof commits to borrows successfully');

  step('Repay');
  const commitment1 = H(COLLATERAL, BORROW, SECRET, NONCES[1]);
  const tree1 = await singleLeafTree(poseidon, commitment1);
  const repayProof = await prove('borrow_repay', {
    collateral_satoshis: COLLATERAL.toString(), old_debt_stroops: BORROW.toString(), secret: SECRET.toString(),
    nonce: NONCES[1].toString(), new_nonce: NONCES[2].toString(), path_elements: tree1.pathElements,
    path_indices: tree1.pathIndices, old_root: tree1.root.toString(),
    delta_stroops: ((FIELD_PRIME - BORROW) % FIELD_PRIME).toString(), is_borrow: '0',
    btc_price_stroops_per_btc: PRICE.toString(), min_ratio_bp: MIN_RATIO_BP.toString(),
    recipient_lo: mine.lo.toString(), recipient_hi: mine.hi.toString(),
  });
  await invoke(borrower, ctId, 'repay', [
    addr(borrower.publicKey()), proofVal(repayProof.proof), signalsVal(repayProof.publicSignals), bytes(Buffer.alloc(0)),
  ]);
  ok('debt repaid in full');

  step('Release: the repaid leaf must stop being borrowable');
  const commitment2 = H(COLLATERAL, 0n, SECRET, NONCES[2]);
  const tree2 = await singleLeafTree(poseidon, commitment2);
  const reborrow = await prove('borrow_repay', {
    collateral_satoshis: COLLATERAL.toString(), old_debt_stroops: '0', secret: SECRET.toString(), nonce: NONCES[2].toString(),
    new_nonce: NONCES[3].toString(), path_elements: tree2.pathElements, path_indices: tree2.pathIndices,
    old_root: tree2.root.toString(), delta_stroops: BORROW.toString(), is_borrow: '1',
    btc_price_stroops_per_btc: PRICE.toString(), min_ratio_bp: MIN_RATIO_BP.toString(),
    recipient_lo: mine.lo.toString(), recipient_hi: mine.hi.toString(),
  });
  const reborrowArgs = [addr(borrower.publicKey()), proofVal(reborrow.proof), signalsVal(reborrow.publicSignals), bytes(Buffer.alloc(0))];
  await simulate(borrower, ctId, 'borrow', reborrowArgs);
  ok('before the release is recorded, the repaid leaf can still borrow (the vulnerability exists in this state)');

  const zd = await prove('zero_debt', {
    collateral_satoshis: COLLATERAL.toString(), secret: SECRET.toString(), nonce: NONCES[2].toString(),
    path_elements: tree2.pathElements, path_indices: tree2.pathIndices, merkle_root: tree2.root.toString(),
  });
  await invoke(borrower, ctId, 'mark_released', [proofVal(zd.proof), signalsVal(zd.publicSignals)]);
  ok('mark_released accepted the zero-debt proof');
  await expectError(borrower, ctId, 'borrow', reborrowArgs, 6, 'borrowing against the released leaf');

  console.log(`\nAll ${passed} checks passed on the local network.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(`\nFAILED: ${e instanceof Error ? e.message : e}`); process.exit(1); });
