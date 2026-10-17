#!/usr/bin/env node
/**
 * Generates the ZK keeper's BabyJubJub key (#212).
 *
 * commitment-tree holds the public key (constructor / `set_keeper_pubkey`);
 * every borrow and repay proof encrypts the new position's liquidation witness
 * to it. The relayer's ZK keeper holds the secret as KEEPER_BABYJUB_SECRET to
 * open those notes and liquidate undercollateralized positions. The secret can
 * liquidate positions but never borrow against or release them.
 *
 * Writes the secret to a new file (mode 0600, never overwritten) and prints
 * only the public key. Store the secret like any other relayer secret.
 *
 * Usage: node keeper_keygen.mjs [secret-file]   (default ./keeper-babyjub.secret)
 */
import crypto from 'crypto';
import fs from 'fs';
import { buildBabyjub } from 'circomlibjs';

const file = process.argv[2] ?? 'keeper-babyjub.secret';
if (fs.existsSync(file)) {
  console.error(`${file} already exists; refusing to overwrite a keeper key.`);
  process.exit(1);
}

// 248 random bits: inside the BabyJubJub subgroup order and the circuit's
// 253-bit scalar decomposition.
const sk = BigInt('0x' + crypto.randomBytes(31).toString('hex')) || 1n;
const bj = await buildBabyjub();
const pub = bj.mulPointEscalar(bj.Base8, sk);
const hex = (v) => bj.F.toObject(v).toString(16).padStart(64, '0');

fs.writeFileSync(file, `0x${sk.toString(16)}\n`, { mode: 0o600, flag: 'wx' });
console.log(`Secret written to ${file} (KEEPER_BABYJUB_SECRET for the relayer).`);
console.log(`KEEPER_BABYJUB_PUBKEY=${hex(pub[0])}${hex(pub[1])}`);
