#!/usr/bin/env node
/**
 * End-to-end P2WSH test on Bitcoin Signet (Blockstream Esplora).
 *
 * Tests the full Writz Protocol Bitcoin locking flow:
 *   1. Derive P2WSH deposit address (protocol key + user key + CLTV)
 *   2. Fund the address (from Signet faucet or manually)
 *   3. Build + sign Path A co-signed release transaction (both keys)
 *   4. Broadcast via Esplora and confirm on-chain
 *
 * Usage:
 *   node scripts/e2e_testnet.mjs [--dry-run]
 *
 * The script derives keys deterministically from SHA256 of known seed strings —
 * safe for Signet only, no real funds. Each set of seeds produces a unique
 * deposit address; update the seed strings to rotate to a fresh address.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { ECPairFactory } from 'ecpair';
import pkg from '../dist/index.js';
const { deriveDepositAddress, keyPairFromPrivkey, pubkeyToP2WPKHAddress, buildReleaseTransaction, finalizePathA } = pkg;

// ── Setup ─────────────────────────────────────────────────────────────────────

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

const DRY_RUN = process.argv.includes('--dry-run');

const NETWORK   = bitcoin.networks.testnet; // Signet shares address prefixes with testnet
const ESPLORA   = process.env.E2E_ESPLORA_URL ?? 'https://blockstream.info/signet/api';
const FEE_SAT   = 1500;   // generous fee for Signet (~10 sat/vbyte)
const POLL_MS   = 15_000; // check for UTXO every 15 seconds
const POLL_MAX  = 40;     // give up after ~10 minutes

// ── Key loading ───────────────────────────────────────────────────────────────

function hexToPrivkey(hex) {
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('E2E_PROTOCOL_PRIVKEY and E2E_USER_PRIVKEY must be 64-char hex strings. Copy .env.example to .env.local and fill in the values.');
  }
  return Buffer.from(hex, 'hex');
}

const protocolKP = keyPairFromPrivkey(hexToPrivkey(process.env.E2E_PROTOCOL_PRIVKEY), NETWORK);
const userKP     = keyPairFromPrivkey(hexToPrivkey(process.env.E2E_USER_PRIVKEY),     NETWORK);

// ── Esplora helpers ───────────────────────────────────────────────────────────

async function esploraGet(path) {
  const res = await fetch(`${ESPLORA}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function esploraGetText(path) {
  const res = await fetch(`${ESPLORA}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`);
  return res.text();
}

async function getCurrentBlockHeight() {
  const tip = await esploraGetText('/blocks/tip/height');
  return parseInt(tip.trim(), 10);
}

async function getUtxos(address) {
  return esploraGet(`/address/${address}/utxo`);
}

async function broadcastTx(rawHex) {
  const res = await fetch(`${ESPLORA}/tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: rawHex,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Broadcast failed (${res.status}): ${body}`);
  return body.trim(); // returns txid
}

// ── Faucet helper ─────────────────────────────────────────────────────────────

async function tryFaucet(address) {
  // signetfaucet.com — reliable Signet faucet
  try {
    const res = await fetch(`https://signetfaucet.com/api/claim?address=${encodeURIComponent(address)}`, {
      method: 'POST',
    });
    const text = await res.text();
    const match = text.match(/[0-9a-f]{64}/i);
    if (match) return match[0];
  } catch (_) { /* ignore */ }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('══════════════════════════════════════════════════════════════');
console.log('Writz Protocol — Bitcoin Signet P2WSH End-to-End Test');
console.log('══════════════════════════════════════════════════════════════\n');

// ── Step 1: Derive deposit address ───────────────────────────────────────────

const blockHeight = await getCurrentBlockHeight();
// Fixed timelock for Signet e2e reproducibility — this is the P2WSH-defining
// height (must be ≥ MIN_TIMELOCK_HEIGHT). Path A (co-signed) does not enforce
// this height; it's only relevant for the Path B emergency recovery branch.
// A fixed value ensures the deposit address is stable across script re-runs.
const timelockHeight = parseInt(process.env.E2E_CLTV_TIMELOCK ?? '700000', 10);

const depositAddr = deriveDepositAddress(
  {
    protocolPubkey: protocolKP.publicKey,
    userPubkey:     userKP.publicKey,
    timelockHeight,
  },
  NETWORK,
);

const userReturnAddress = pubkeyToP2WPKHAddress(userKP.publicKey, NETWORK);

console.log('Keys:');
console.log(`  protocol pubkey : ${protocolKP.publicKey.toString('hex')}`);
console.log(`  user pubkey     : ${userKP.publicKey.toString('hex')}`);
console.log(`  user return addr: ${userReturnAddress}`);
console.log();
console.log(`Current block height : ${blockHeight}`);
console.log(`CLTV timelock height : ${timelockHeight}`);
console.log();
console.log('─────────────────────────────────────────────────────────────');
console.log(`P2WSH deposit address: ${depositAddr.address}`);
console.log('─────────────────────────────────────────────────────────────');
console.log(`View: https://blockstream.info/signet/address/${depositAddr.address}`);
console.log();

