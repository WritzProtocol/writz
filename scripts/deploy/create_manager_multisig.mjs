#!/usr/bin/env node
/**
 * Turns a fresh Stellar account into an M-of-N multisig for the mainnet
 * DeFindex vault's Manager role (#123). One setOptions transaction adds every
 * signer at weight 10, sets all three thresholds to 10*M, and zeroes the master
 * key. Weight 10 (LOBSTR Vault's own convention) leaves room for the weight-1
 * LOBSTR Vault marker key, which must never count toward the threshold.
 *
 * Dry run by default: validates and prints the plan without submitting.
 * Pass --submit to send it. Rehearse on testnet first - once the master weight
 * is 0 there is no way back if the thresholds turn out to be unreachable.
 *
 * Env:
 *   NETWORK          testnet | mainnet (default testnet)
 *   SIGNERS          comma-separated G... public keys, one per co-signer
 *   THRESHOLD        signatures required (default 2)
 *   MANAGER_SECRET   secret of the account to convert. On testnet, omit it to
 *                    generate and friendbot-fund a throwaway account.
 *   LOBSTR_VAULT     set to 1 when co-signers sign with LOBSTR Vault: adds the
 *                    marker key so pending transactions reach their devices.
 *
 * Usage:
 *   NETWORK=testnet SIGNERS=GA...,GB...,GC... bun run create_manager_multisig.mjs
 *   NETWORK=mainnet SIGNERS=... MANAGER_SECRET=S... bun run create_manager_multisig.mjs --submit
 */
