#!/usr/bin/env node
/**
 * Testnet evidence: a lender withdraws more USDC than they supplied.
 *
 * Runs on the live writz-lend contract with real Signet deposits, in two
 * phases, because interest needs time to accrue:
 *
 *   open   Creates and funds a throwaway lender, supplies USDC, then opens two
 *          loans from two Signet deposits. One is repaid in `close`; the other
 *          stays open so the public pool keeps a rate above 0.
 *   close  Repays the first loan in full, withdraws the lender's whole balance
 *          and writes the Markdown table of every step.
 *
 * Progress lives in a state file, so an interrupted phase resumes where it
 * stopped and never repeats a step. The state file holds the throwaway
 * lender's secret: it is a testnet-only key, and the file is not committed.
 *
 * Environment:
 *   BORROWER_SECRET      S... funded testnet account, with a USDC trustline
 *   BTC_PRIVKEY_HEX      Signet key whose P2WPKH address funds the deposits
 *   WRITZ_LEND_ID        defaults to contracts/deployments/testnet.json
 *   RELAYER_URL          defaults to https://api.testnet.writz.xyz
 *
 * Usage:
 *   node lender_yield_testnet.mjs open  --state <file>
 *     (send --lender-usdc USDC to the printed lender address, run it again)
 *   node lender_yield_testnet.mjs close --state <file> [--out <file.md>]
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as StellarSdk from '@stellar/stellar-sdk';
import btcScript from '@writz/bitcoin-script';
import * as bitcoin from 'bitcoinjs-lib';

const {
  Keypair, Address, Asset, Contract, Operation, Networks, TransactionBuilder, Horizon, xdr,
  nativeToScVal, scValToNative, rpc: SorobanRpc,
} = StellarSdk;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const deployments = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts/deployments/testnet.json'), 'utf8'));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const phase = process.argv[2];
if (phase !== 'open' && phase !== 'close') fail('usage: lender_yield_testnet.mjs open|close --state <file>');

const STATE_FILE = arg('state');
if (!STATE_FILE) fail('--state <file> is required');
const OUT = arg('out', path.join(ROOT, 'docs/developers/evidence/lender-yield-testnet.md'));
const stroops = (usdc) => BigInt(Math.round(Number(usdc) * 1e7));
const LENDER_USDC = stroops(arg('lender-usdc', '50'));
const LOAN_USDC = stroops(arg('loan-usdc', '2'));
const DEPOSIT_SATS = Number(arg('deposit-sats', '5000'));
const FEE_RATE = Number(arg('fee-rate', '1'));
const TIMELOCK_BLOCKS = Number(arg('timelock-blocks', '8640'));

const RPC_URL = process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const ESPLORA = 'https://mempool.space/signet/api';
const RELAYER = process.env.RELAYER_URL ?? 'https://api.testnet.writz.xyz';
const LEND = process.env.WRITZ_LEND_ID ?? deployments.contracts.writzLend;
const PROTOCOL_PUBKEY = Buffer.from(arg('protocol-pubkey', '03d2f0699b167138988bf8d14a4655a8708066473b4c59ef40ee4ac500564fb70d'), 'hex');
const USDC_CODE = 'USDC';
const USDC_ISSUER = process.env.USDC_ISSUER;
const PASSPHRASE = Networks.TESTNET;
const SIGNET = bitcoin.networks.testnet;
const POLL_MS = 15_000;

const server = new SorobanRpc.Server(RPC_URL);
const horizon = new Horizon.Server(HORIZON_URL);

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}
const need = (name) => process.env[name]?.trim() || fail(`${name} is not set`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const addr = (a) => new Address(a).toScVal();
const bytes = (b) => xdr.ScVal.scvBytes(Buffer.from(b));
const i128 = (n) => nativeToScVal(n, { type: 'i128' });
const u32 = (n) => nativeToScVal(n, { type: 'u32' });
const usdc = (n) => (Number(n) / 1e7).toFixed(7);

// ── state ────────────────────────────────────────────────────────────────────
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : { steps: [], loans: {} };
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });

/** Runs `fn` once across restarts, keyed by `name`. */
async function once(name, fn) {
  state.done ??= {};
  if (state.done[name] !== undefined) return state.done[name];
  const value = (await fn()) ?? true;
  state.done[name] = value;
  save();
  return value;
}

// ── Soroban ──────────────────────────────────────────────────────────────────
async function build(pub, method, args, contract = LEND) {
  const account = await server.getAccount(pub);
  return new TransactionBuilder(account, { fee: '1000000', networkPassphrase: PASSPHRASE })
    .addOperation(new Contract(contract).call(method, ...args))
    .setTimeout(120)
    .build();
}