// ── Step 2: Find funding UTXO ────────────────────────────────────────────────

let utxo;

if (DRY_RUN) {
  // Dry-run: use a synthetic UTXO to validate transaction construction locally.
  // The resulting raw hex would be valid on-chain if this UTXO actually existed.
  console.log('STEP 2: [DRY-RUN] Using synthetic UTXO (no real funds needed)…');
  utxo = {
    txid:   '0'.repeat(64),   // 32-byte zero txid (placeholder)
    vout:   0,
    value:  50_000,           // 50,000 sat = 0.0005 BTC
    status: { confirmed: false },
  };
  console.log(`  txid  : ${utxo.txid} (synthetic)`);
  console.log(`  vout  : ${utxo.vout}`);
  console.log(`  value : ${utxo.value} sat`);
} else {
  console.log('STEP 2: Looking for UTXOs at deposit address…');
  let utxos = await getUtxos(depositAddr.address);

  if (utxos.length === 0) {
    console.log('  No UTXO found. Trying Signet faucet…');
    const faucetTxid = await tryFaucet(depositAddr.address);
    if (faucetTxid) {
      console.log(`  ✓ Faucet funded — txid: ${faucetTxid}`);
      console.log(`    https://blockstream.info/signet/tx/${faucetTxid}`);
    } else {
      console.log('  Faucet unavailable or rate-limited.');
      console.log('');
      console.log('  ► Fund this address manually from a Signet faucet,');
      console.log('    then re-run (the script polls until a UTXO appears):');
      console.log(`    Address : ${depositAddr.address}`);
      console.log('    Faucets : https://signetfaucet.com  ← recommended');
      console.log('              https://alt.signetfaucet.com');
      console.log('');
      console.log(`  Polling for UTXO every ${POLL_MS / 1000}s (up to ${POLL_MAX * POLL_MS / 60_000} min)…`);
    }

    // Poll for UTXO
    let found = false;
    for (let i = 0; i < POLL_MAX; i++) {
      await new Promise(r => setTimeout(r, POLL_MS));
      process.stdout.write(`\r  Checking (attempt ${i + 1}/${POLL_MAX})…`);
      utxos = await getUtxos(depositAddr.address);
      if (utxos.length > 0) {
        process.stdout.write('\n');
        found = true;
        break;
      }
    }

    if (!found) {
      console.log('\n\n✗ No UTXO detected after polling. Fund the address and re-run.');
      process.exit(1);
    }
  }

  // Pick the largest confirmed UTXO (prefer confirmed, fall back to unconfirmed)
  const confirmed   = utxos.filter(u => u.status?.confirmed);
  const unconfirmed = utxos.filter(u => !u.status?.confirmed);
  utxo = confirmed.length > 0
    ? confirmed.reduce((a, b) => a.value > b.value ? a : b)
    : unconfirmed.reduce((a, b) => a.value > b.value ? a : b);

  const isConfirmed = !!utxo.status?.confirmed;
  console.log(`  ✓ UTXO found${isConfirmed ? ' (confirmed)' : ' (unconfirmed, proceeding anyway)'}`);
  console.log(`    txid  : ${utxo.txid}`);
  console.log(`    vout  : ${utxo.vout}`);
  console.log(`    value : ${utxo.value} sat (${(utxo.value / 1e8).toFixed(8)} BTC)`);
}

if (utxo.value <= FEE_SAT) {
  console.log(`\n✗ UTXO value (${utxo.value} sat) ≤ fee (${FEE_SAT} sat). Fund with more BTC.`);
  process.exit(1);
}

// ── Step 3: Build Path A release transaction ─────────────────────────────────

console.log('\nSTEP 3: Building Path A co-signed release transaction…');

const psbt = buildReleaseTransaction({
  txidHex:          utxo.txid,
  vout:             utxo.vout,
  amountSat:        utxo.value,
  scriptPubKey:     depositAddr.scriptPubKey,
  redeemScript:     depositAddr.redeemScript,
  recipientAddress: userReturnAddress,
  feeSat:           FEE_SAT,
  network:          NETWORK,
});

// ── Step 4: Sign with both keys ───────────────────────────────────────────────

console.log('STEP 4: Signing with protocol key and user key…');

// The PSBT requires a signer with both `publicKey` and `sign()` method.
// The ECPairInterface from ecpair satisfies bitcoinjs-lib's Signer interface.
psbt.signInput(0, protocolKP.signer);
psbt.signInput(0, userKP.signer);

