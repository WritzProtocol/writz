/**
 * Spending transaction tests — builds, signs, and finalizes PSBTs for both
 * Path A (co-sign) and Path B (emergency timelock), then inspects the
 * resulting witness structure without broadcasting to any network.
 */

import * as bitcoin from 'bitcoinjs-lib';
import {
  buildReleaseTransaction,
  buildEmergencyTransaction,
  finalizePathA,
  finalizePathB,
  serializeWitness,
  deserializeWitness,
} from '../src/spend.js';
import { deriveDepositAddress } from '../src/address.js';
import { generateKeyPair, pubkeyToP2WPKHAddress } from '../src/keys.js';

const network = bitcoin.networks.testnet;
const TIMELOCK = 2_900_000;
const AMOUNT_SAT = 100_000; // 0.001 BTC
const FEE_SAT = 300;

// ── Test fixtures ─────────────────────────────────────────────────────────────

function makeFixture() {
  const protocol = generateKeyPair(network);
  const user = generateKeyPair(network);

  const deposit = deriveDepositAddress(
    { protocolPubkey: protocol.publicKey, userPubkey: user.publicKey, timelockHeight: TIMELOCK },
    network,
  );

  const recipientAddress = pubkeyToP2WPKHAddress(user.publicKey, network);

  // Fake UTXO — a 64-char hex txid (all `de` bytes), output index 0.
  const txidHex = 'de'.repeat(32);
  const vout = 0;

  const spendParams = {
    txidHex,
    vout,
    amountSat: AMOUNT_SAT,
    scriptPubKey: deposit.scriptPubKey,
    redeemScript: deposit.redeemScript,
    recipientAddress,
    feeSat: FEE_SAT,
    network,
  };

  return { protocol, user, deposit, spendParams };
}

// ── serializeWitness / deserializeWitness ────────────────────────────────────

describe('serializeWitness / deserializeWitness', () => {
  test('round-trips an empty stack', () => {
    const buf = serializeWitness([]);
    expect(deserializeWitness(buf)).toEqual([]);
  });

  test('round-trips a single item', () => {
    const item = Buffer.from('deadbeef', 'hex');
    const buf = serializeWitness([item]);
    const items = deserializeWitness(buf);
    expect(items).toHaveLength(1);
    expect(items[0].equals(item)).toBe(true);
  });

  test('round-trips a multi-item witness stack', () => {
    const items = [
      Buffer.from('aabb', 'hex'),
      Buffer.alloc(0),              // empty item (OP_FALSE)
      Buffer.from('ccdd', 'hex'),
    ];
    const buf = serializeWitness(items);
    const decoded = deserializeWitness(buf);
    expect(decoded).toHaveLength(3);
    expect(decoded[0].equals(items[0])).toBe(true);
    expect(decoded[1].length).toBe(0);
    expect(decoded[2].equals(items[2])).toBe(true);
  });

  test('first byte of serialized witness is the item count', () => {
    const items = [Buffer.from('aa', 'hex'), Buffer.from('bb', 'hex')];
    const buf = serializeWitness(items);
    expect(buf[0]).toBe(2);
  });
});

// ── Path A: co-sign release ───────────────────────────────────────────────────