async function read(method, args = [], pub = need('BORROWER_PUBLIC')) {
  const sim = await server.simulateTransaction(await build(pub, method, args));
  if (SorobanRpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return sim.result?.retval ? scValToNative(sim.result.retval) : undefined;
}

async function send(keypair, method, args) {
  const prepared = await server.prepareTransaction(await build(keypair.publicKey(), method, args));
  prepared.sign(keypair);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') throw new Error(`${method} rejected: ${JSON.stringify(sent.errorResult)}`);
  for (let i = 0; i < 60; i++) {
    const res = await server.getTransaction(sent.hash);
    if (res.status === 'SUCCESS') return { hash: sent.hash, ledger: res.ledger };
    if (res.status === 'FAILED') throw new Error(`${method} failed: ${sent.hash}`);
    await sleep(2_000);
  }
  throw new Error(`${method} timed out: ${sent.hash}`);
}

/** Runs a contract call and records the pool state right after it. */
async function step(label, keypair, method, args, amount) {
  return once(`step:${label}`, async () => {
    const { hash, ledger } = await send(keypair, method, args);
    const index = await read('get_supply_index');
    const lender = state.lender ? (await read('get_supply_position', [addr(state.lender.public)])).value : 0n;
    state.steps.push({ label, hash, ledger, amount: amount.toString(), index: index.toString(), lender: lender.toString() });
    save();
    console.log(`${label}: ${hash}`);
    return hash;
  });
}

async function usdcBalance(account) {
  const { balances } = await horizon.loadAccount(account);
  const b = balances.find((x) => x.asset_code === USDC_CODE && x.asset_issuer === USDC_ISSUER);
  return b ? stroops(b.balance) : null;
}

// ── Bitcoin ──────────────────────────────────────────────────────────────────
const http = async (url, init) => {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`);
  return res;
};

async function waitForProof(txid) {
  for (;;) {
    const res = await fetch(`${RELAYER}/spv-proof/${txid}?confirmations=1`);
    if (res.ok) {
      const bundle = await res.json();
      if (bundle.sorobanArgs) return bundle;
    }
    console.log(`waiting for ${txid.slice(0, 12)}... to confirm and reach the light client`);
    await sleep(POLL_MS);
  }
}

/** Locks `DEPOSIT_SATS` under the Writz script and registers the position. */
async function openPosition(name, keys, signer, borrower) {
  const loan = (state.loans[name] ??= {});
  if (!loan.btcTxid) {
    const tip = Number(await (await http(`${ESPLORA}/blocks/tip/height`)).text());
    const timelockHeight = tip + TIMELOCK_BLOCKS;
    const { address, scriptPubKey } = btcScript.deriveDepositAddress(
      { protocolPubkey: PROTOCOL_PUBKEY, userPubkey: keys.publicKey, timelockHeight }, SIGNET,
    );
    const from = btcScript.pubkeyToP2WPKHAddress(keys.publicKey, SIGNET);
    const utxos = await (await http(`${ESPLORA}/address/${from}/utxo`)).json();
    const payment = btcScript.buildP2wpkhPayment({
      utxos: utxos.sort((a, b) => a.value - b.value), to: address, amountSat: DEPOSIT_SATS,
      feeRate: FEE_RATE, signer, network: SIGNET,
    });
    await http(`${ESPLORA}/tx`, { method: 'POST', body: payment.txHex });
    Object.assign(loan, { btcTxid: payment.txid, timelockHeight, script: Buffer.from(scriptPubKey).toString('hex') });
    save();
    console.log(`${name}: deposit ${payment.txid}, ${DEPOSIT_SATS} sats`);
  }
  const bundle = await waitForProof(loan.btcTxid);
  const message = `Writz deposit\ncontract:${LEND}\ndepositor:${borrower.publicKey()}\ntxid:${loan.btcTxid}`;
  const keySig = Buffer.from(btcScript.signBitcoinMessage(message, keys.privateKey), 'base64');
  const a = bundle.sorobanArgs;
  await step(`${name} deposit`, borrower, 'deposit', [
    addr(borrower.publicKey()), bytes(Buffer.from(a.block_hash, 'hex')),
    xdr.ScVal.scvVec(a.merkle_proof.map((h) => bytes(Buffer.from(h, 'hex')))), u32(a.tx_index),
    bytes(Buffer.from(a.raw_tx, 'hex')), bytes(Buffer.from(loan.script, 'hex')), u32(loan.timelockHeight),
    bytes(keys.publicKey), bytes(keySig),
  ], DEPOSIT_SATS);
  await step(`${name} borrow`, borrower, 'borrow', [
    addr(borrower.publicKey()), bytes(internal(loan.btcTxid)), i128(LOAN_USDC),
  ], LOAN_USDC);
}

const internal = (display) => Buffer.from(display, 'hex').reverse();

/** Repays a position to zero. Debt moves every ledger, so a short payment is topped up. */
async function repayInFull(name, borrower) {
  const txid = internal(state.loans[name].btcTxid);
  for (let attempt = 1; attempt <= 6; attempt++) {
    const position = await read('get_position', [bytes(txid)]);
    if (position.status[0] === 'Closed' || position.usdc_debt === 0n) return;
    const borrowIndex = await read('get_borrow_index');
    const debt = (position.usdc_debt * borrowIndex) / position.debt_index;
    try {
      await step(`${name} repay ${attempt}`, borrower, 'repay', [addr(borrower.publicKey()), bytes(txid), i128(debt)], debt);
    } catch (e) {
      if (!String(e).includes('#12')) throw e;
    }
  }
  fail(`${name} still has debt after six payments`);
}

// ── phases ───────────────────────────────────────────────────────────────────
async function open(borrower, keys, signer) {
  if (!state.lender) {
    const kp = Keypair.random();
    state.lender = { public: kp.publicKey(), secret: kp.secret(), principal: LENDER_USDC.toString() };
    save();
  }
  const lender = Keypair.fromSecret(state.lender.secret);
  await once('fund lender', async () => { await http(`https://friendbot.stellar.org/?addr=${lender.publicKey()}`); });
  await once('lender trustline', async () => {
    const account = await horizon.loadAccount(lender.publicKey());
    const tx = new TransactionBuilder(account, { fee: '1000', networkPassphrase: PASSPHRASE })
      .addOperation(Operation.changeTrust({ asset: new Asset(USDC_CODE, USDC_ISSUER) }))
      .setTimeout(120).build();
    tx.sign(lender);
    await horizon.submitTransaction(tx);
  });
  const balance = await usdcBalance(lender.publicKey());
  if (state.done?.['step:lender supply'] === undefined && balance < LENDER_USDC) {
    fail(`send ${usdc(LENDER_USDC)} USDC to ${lender.publicKey()}, then run this phase again`);
  }
  await step('lender supply', lender, 'supply_usdc', [addr(lender.publicKey()), i128(LENDER_USDC)], LENDER_USDC);
  await openPosition('kept loan', keys, signer, borrower);
  await openPosition('evidence loan', keys, signer, borrower);
  console.log(`Open. Supply rate: ${await read('get_supply_rate_bp')} bp. Run "close" after the wait.`);
}

async function close(borrower) {
  const lender = Keypair.fromSecret(state.lender.secret);
  await repayInFull('evidence loan', borrower);
  const position = await read('get_supply_position', [addr(lender.publicKey())]);
  const label = 'lender withdrawal';
  const value = state.done?.[`step:${label}`] ? BigInt(state.withdrawn) : position.value;
  // A withdrawal that landed before the state was saved leaves nothing to withdraw.
  if (value === 0n) fail(`${lender.publicKey()} holds no supply; record the landed withdrawal in the state file`);
  state.withdrawn = value.toString();
  save();
  await step(label, lender, 'withdraw_supply', [addr(lender.publicKey()), i128(value)], value);
  const principal = BigInt(state.lender.principal);
  if (BigInt(state.withdrawn) <= principal) fail('the withdrawal is not above the principal');
  const rows = state.steps.map((s) =>
    `| ${s.label} | [\`${s.hash.slice(0, 10)}...\`](https://stellar.expert/explorer/testnet/tx/${s.hash}) | ${s.ledger} | ${s.label.endsWith('deposit') ? `${s.amount} sats` : `${usdc(s.amount)} USDC`} | ${s.index} | ${usdc(s.lender)} |`);
  const body = [
    '# Lender yield on testnet', '',
    `Contract \`${LEND}\`. The lender supplied ${usdc(principal)} USDC and withdrew ${usdc(state.withdrawn)} USDC, ${BigInt(state.withdrawn) - principal} stroops more.`, '',
    `Lender account \`${lender.publicKey()}\`. Produced by \`scripts/evidence/lender_yield_testnet.mjs\`. Every row is a live testnet transaction.`, '',
    '| Step | Transaction | Ledger | Amount | `supply_index` | Lender balance after |', '|---|---|---|---|---|---|', ...rows, '',
    `The kept loan stays open, so the pool keeps a rate above 0: Bitcoin transaction \`${state.loans['kept loan'].btcTxid}\`.`, '',
  ].join('\n');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, body);
  console.log(body);
}

async function main() {
  const passphrase = (await server.getNetwork()).passphrase;
  if (passphrase !== PASSPHRASE) fail(`wrong network: ${passphrase}`);
  if (!USDC_ISSUER) fail('USDC_ISSUER is not set');
  const borrower = Keypair.fromSecret(need('BORROWER_SECRET'));
  process.env.BORROWER_PUBLIC = borrower.publicKey();
  if ((await usdcBalance(borrower.publicKey())) === null) fail(`${borrower.publicKey()} has no USDC trustline`);
  const privateKey = Buffer.from(need('BTC_PRIVKEY_HEX'), 'hex');
  const keys = btcScript.keyPairFromPrivkey(privateKey, SIGNET);
  if (phase === 'open') await open(borrower, { ...keys, privateKey }, keys.signer);
  else await close(borrower);
}

main().then(() => process.exit(0)).catch((e) => fail(e instanceof Error ? e.message : String(e)));