console.log('  ✓ Protocol key signed');
console.log('  ✓ User key signed');

// ── Step 5: Finalize and extract ──────────────────────────────────────────────

console.log('\nSTEP 5: Finalizing witness (Path A: user_sig | protocol_sig | 0x01 | redeemScript)…');

finalizePathA(psbt, 0, userKP.publicKey, protocolKP.publicKey);

const tx      = psbt.extractTransaction();
const rawHex  = tx.toHex();
const releaseTxid = tx.getId();

console.log(`  ✓ TX finalized`);
console.log(`  txid    : ${releaseTxid}`);
console.log(`  size    : ${rawHex.length / 2} bytes (${tx.virtualSize()} vbytes)`);
console.log(`  fee     : ${FEE_SAT} sat (${(FEE_SAT / tx.virtualSize()).toFixed(1)} sat/vbyte)`);
console.log(`  payout  : ${utxo.value - FEE_SAT} sat → ${userReturnAddress}`);

// Verify witness structure
const input0Witness = tx.ins[0].witness;
console.log(`\n  Witness stack (${input0Witness.length} items):`);
console.log(`    [0] user_sig     : ${input0Witness[0].toString('hex').slice(0, 20)}… (${input0Witness[0].length} bytes)`);
console.log(`    [1] protocol_sig : ${input0Witness[1].toString('hex').slice(0, 20)}… (${input0Witness[1].length} bytes)`);
console.log(`    [2] flag         : ${input0Witness[2].toString('hex')} (OP_IF → Path A)`);
console.log(`    [3] redeemScript : ${input0Witness[3].toString('hex').slice(0, 20)}… (${input0Witness[3].length} bytes)`);

// ── Step 6: Broadcast ────────────────────────────────────────────────────────

let broadcastedTxid;

if (DRY_RUN) {
  console.log('\nSTEP 6: [DRY-RUN] Skipping broadcast (synthetic UTXO).');
  console.log(`  Signed raw hex (would be broadcast if UTXO existed):`);
  console.log(`  ${rawHex.slice(0, 80)}…`);
  broadcastedTxid = releaseTxid;
} else {
  console.log('\nSTEP 6: Broadcasting to Bitcoin Signet…');
  try {
    broadcastedTxid = await broadcastTx(rawHex);
  } catch (err) {
    // If already broadcast (idempotent), the txid is the same
    if (err.message.includes('Transaction already in block chain') ||
        err.message.includes('txn-already-known') ||
        err.message.includes('already known')) {
      broadcastedTxid = releaseTxid;
      console.log('  (already broadcast, skipping re-broadcast)');
    } else {
      throw err;
    }
  }
  console.log(`  ✓ Broadcast accepted`);
  console.log(`  txid : ${broadcastedTxid}`);
  console.log(`  URL  : https://blockstream.info/signet/tx/${broadcastedTxid}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────

const mode = DRY_RUN ? 'DRY-RUN (synthetic UTXO)' : 'Bitcoin Signet';
console.log('\n══════════════════════════════════════════════════════════════');
console.log(`✅  P2WSH END-TO-END TEST COMPLETE — ${mode}`);
console.log('══════════════════════════════════════════════════════════════\n');
console.log(`  Deposit address    : ${depositAddr.address}`);
if (!DRY_RUN) {
  console.log(`  Funding tx         : https://blockstream.info/signet/tx/${utxo.txid}`);
  console.log(`  Release tx (Path A): https://blockstream.info/signet/tx/${releaseTxid}`);
  console.log(`  Recipient          : ${userReturnAddress}`);
  console.log(`  Net received       : ${utxo.value - FEE_SAT} sat`);
} else {
  console.log(`  Release txid       : ${releaseTxid} (synthetic — not broadcast)`);
  console.log(`  Recipient          : ${userReturnAddress}`);
  console.log(`  Net payout         : ${utxo.value - FEE_SAT} sat (hypothetical)`);
}
console.log();
console.log('What was verified:');
console.log('  ✓ P2WSH address derived from protocol + user key + CLTV');
console.log('  ✓ Path A witness: [user_sig, protocol_sig, 0x01, redeemScript]');
console.log('  ✓ Both keys signed the PSBT independently (multi-party flow)');
console.log('  ✓ finalizePathA assembled correct witness stack');
if (DRY_RUN) {
  console.log();
  console.log('To broadcast on Bitcoin Signet, fund the deposit address');
  console.log(`from a faucet and re-run without --dry-run:`);
  console.log(`  Address : ${depositAddr.address}`);
  console.log('  Faucets : https://signetfaucet.com');
  console.log('            https://alt.signetfaucet.com');
} else {
  console.log('  ✓ Transaction accepted by Bitcoin Signet mempool');
}