import { Horizon, Keypair, Networks, Operation, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';

const NETWORKS = {
  testnet: { horizon: 'https://horizon-testnet.stellar.org', passphrase: Networks.TESTNET, explorer: 'testnet' },
  mainnet: { horizon: 'https://horizon.stellar.org', passphrase: Networks.PUBLIC, explorer: 'public' },
};

// Base reserve is 0.5 XLM per entry; an account costs 2 entries plus one per subentry (signer, trustline, ...).
const BASE_RESERVE_XLM = 0.5;
const FEE_HEADROOM_XLM = 1;

const SIGNER_WEIGHT = 10;
// Nobody holds this key's secret; it only tells wallets and Refractor to route
// signature requests to LOBSTR Vault. See lobstr.freshdesk.com, "LOBSTR Vault multisig setup details".
const LOBSTR_VAULT_MARKER = 'GA2T6GR7VXXXBETTERSAFETHANSORRYXXXPROTECTEDBYLOBSTRVAULT';
const MARKER_WEIGHT = 1;

function fail(msg) {
  console.error(`\nError: ${msg}`);
  process.exit(1);
}

const submit = process.argv.includes('--submit');
const networkName = process.env.NETWORK ?? 'testnet';
const net = NETWORKS[networkName];
if (!net) fail(`NETWORK must be "testnet" or "mainnet", got "${networkName}"`);

const signers = (process.env.SIGNERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const threshold = Number(process.env.THRESHOLD ?? '2');
const useLobstrMarker = process.env.LOBSTR_VAULT === '1';

if (signers.length === 0) fail('SIGNERS is empty - pass the co-signers\' public keys, comma-separated');
for (const s of signers) {
  if (!StrKey.isValidEd25519PublicKey(s)) fail(`not a valid Stellar public key: ${s}`);
}
if (new Set(signers).size !== signers.length) fail('SIGNERS contains duplicates');
if (signers.includes(LOBSTR_VAULT_MARKER)) fail('the LOBSTR Vault marker is not a co-signer - use LOBSTR_VAULT=1 instead');
if (!Number.isInteger(threshold) || threshold < 2) fail('THRESHOLD must be an integer >= 2 (otherwise this is not a multisig)');
// The master goes to 0 and the marker's weight 1 can never close a 10-point gap,
// so only real co-signers can reach the threshold.
if (threshold > signers.length) {
  fail(`THRESHOLD ${threshold} is unreachable with ${signers.length} signers - the account would be locked forever`);
}
if (threshold === signers.length) {
  console.warn(`\nWarning: ${threshold}-of-${signers.length} means losing any single key locks the account. ` +
    `Consider ${threshold}-of-${signers.length + 1}.`);
}

const server = new Horizon.Server(net.horizon);

let manager;
if (process.env.MANAGER_SECRET) {
  manager = Keypair.fromSecret(process.env.MANAGER_SECRET);
} else if (networkName === 'testnet') {
  manager = Keypair.random();
  console.log(`\nGenerated throwaway testnet manager account: ${manager.publicKey()}`);
  const res = await fetch(`https://friendbot.stellar.org/?addr=${manager.publicKey()}`);
  if (!res.ok) fail(`friendbot funding failed: ${res.status} ${await res.text()}`);
} else {
  fail('MANAGER_SECRET is required on mainnet (a fresh account, funded with XLM)');
}

const managerAddress = manager.publicKey();
if (signers.includes(managerAddress)) fail('the manager account cannot be one of its own co-signers');

let account;
try {
  account = await server.loadAccount(managerAddress);
} catch (e) {
  if (e?.response?.status === 404) fail(`account ${managerAddress} does not exist on ${networkName} - fund it with XLM first`);
  throw e;
}

const existingSigners = account.signers.filter((s) => s.key !== managerAddress);
if (existingSigners.length > 0) {
  fail(`account already has extra signers (${existingSigners.map((s) => s.key).join(', ')}) - use a fresh account`);
}
const master = account.signers.find((s) => s.key === managerAddress);
if (!master || master.weight === 0) fail('master key is already disabled on this account');

const nativeBalance = Number(account.balances.find((b) => b.asset_type === 'native')?.balance ?? '0');
const addedSigners = signers.length + (useLobstrMarker ? 1 : 0);
const requiredXlm = (2 + account.subentry_count + addedSigners) * BASE_RESERVE_XLM + FEE_HEADROOM_XLM;
if (nativeBalance < requiredXlm) {
  fail(`account holds ${nativeBalance} XLM, needs at least ${requiredXlm} for the signer reserves and fees`);
}

console.log(`\nNetwork:   ${networkName}`);
console.log(`Manager:   ${managerAddress}`);
console.log(`Balance:   ${nativeBalance} XLM (needs >= ${requiredXlm})`);
console.log(`Policy:    ${threshold}-of-${signers.length}`);
signers.forEach((s, i) => console.log(`Signer ${i + 1}:  ${s} (weight ${SIGNER_WEIGHT})`));
if (useLobstrMarker) console.log(`Marker:    ${LOBSTR_VAULT_MARKER} (weight ${MARKER_WEIGHT}, LOBSTR Vault routing only)`);
console.log(`After:     master weight 0, thresholds low/med/high = ${threshold * SIGNER_WEIGHT}`);

const builder = new TransactionBuilder(account, { fee: '1000', networkPassphrase: net.passphrase });
for (const key of signers) {
  builder.addOperation(Operation.setOptions({ signer: { ed25519PublicKey: key, weight: SIGNER_WEIGHT } }));
}
if (useLobstrMarker) {
  builder.addOperation(Operation.setOptions({ signer: { ed25519PublicKey: LOBSTR_VAULT_MARKER, weight: MARKER_WEIGHT } }));
}
// Last, and in the same transaction: the tx is authorized by the master key
// before any operation applies, so disabling it here cannot strand the account midway.
builder.addOperation(Operation.setOptions({
  masterWeight: 0,
  lowThreshold: threshold * SIGNER_WEIGHT,
  medThreshold: threshold * SIGNER_WEIGHT,
  highThreshold: threshold * SIGNER_WEIGHT,
}));
const tx = builder.setTimeout(300).build();
tx.sign(manager);

if (!submit) {
  console.log('\nDry run - nothing submitted. Signed XDR for review:');
  console.log(tx.toXDR());
  console.log('\nRe-run with --submit to send it.');
  process.exit(0);
}

console.log('\nSubmitting...');
let result;
try {
  result = await server.submitTransaction(tx);
} catch (e) {
  fail(`submission failed: ${JSON.stringify(e?.response?.data?.extras?.result_codes ?? e?.message ?? e)}`);
}

const after = await server.loadAccount(managerAddress);
const afterMaster = after.signers.find((s) => s.key === managerAddress)?.weight ?? 0;
const afterSigners = after.signers.filter((s) => s.key !== managerAddress && s.key !== LOBSTR_VAULT_MARKER);
const afterMarker = after.signers.find((s) => s.key === LOBSTR_VAULT_MARKER);
const t = after.thresholds;
const want = threshold * SIGNER_WEIGHT;
const ok =
  afterMaster === 0 &&
  afterSigners.length === signers.length &&
  afterSigners.every((s) => signers.includes(s.key) && s.weight === SIGNER_WEIGHT) &&
  (useLobstrMarker ? afterMarker?.weight === MARKER_WEIGHT : !afterMarker) &&
  t.low_threshold === want && t.med_threshold === want && t.high_threshold === want;

console.log(`\nTx:        ${result.hash}`);
console.log(`Explorer:  https://stellar.expert/explorer/${net.explorer}/account/${managerAddress}`);
console.log(`Verified:  ${ok ? 'yes' : 'NO - inspect the account now'}`);
console.log(`\nThe manager secret no longer signs anything (master weight 0). Use ${managerAddress} ` +
  'as the vault Manager role; every Manager action now needs ' + threshold + ' co-signer signatures.');
if (!ok) process.exit(1);