describe('Path A — co-sign release', () => {
  test('buildReleaseTransaction returns an unsigned PSBT', () => {
    const { spendParams } = makeFixture();
    const psbt = buildReleaseTransaction(spendParams);

    expect(psbt.inputCount).toBe(1);
    expect(psbt.txOutputs.length).toBe(1);
    expect(psbt.data.inputs[0].witnessScript).toBeDefined();
    expect(psbt.data.inputs[0].witnessUtxo).toBeDefined();
  });

  test('output value equals amountSat − feeSat', () => {
    const { spendParams } = makeFixture();
    const psbt = buildReleaseTransaction(spendParams);
    expect(psbt.txOutputs[0].value).toBe(AMOUNT_SAT - FEE_SAT);
  });

  test('both signers can sign the PSBT independently', () => {
    const { protocol, user, spendParams } = makeFixture();
    const psbt = buildReleaseTransaction(spendParams);

    psbt.signInput(0, protocol.signer);
    psbt.signInput(0, user.signer);

    expect(psbt.data.inputs[0].partialSig).toHaveLength(2);
  });

  test('finalizePathA produces a witness with 4 items', () => {
    const { protocol, user, spendParams } = makeFixture();
    const psbt = buildReleaseTransaction(spendParams);

    psbt.signInput(0, protocol.signer);
    psbt.signInput(0, user.signer);
    finalizePathA(psbt, 0, user.publicKey, protocol.publicKey);

    const tx = psbt.extractTransaction();
    const witness = tx.ins[0].witness;

    expect(witness).toHaveLength(4);
  });

  test('witness item [2] is 0x01 (OP_IF selector for co-sign branch)', () => {
    const { protocol, user, spendParams } = makeFixture();
    const psbt = buildReleaseTransaction(spendParams);

    psbt.signInput(0, protocol.signer);
    psbt.signInput(0, user.signer);
    finalizePathA(psbt, 0, user.publicKey, protocol.publicKey);

    const tx = psbt.extractTransaction();
    const witness = tx.ins[0].witness;

    expect(witness[2].equals(Buffer.from([0x01]))).toBe(true);
  });

  test('witness item [3] is the redeem script', () => {
    const { protocol, user, deposit, spendParams } = makeFixture();
    const psbt = buildReleaseTransaction(spendParams);

    psbt.signInput(0, protocol.signer);
    psbt.signInput(0, user.signer);
    finalizePathA(psbt, 0, user.publicKey, protocol.publicKey);

    const tx = psbt.extractTransaction();
    expect(tx.ins[0].witness[3].equals(deposit.redeemScript)).toBe(true);
  });

  test('witness items [0] and [1] are DER-encoded signatures (≥ 70 bytes)', () => {
    const { protocol, user, spendParams } = makeFixture();
    const psbt = buildReleaseTransaction(spendParams);

    psbt.signInput(0, protocol.signer);
    psbt.signInput(0, user.signer);
    finalizePathA(psbt, 0, user.publicKey, protocol.publicKey);

    const tx = psbt.extractTransaction();
    // DER sig + sighash byte: minimum 71 bytes (r,s ≥ 32 bytes each)
    expect(tx.ins[0].witness[0].length).toBeGreaterThanOrEqual(70);
    expect(tx.ins[0].witness[1].length).toBeGreaterThanOrEqual(70);
  });

  test('finalizePathA throws when user signature is missing', () => {
    const { protocol, user, spendParams } = makeFixture();
    const psbt = buildReleaseTransaction(spendParams);

    // Only protocol signs — user signature missing
    psbt.signInput(0, protocol.signer);

    expect(() => finalizePathA(psbt, 0, user.publicKey, protocol.publicKey))
      .toThrow('user signature not found');
  });

  test('finalizePathA throws when protocol signature is missing', () => {
    const { protocol, user, spendParams } = makeFixture();
    const psbt = buildReleaseTransaction(spendParams);

    // Only user signs — protocol signature missing
    psbt.signInput(0, user.signer);

    expect(() => finalizePathA(psbt, 0, user.publicKey, protocol.publicKey))
      .toThrow('protocol signature not found');
  });

  test('signing order (protocol-first vs user-first) does not matter', () => {
    const { protocol, user, spendParams } = makeFixture();

    const psbt1 = buildReleaseTransaction(spendParams);
    psbt1.signInput(0, protocol.signer);
    psbt1.signInput(0, user.signer);
    finalizePathA(psbt1, 0, user.publicKey, protocol.publicKey);

    const psbt2 = buildReleaseTransaction(spendParams);
    psbt2.signInput(0, user.signer);
    psbt2.signInput(0, protocol.signer);
    finalizePathA(psbt2, 0, user.publicKey, protocol.publicKey);

    const tx1 = psbt1.extractTransaction().toHex();
    const tx2 = psbt2.extractTransaction().toHex();
    // Both should produce valid (and identical) finalized transactions
    expect(tx1).toBe(tx2);
  });
});

// ── Path B: emergency timelock ────────────────────────────────────────────────

