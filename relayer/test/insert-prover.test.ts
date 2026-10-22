import { describe, expect, test } from '@jest/globals';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { groth16 } from 'snarkjs';
import { buildInsertInput, INSERT_ZKEY, proveInsertion } from '../src/insert-prover';
import { computeRoot } from '../src/merkle';

// The insert circuit's committed verification key - the one registered on
// zk-verifier as CircuitId::Insert.
const VKEY_PATH = path.resolve(__dirname, '../../circuits/keys/insert_vkey.json');
const vkey = JSON.parse(readFileSync(VKEY_PATH, 'utf8'));

describe('buildInsertInput', () => {
  test('targets the slot right after the existing leaves', () => {
    const { input, newRoot } = buildInsertInput([11n, 22n, 33n], 44n);
    expect(input.leaf_index).toBe('3');
    expect(input.old_root).toBe(computeRoot([11n, 22n, 33n]).toString());
    expect(input.path_elements).toHaveLength(20);
    expect(newRoot).toBe(computeRoot([11n, 22n, 33n, 44n]));
  });
});

describe('proveInsertion', () => {
  test('produces a proof the committed insert key accepts, for the root the leaf store expects', async () => {
    const leaves = [11n, 22n, 33n];
    const { publicSignals, newRoot, leafIndex } = await proveInsertion(leaves, 44n);
    // [new_root, old_root, commitment, leaf_index], 32 bytes each
    const signals = publicSignals.map((b) => BigInt('0x' + b.toString('hex')));
    expect(signals).toEqual([newRoot, computeRoot(leaves), 44n, 3n]);
    expect(leafIndex).toBe(3);
  }, 60_000);

  test('the proof verifies against the committed key', async () => {
    const { input } = buildInsertInput([7n], 8n);
    const { proof, publicSignals } = await groth16.fullProve(
      input as unknown as Record<string, unknown>,
      path.resolve(__dirname, '../circuits/insert.wasm'),
      INSERT_ZKEY,
      undefined,
      {},
      { singleThread: true },
    );
    expect(await groth16.verify(vkey, publicSignals, proof)).toBe(true);
  }, 60_000);
});

describe('served insert artifacts', () => {
  test('relayer/circuits/insert_final.zkey exports the committed insert vkey', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'writz-insert-vkey-'));
    const out = path.join(dir, 'vkey.json');
    try {
      const cli = path.resolve(__dirname, '../node_modules/snarkjs/build/cli.cjs');
      execFileSync('node', [cli, 'zkey', 'export', 'verificationkey', INSERT_ZKEY, out], { stdio: 'ignore', timeout: 60_000 });
      expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(vkey);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
});
