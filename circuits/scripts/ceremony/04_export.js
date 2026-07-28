#!/usr/bin/env node
'use strict';
/**
 * Final ceremony export step: exports a verified final zkey's
 * verification key into every format Writz's stack actually consumes, and
 * writes the `CEREMONY_MANIFEST.json` entry the `circuits-ceremony-verify`
 * CI job checks before a rotation is accepted.
 *
 * Run this only after `03_verify_transcript.sh` has passed for the circuit.
 *
 * Usage: node scripts/ceremony/04_export.js <circuit> <final.zkey>
 *   circuit:    deposit | borrow_repay | liquidation | zero_debt
 *   final.zkey: path to the verified final zkey (see 03_verify_transcript.sh)
 *
 * Writes:
 *   circuits/keys/<circuit>_vkey.json         — source-of-truth verification key JSON
 *   circuits/ceremony/<circuit>/vkey.contract.json — {alpha_g1, beta_g2, gamma_g2,
 *                                                      delta_g2, ic} hex-string shape,
 *                                                      ready for a `set_verification_key`
 *                                                      Soroban call
 *   circuits/keys/CEREMONY_MANIFEST.json      — updated with this circuit's entry
 *
 * Does NOT copy the final .zkey into `circuits/keys/` or `frontend/public/circuits/`
 * — those are large binaries intentionally excluded from git (see the ceremony
 * README's "why .zkey files aren't committed" note). Publish the .zkey as a
 * GitHub Release asset and record its URL + hash in the manifest by hand, or
 * extend this script to do so once a release workflow exists.
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const { vkeyToContractShape } = require('../lib/vkey_encode.js');

const CIRCUITS_DIR = path.resolve(__dirname, '../..');
const KEYS_DIR = path.join(CIRCUITS_DIR, 'keys');
const MANIFEST_PATH = path.join(KEYS_DIR, 'CEREMONY_MANIFEST.json');

// Expected public-signal counts, per circuit — must match the IC length in
// the exported vkey. Mirrors the values already verified against the dev
// keys (circuits/keys/*_vkey.json) and contracts/contracts/zk-verifier/src/
// test_vectors.rs. Kept here (not imported from a shared source) since this
// is the one place a mismatch must hard-fail loudly, rather than silently
// inherit whatever the dev keys happened to have.
const EXPECTED_IC_LENGTH = {
  deposit: 6,
  borrow_repay: 9,
  liquidation: 6,
  zero_debt: 2,
};

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function main() {
  const [circuit, finalZkeyArg] = process.argv.slice(2);
  if (!circuit || !finalZkeyArg) {
    console.error('Usage: node scripts/ceremony/04_export.js <circuit> <final.zkey>');
    process.exit(1);
  }
  if (!(circuit in EXPECTED_IC_LENGTH)) {
    console.error(`Unknown circuit '${circuit}'. Expected one of: ${Object.keys(EXPECTED_IC_LENGTH).join(', ')}`);
    process.exit(1);
  }

  const finalZkey = path.resolve(finalZkeyArg);
  if (!fs.existsSync(finalZkey)) {
    console.error(`ERROR: ${finalZkey} not found`);
    process.exit(1);
  }

  const ceremonyDir = path.join(CIRCUITS_DIR, 'ceremony', circuit);
  const transcriptPath = path.join(ceremonyDir, 'transcript.json');
  if (!fs.existsSync(transcriptPath)) {
    console.error(`ERROR: no transcript at ${transcriptPath} — run 03_verify_transcript.sh first`);
    process.exit(1);
  }

  console.log(`▶ Exporting verification key for ${circuit}...`);
  const vkeyOutPath = path.join(KEYS_DIR, `${circuit}_vkey.json`);
  execFileSync('snarkjs', ['zkey', 'export', 'verificationkey', finalZkey, vkeyOutPath], {
    stdio: 'inherit',
  });

  const vkey = JSON.parse(fs.readFileSync(vkeyOutPath, 'utf8'));
  const expectedLen = EXPECTED_IC_LENGTH[circuit];
  if (vkey.IC.length !== expectedLen) {
    console.error(
      `ERROR: ${circuit}'s exported vkey has IC.length=${vkey.IC.length}, expected ${expectedLen}. ` +
        'This usually means the wrong .zkey/circuit pairing was passed, or the circuit\'s ' +
        'public-signal count changed without updating EXPECTED_IC_LENGTH here AND ' +
        'contracts/contracts/zk-verifier/src/test_vectors.rs. Refusing to export.',
    );
    process.exit(1);
  }
  console.log(`  ✓ IC length matches expected (${expectedLen})`);

  console.log('▶ Converting to zk-verifier contract shape...');
  const contractShape = vkeyToContractShape(vkey);
  const contractShapePath = path.join(ceremonyDir, 'vkey.contract.json');
  fs.writeFileSync(contractShapePath, JSON.stringify(contractShape, null, 2) + '\n');
  console.log(`  ✓ written: ${contractShapePath}`);

  console.log('▶ Updating CEREMONY_MANIFEST.json...');
  const transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
  const manifest = fs.existsSync(MANIFEST_PATH)
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
    : {};

  manifest[circuit] = {
    finalized_at_utc: new Date().toISOString(),
    contribution_count: transcript.length,
    final_zkey_sha256: sha256File(finalZkey),
    vkey_sha256: sha256File(vkeyOutPath),
    ic_length: vkey.IC.length,
    // Filled in by hand once the .zkey is published as a Release asset —
    // see this script's top-of-file comment.
    final_zkey_release_url: null,
    transcript_path: path.relative(CIRCUITS_DIR, transcriptPath),
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`  ✓ updated: ${MANIFEST_PATH}`);

  console.log('');
  console.log(`✅ ${circuit} export complete.`);
  console.log('   Remaining manual steps:');
  console.log(`   1. Publish ${path.basename(finalZkey)} as a GitHub Release asset`);
  console.log(`      (tag: ceremony-${circuit}-v1), then fill in`);
  console.log(`      final_zkey_release_url in ${path.relative(CIRCUITS_DIR, MANIFEST_PATH)}.`);
  console.log(`   2. Copy the .zkey to frontend/public/circuits/${circuit}_final.zkey`);
  console.log(`      (and frontend/src/circuits/${circuit}_vkey.json if this is zero_debt).`);
  console.log('   3. Commit the updated keys/*_vkey.json, ceremony/ transcript, and manifest.');
  console.log('   4. Run the on-chain rotation (set_verification_key ×3/4, see the');
  console.log('      ceremony README\'s rotation runbook).');
}

main();