describe('Path B — emergency timelock', () => {
  test('buildEmergencyTransaction sets nLockTime to the timelock height', () => {
    const { spendParams } = makeFixture();
    const psbt = buildEmergencyTransaction(spendParams, TIMELOCK);
    expect(psbt.locktime).toBe(TIMELOCK);
  });

  test('input nSequence enables locktime checking (< 0xFFFFFFFF)', () => {
    const { spendParams } = makeFixture();
    const psbt = buildEmergencyTransaction(spendParams, TIMELOCK);
    // Inspect the sequence from the unsigned tx input via the PSBT data layer.
    const inputSeq = (psbt.data.globalMap.unsignedTx as any).tx.ins[0].sequence as number;
    expect(inputSeq).toBeLessThan(0xffff_ffff);
  });

  test('only the user needs to sign Path B', () => {
    const { user, spendParams } = makeFixture();
    const psbt = buildEmergencyTransaction(spendParams, TIMELOCK);

    psbt.signInput(0, user.signer);

    expect(psbt.data.inputs[0].partialSig).toHaveLength(1);
  });

  test('finalizePathB produces a witness with 3 items', () => {
    const { user, spendParams } = makeFixture();
    const psbt = buildEmergencyTransaction(spendParams, TIMELOCK);

    psbt.signInput(0, user.signer);
    finalizePathB(psbt, 0, user.publicKey);

    const tx = psbt.extractTransaction();
    expect(tx.ins[0].witness).toHaveLength(3);
  });

  test('witness item [1] is empty (OP_FALSE — takes OP_ELSE branch)', () => {
    const { user, spendParams } = makeFixture();
    const psbt = buildEmergencyTransaction(spendParams, TIMELOCK);

    psbt.signInput(0, user.signer);
    finalizePathB(psbt, 0, user.publicKey);

    const tx = psbt.extractTransaction();
    expect(tx.ins[0].witness[1].length).toBe(0);
  });

  test('witness item [2] is the redeem script', () => {
    const { user, deposit, spendParams } = makeFixture();
    const psbt = buildEmergencyTransaction(spendParams, TIMELOCK);

    psbt.signInput(0, user.signer);
    finalizePathB(psbt, 0, user.publicKey);

    const tx = psbt.extractTransaction();
    expect(tx.ins[0].witness[2].equals(deposit.redeemScript)).toBe(true);
  });

  test('finalizePathB throws when user signature is missing', () => {
    const { user, spendParams } = makeFixture();
    const psbt = buildEmergencyTransaction(spendParams, TIMELOCK);
    // No signature added
    expect(() => finalizePathB(psbt, 0, user.publicKey))
      .toThrow('no partial signatures');
  });

  test('Path B nLockTime is preserved in the extracted transaction', () => {
    const { user, spendParams } = makeFixture();
    const psbt = buildEmergencyTransaction(spendParams, TIMELOCK);

    psbt.signInput(0, user.signer);
    finalizePathB(psbt, 0, user.publicKey);

    const tx = psbt.extractTransaction();
    expect(tx.locktime).toBe(TIMELOCK);
  });
});

// ── PSBT portability ─────────────────────────────────────────────────────────

describe('PSBT portability (base64 round-trip)', () => {
  test('Path A PSBT can be serialized and deserialized', () => {
    const { protocol, user, spendParams } = makeFixture();
    const psbt = buildReleaseTransaction(spendParams);
    psbt.signInput(0, protocol.signer);

    const base64 = psbt.toBase64();
    const restored = bitcoin.Psbt.fromBase64(base64, { network });

    // Add user signature to the restored PSBT (simulates user wallet flow)
    restored.signInput(0, user.signer);
    finalizePathA(restored, 0, user.publicKey, protocol.publicKey);

    const tx = restored.extractTransaction();
    expect(tx.ins[0].witness).toHaveLength(4);
  });

  test('Path B PSBT can be serialized and deserialized', () => {
    const { user, spendParams } = makeFixture();
    const psbt = buildEmergencyTransaction(spendParams, TIMELOCK);

    const base64 = psbt.toBase64();
    const restored = bitcoin.Psbt.fromBase64(base64, { network });

    restored.signInput(0, user.signer);
    finalizePathB(restored, 0, user.publicKey);

    const tx = restored.extractTransaction();
    expect(tx.ins[0].witness).toHaveLength(3);
    expect(tx.locktime).toBe(TIMELOCK);
  });
});
