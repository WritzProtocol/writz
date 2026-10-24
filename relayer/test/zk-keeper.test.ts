/**
 * ZK keeper (#212): opening keeper notes, the health test, and one pass of
 * the liquidation loop. The note vector is the fixture borrow proof from
 * privacy/circuits/scripts/gen_commitment_tree_test_vectors.js (commitment-tree's
 * integration vectors), so these tests open exactly what the circuit wrote.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, test } from '@jest/globals';
import { poseidon1, poseidon5 } from 'poseidon-lite';
import { groth16 } from 'snarkjs';

process.env.SQLITE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zk-keeper-')), 'merkle.db');

import { keeperPublicKey, openKeeperNote, onCurve } from '../src/zk-keeper/babyjub';
import { isLiquidatable } from '../src/zk-keeper/health';
import { buildLiquidationInput } from '../src/zk-keeper/prover';
import { runKeeperCycle, keeperNoteSink, type KeeperDeps } from '../src/zk-keeper/runner';
import type { StoredKeeperPosition } from '../src/leaf-store';

// snarkjs keeps its BN254 worker alive between proofs; release it so Jest exits.
afterAll(async () => {
  await (globalThis as { curve_bn128?: { terminate(): Promise<void> } }).curve_bn128?.terminate();
});

const KEEPER_SK = 0x0abcdef0123456789n;
const KEEPER_PUB = [
  0x2c3611dbe4c974bd966f1f4f897354df208e6f5f48f65c5a0ecafdeea0647686n,
  0x082e931efe0b53a653efaf8b8d2d495c8d07e42b50e72fb94ba14f78532eb23an,
];
// Fixture borrow: new_commitment (signal 2) and its keeper note (signals 3..7).
const COMMITMENT = 0x08c19b7242e26262c899ef59a0da84bb59047076af1b78b4d9812698fdc4976an;
const NOTE = [
  0x19f1138dabaef670f68569550045b1f289663d7eaa663220caf3ff218964dbc9n,
  0x06e07516f05869be98a67b9172dd6e493b9f9c87ca5717a100e728aae9ef1b34n,
  0x0827e487a0742d7e4da05bc445928a676ea219ce64cd5adeea6295d357562633n,
  0x0548ea2a6ec626a91779ef0e3f5da5e2c35570720e5f5e8f16fe49c01acf3bedn,
  0x2ea71085f43c57b12e5ca11058d96bdbc8046d25fef5a637a382e4106a43c74cn,
];
const SECRET = 0x5566778811223344n;
const PRICE = 600_000_000_000n;
const THRESHOLD = 12_000n;

describe('BabyJubJub', () => {
  test('derives the same keeper public key as circomlib', () => {
    expect(keeperPublicKey(KEEPER_SK)).toEqual(KEEPER_PUB);
    expect(onCurve(keeperPublicKey(KEEPER_SK))).toBe(true);
  });
});

describe('openKeeperNote', () => {
  test("recovers the fixture borrow's liquidation witness", () => {
    expect(openKeeperNote(KEEPER_SK, NOTE, COMMITMENT)).toEqual({
      liqKey: poseidon1([SECRET]),
      nonce: 0x2222222222222222n,
      collateralSats: 1_000_000n,
      debtStroops: 2_000_000_000n,
      timelockHeight: 2_950_000,
    });
  });

  test('another key opens nothing', () => {
    expect(openKeeperNote(KEEPER_SK + 1n, NOTE, COMMITMENT)).toBeNull();
  });

  test('a tampered ciphertext opens nothing', () => {
    const bad = [...NOTE];
    bad[4] = bad[4]! + 1n;
    expect(openKeeperNote(KEEPER_SK, bad, COMMITMENT)).toBeNull();
  });

  test('an ephemeral key off the curve is refused', () => {
    const bad = [...NOTE];
    bad[0] = bad[0]! + 1n;
    expect(openKeeperNote(KEEPER_SK, bad, COMMITMENT)).toBeNull();
  });

  test('the sink stores what opens and nothing else', () => {
    const saved: unknown[] = [];
    const sink = keeperNoteSink(KEEPER_SK, (p) => saved.push(p))!;
    sink(3, COMMITMENT, NOTE);
    sink(4, COMMITMENT + 1n, NOTE);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ leafIndex: 3, commitment: COMMITMENT, debtStroops: 2_000_000_000n });
    expect(keeperNoteSink(undefined)).toBeUndefined();
  });
});

describe('isLiquidatable', () => {
  // 500,000 sats at $60,000 is $300 of collateral; 120% of $250 is $300.
  test('matches the circuit at the threshold', () => {
    expect(isLiquidatable(500_000n, 2_500_000_000n, PRICE, THRESHOLD)).toBe(false);
    expect(isLiquidatable(500_000n, 2_500_000_001n, PRICE, THRESHOLD)).toBe(true);
    expect(isLiquidatable(500_000n, 0n, PRICE, THRESHOLD)).toBe(false);
  });
});

const LIQ_KEY = poseidon1([0x9988776655443322n]);
const TIMELOCK = 2_950_000;
function position(over: Partial<StoredKeeperPosition> = {}): StoredKeeperPosition {
  const p = {
    leafIndex: 1,
    liqKey: LIQ_KEY,
    nonce: 0x44n,
    collateralSats: 500_000n,
    debtStroops: 2_800_000_000n,
    timelockHeight: TIMELOCK,
    liquidated: false,
    ...over,
  };
  return { ...p, commitment: over.commitment ?? poseidon5([p.collateralSats, p.debtStroops, p.liqKey, p.nonce, BigInt(p.timelockHeight)]) };
}

function deps(positions: StoredKeeperPosition[], over: Partial<KeeperDeps> = {}) {
  const calls = { proved: [] as Record<string, unknown>[], liquidated: 0, marked: [] as number[] };
  const leaves = [11n, ...positions.map((p) => p.commitment)];
  const d: KeeperDeps = {
    positions: () => positions,
    leaves: () => leaves,
    isSpent: async () => false,
    prove: async (input) => {
      calls.proved.push(input);
      return { proof: { pi_a: { bytes: Buffer.alloc(64) }, pi_b: { bytes: Buffer.alloc(128) }, pi_c: { bytes: Buffer.alloc(64) } }, publicSignals: [] };
    },
    liquidate: async () => {
      calls.liquidated++;
      return 'tx';
    },
    markLiquidated: (i) => calls.marked.push(i),
    nullifierOf: () => 1n,
    priceStroopsPerBtc: PRICE,
    thresholdBp: THRESHOLD,
    ...over,
  };
  return { d, calls };
}

describe('runKeeperCycle', () => {
  test('liquidates an undercollateralized position and leaves a healthy one', async () => {
    const under = position();
    const healthy = position({ leafIndex: 2, debtStroops: 1_000_000_000n });
    const { d, calls } = deps([under, healthy]);
    expect(await runKeeperCycle(d)).toEqual([1]);
    expect(calls.liquidated).toBe(1);
    expect(calls.marked).toEqual([1]);
  });

  test('skips a leaf that has moved on since its note', async () => {
    const stale = position();
    const { d, calls } = deps([stale], { leaves: () => [11n, 999n] });
    expect(await runKeeperCycle(d)).toEqual([]);
    expect(calls.proved).toHaveLength(0);
  });

  test('marks a spent position without proving', async () => {
    const { d, calls } = deps([position()], { isSpent: async () => true });
    expect(await runKeeperCycle(d)).toEqual([]);
    expect(calls.proved).toHaveLength(0);
    expect(calls.marked).toEqual([1]);
  });

  test('a failed submission is not marked, so the next pass retries', async () => {
    const { d, calls } = deps([position()], { liquidate: async () => { throw new Error('rpc down'); } });
    expect(await runKeeperCycle(d)).toEqual([]);
    expect(calls.marked).toEqual([]);
  });

  test('its witness is one the liquidation circuit proves and verifies', async () => {
    const p = position();
    const input = buildLiquidationInput([11n, p.commitment], p, PRICE, THRESHOLD);
    const circuits = path.resolve(__dirname, '../circuits');
    const { proof, publicSignals } = await groth16.fullProve(
      input,
      path.join(circuits, 'liquidation.wasm'),
      path.join(circuits, 'liquidation_final.zkey'),
      undefined,
      {},
      { singleThread: true },
    );
    const vkey = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../privacy/circuits/keys/liquidation_vkey.json'), 'utf8'));
    expect(await groth16.verify(vkey, publicSignals, proof)).toBe(true);
    // [nullifier, usdc_debt, merkle_root, price, threshold]
    expect(BigInt(publicSignals[1]!)).toBe(p.debtStroops);
  }, 60_000);
});
