import { isSegwit, stripWitness, parseOutput } from '../src/bitcoin/tx.js';

// Build transaction buffers programmatically so byte counts are exact.

function makeLegacyTx(): Buffer {
  return Buffer.concat([
    Buffer.from('01000000', 'hex'),                          // version
    Buffer.from([0x01]),                                      // 1 input
    Buffer.alloc(32, 0x00),                                  // prev hash
    Buffer.from([0xff, 0xff, 0xff, 0xff]),                    // prev index
    Buffer.from([0x02]),                                      // scriptSig len = 2
    Buffer.from([0x01, 0x01]),                                // scriptSig
    Buffer.from([0xff, 0xff, 0xff, 0xff]),                    // sequence
    Buffer.from([0x01]),                                      // 1 output
    Buffer.from('e803000000000000', 'hex'),                   // 1000 sats
    Buffer.from([0x19]),                                      // scriptPubKey len = 25
    Buffer.from('76a914' + 'aa'.repeat(20) + '88ac', 'hex'), // P2PKH
    Buffer.from([0x00, 0x00, 0x00, 0x00]),                   // locktime
  ]);
}

// Returns both the full (with witness) and the expected non-witness serialization.
function makeSegwitTx(): { full: Buffer; noWitness: Buffer } {
  const common = {
    version:   Buffer.from('01000000', 'hex'),
    inCount:   Buffer.from([0x01]),
    prevHash:  Buffer.alloc(32, 0x00),
    prevIndex: Buffer.from([0x00, 0x00, 0x00, 0x00]),
    scriptLen: Buffer.from([0x00]),     // empty scriptSig (native segwit)
    sequence:  Buffer.from([0xff, 0xff, 0xff, 0xff]),
    outCount:  Buffer.from([0x01]),
    value:     Buffer.from('e803000000000000', 'hex'),
    spkLen:    Buffer.from([0x16]),     // 22 bytes (P2WPKH)
    spk:       Buffer.from('0014' + 'bb'.repeat(20), 'hex'),
    locktime:  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  };

  // Witness for input 0: 1 item of length 0 (minimal valid witness stack).
  const witness = Buffer.from([0x01, 0x00]);

  const full = Buffer.concat([
    common.version,
    Buffer.from([0x00, 0x01]),          // marker + flag
    common.inCount, common.prevHash, common.prevIndex, common.scriptLen, common.sequence,
    common.outCount, common.value, common.spkLen, common.spk,
    witness,
    common.locktime,
  ]);

  const noWitness = Buffer.concat([
    common.version,
    common.inCount, common.prevHash, common.prevIndex, common.scriptLen, common.sequence,
    common.outCount, common.value, common.spkLen, common.spk,
    common.locktime,
  ]);

  return { full, noWitness };
}

/**
 * A single-input P2WSH transaction whose witness stack has 4 items,
 * mirroring Writz's own real production release witness shape
 * (`[user_sig, protocol_sig, 0x01, redeemScript]`, see
 * `bitcoin-script/src/spend.ts`'s `finalizePathA`). The existing
 * `makeSegwitTx` fixture above has only a single 1-item witness stack and
 * cannot catch a bug in `stripWitness`'s per-item skip loop.
 */
function makeP2wshMultiItemWitnessTx(): { full: Buffer; noWitness: Buffer } {
  const common = {
    version: Buffer.from('01000000', 'hex'),
    inCount: Buffer.from([0x01]),
    prevHash: Buffer.alloc(32, 0x00),
    prevIndex: Buffer.from([0x00, 0x00, 0x00, 0x00]),
    scriptLen: Buffer.from([0x00]), // empty scriptSig (native segwit)
    sequence: Buffer.from([0xff, 0xff, 0xff, 0xff]),
    outCount: Buffer.from([0x01]),
    value: Buffer.from('e803000000000000', 'hex'),
    spkLen: Buffer.from([0x22]), // 34 bytes (P2WSH: OP_0 + 32-byte script hash)
    spk: Buffer.from('0020' + 'cc'.repeat(32), 'hex'),
    locktime: Buffer.from([0x00, 0x00, 0x00, 0x00]),
  };

  const userSig = Buffer.alloc(72, 0x11);
  const protocolSig = Buffer.alloc(71, 0x22);
  const opTrue = Buffer.from([0x01]);
  const redeemScript = Buffer.alloc(114, 0x33);

  const witness = Buffer.concat([
    Buffer.from([0x04]), // 4 witness stack items
    Buffer.from([userSig.length]), userSig,
    Buffer.from([protocolSig.length]), protocolSig,
    Buffer.from([opTrue.length]), opTrue,
    Buffer.from([redeemScript.length]), redeemScript,
  ]);

  const full = Buffer.concat([
    common.version,
    Buffer.from([0x00, 0x01]),
    common.inCount, common.prevHash, common.prevIndex, common.scriptLen, common.sequence,
    common.outCount, common.value, common.spkLen, common.spk,
    witness,
    common.locktime,
  ]);

  const noWitness = Buffer.concat([
    common.version,
    common.inCount, common.prevHash, common.prevIndex, common.scriptLen, common.sequence,
    common.outCount, common.value, common.spkLen, common.spk,
    common.locktime,
  ]);

  return { full, noWitness };
}

/**
 * A P2TR (Taproot key-path spend) transaction: single witness item, a
 * 64-byte Schnorr signature - a SegWit output type that otherwise had no
 * test coverage.
 */
function makeP2trTx(): { full: Buffer; noWitness: Buffer } {
  const common = {
    version: Buffer.from('01000000', 'hex'),
    inCount: Buffer.from([0x01]),
    prevHash: Buffer.alloc(32, 0x00),
    prevIndex: Buffer.from([0x00, 0x00, 0x00, 0x00]),
    scriptLen: Buffer.from([0x00]),
    sequence: Buffer.from([0xff, 0xff, 0xff, 0xff]),
    outCount: Buffer.from([0x01]),
    value: Buffer.from('e803000000000000', 'hex'),
    spkLen: Buffer.from([0x22]), // 34 bytes: OP_1 (0x51) + 32-byte x-only pubkey
    spk: Buffer.from('5120' + 'dd'.repeat(32), 'hex'),
    locktime: Buffer.from([0x00, 0x00, 0x00, 0x00]),
  };

  const schnorrSig = Buffer.alloc(64, 0xaa);
  const witness = Buffer.concat([
    Buffer.from([0x01]), // 1 witness stack item
    Buffer.from([schnorrSig.length]), schnorrSig,
  ]);

  const full = Buffer.concat([
    common.version,
    Buffer.from([0x00, 0x01]),
    common.inCount, common.prevHash, common.prevIndex, common.scriptLen, common.sequence,
    common.outCount, common.value, common.spkLen, common.spk,
    witness,
    common.locktime,
  ]);

  const noWitness = Buffer.concat([
    common.version,
    common.inCount, common.prevHash, common.prevIndex, common.scriptLen, common.sequence,
    common.outCount, common.value, common.spkLen, common.spk,
    common.locktime,
  ]);

  return { full, noWitness };
}

/**
 * A 2-input SegWit transaction, each input carrying its own distinct
 * witness stack (different item lengths). `stripWitness`'s witness-skipping
 * loop (`tx.ts:92-99`) iterates once per input; the single-input fixtures
 * above cannot detect an off-by-one or interleaving bug in that loop - this
 * is the highest-value addition to this test suite.
 */
function makeTwoInputSegwitTx(): { full: Buffer; noWitness: Buffer } {
  const common = {
    version: Buffer.from('01000000', 'hex'),
    inCount: Buffer.from([0x02]),
    prevHash0: Buffer.alloc(32, 0x00),
    prevHash1: Buffer.alloc(32, 0x01),
    prevIndex: Buffer.from([0x00, 0x00, 0x00, 0x00]),
    scriptLen: Buffer.from([0x00]),
    sequence: Buffer.from([0xff, 0xff, 0xff, 0xff]),
    outCount: Buffer.from([0x01]),
    value: Buffer.from('e803000000000000', 'hex'),
    spkLen: Buffer.from([0x16]),
    spk: Buffer.from('0014' + 'bb'.repeat(20), 'hex'),
    locktime: Buffer.from([0x00, 0x00, 0x00, 0x00]),
  };

  // Input 0's witness: a single 72-byte item.
  const witness0 = Buffer.concat([
    Buffer.from([0x01]),
    Buffer.from([72]), Buffer.alloc(72, 0xee),
  ]);
  // Input 1's witness: a single 33-byte item (deliberately different length,
  // so a fixed-offset assumption in the skip loop would misalign here).
  const witness1 = Buffer.concat([
    Buffer.from([0x01]),
    Buffer.from([33]), Buffer.alloc(33, 0xff),
  ]);

  const inputs = Buffer.concat([
    common.prevHash0, common.prevIndex, common.scriptLen, common.sequence,
    common.prevHash1, common.prevIndex, common.scriptLen, common.sequence,
  ]);

  const full = Buffer.concat([
    common.version,
    Buffer.from([0x00, 0x01]),
    common.inCount, inputs,
    common.outCount, common.value, common.spkLen, common.spk,
    witness0, witness1,
    common.locktime,
  ]);

  const noWitness = Buffer.concat([
    common.version,
    common.inCount, inputs,
    common.outCount, common.value, common.spkLen, common.spk,
    common.locktime,
  ]);

  return { full, noWitness };
}

// Two-output legacy tx used for parseOutput tests.
function makeTwoOutputLegacyTx(): Buffer {
  const p2pkh  = Buffer.from('76a914' + 'aa'.repeat(20) + '88ac', 'hex'); // 25 bytes
  const opReturn = Buffer.from('6a04deadbeef', 'hex');                    // 6 bytes

  return Buffer.concat([
    Buffer.from('01000000', 'hex'),
    Buffer.from([0x01]),
    Buffer.alloc(32, 0x00),
    Buffer.from([0xff, 0xff, 0xff, 0xff]),
    Buffer.from([0x00]),
    Buffer.from([0xff, 0xff, 0xff, 0xff]),
    Buffer.from([0x02]),                              // 2 outputs
    Buffer.from('e803000000000000', 'hex'),           // output 0: 1000 sats
    Buffer.from([p2pkh.length]),
    p2pkh,
    Buffer.from('2202000000000000', 'hex'),           // output 1: 546 sats
    Buffer.from([opReturn.length]),
    opReturn,
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
  ]);
}

// ── isSegwit ────────────────────────────────────────────────────────────────

describe('isSegwit', () => {
  test('returns false for a legacy transaction', () => {
    expect(isSegwit(makeLegacyTx().toString('hex'))).toBe(false);
  });

  test('returns true for a SegWit transaction', () => {
    const { full } = makeSegwitTx();
    expect(isSegwit(full.toString('hex'))).toBe(true);
  });

  test('returns false for an empty buffer', () => {
    expect(isSegwit('')).toBe(false);
  });
});

// ── stripWitness ────────────────────────────────────────────────────────────

describe('stripWitness', () => {
  test('returns a legacy transaction byte-for-byte unchanged', () => {
    const hex = makeLegacyTx().toString('hex');
    expect(stripWitness(hex)).toBe(hex);
  });

  test('strips marker, flag, and witness from a SegWit transaction', () => {
    const { full, noWitness } = makeSegwitTx();
    expect(stripWitness(full.toString('hex'))).toBe(noWitness.toString('hex'));
  });

  test('stripped result is shorter than the original SegWit tx', () => {
    const { full, noWitness } = makeSegwitTx();
    expect(stripWitness(full.toString('hex')).length).toBe(noWitness.toString('hex').length);
    expect(full.length).toBeGreaterThan(noWitness.length);
  });

  test('stripped result is not detected as SegWit', () => {
    const { full } = makeSegwitTx();
    const stripped = stripWitness(full.toString('hex'));
    expect(isSegwit(stripped)).toBe(false);
  });

  test('strips a P2WSH transaction with a 4-item witness stack (Writz production witness shape)', () => {
    const { full, noWitness } = makeP2wshMultiItemWitnessTx();
    expect(stripWitness(full.toString('hex'))).toBe(noWitness.toString('hex'));
  });

  test('strips a P2TR (Taproot key-path) transaction', () => {
    const { full, noWitness } = makeP2trTx();
    expect(stripWitness(full.toString('hex'))).toBe(noWitness.toString('hex'));
  });

  test('strips a 2-input SegWit transaction with distinct per-input witness stacks', () => {
    const { full, noWitness } = makeTwoInputSegwitTx();
    expect(stripWitness(full.toString('hex'))).toBe(noWitness.toString('hex'));
  });

  // ── Truncation must throw, not silently return corrupted output ──
  // (Buffer.subarray clamps to buffer length instead of erroring on an
  // out-of-range end index - every fixed/computed-length read in tx.ts must
  // reject a truncated buffer explicitly instead of inheriting that default.)

  test('throws when truncated mid-prevout (input 36-byte field)', () => {
    const { full } = makeSegwitTx();
    // Cut partway through the prevout hash, well before the input completes.
    const truncated = full.subarray(0, 20).toString('hex');
    expect(() => stripWitness(truncated)).toThrow(RangeError);
  });

  test('throws when truncated mid-scriptSig', () => {
    const { full } = makeSegwitTx();
    // version(4) + marker/flag(2) + inCount(1) + prevout(36) + partial scriptSig varint only
    const truncated = full.subarray(0, 43).toString('hex');
    expect(() => stripWitness(truncated)).toThrow(RangeError);
  });

  test('throws when truncated before locktime', () => {
    const { full } = makeSegwitTx();
    // Drop only the final 4 locktime bytes - everything else is intact.
    const truncated = full.subarray(0, full.length - 4).toString('hex');
    expect(() => stripWitness(truncated)).toThrow(RangeError);
  });

  test('throws when truncated by a single trailing byte, rather than returning a shortened result', () => {
    // Before the fix, this specific case (truncated just inside the last
    // field) was the one most likely to silently succeed with corrupted
    // output - `subarray` clamping to the buffer's actual length looks like
    // a normal read when the shortfall is small.
    const { full } = makeSegwitTx();
    const truncated = full.subarray(0, full.length - 1).toString('hex');
    expect(() => stripWitness(truncated)).toThrow(RangeError);
  });
});

// ── parseOutput ─────────────────────────────────────────────────────────────

describe('parseOutput', () => {
  test('parses value and scriptPubKey of the first output', () => {
    const hex = makeLegacyTx().toString('hex');
    const out = parseOutput(hex, 0);
    expect(out.valueSat).toBe(1000);
    expect(out.scriptPubKey).toBe('76a914' + 'aa'.repeat(20) + '88ac');
  });

  test('parses the correct output at index 1 in a two-output tx', () => {
    const hex = makeTwoOutputLegacyTx().toString('hex');
    const out1 = parseOutput(hex, 1);
    expect(out1.valueSat).toBe(546);
    expect(out1.scriptPubKey).toBe('6a04deadbeef');
  });

  test('parses the correct output at index 0 in a two-output tx', () => {
    const hex = makeTwoOutputLegacyTx().toString('hex');
    const out0 = parseOutput(hex, 0);
    expect(out0.valueSat).toBe(1000);
  });

  test('throws RangeError for an out-of-bounds outputIndex', () => {
    const hex = makeLegacyTx().toString('hex');
    expect(() => parseOutput(hex, 1)).toThrow(RangeError);
  });

  test('throws RangeError for a negative-like large outputIndex', () => {
    const hex = makeLegacyTx().toString('hex');
    expect(() => parseOutput(hex, 999)).toThrow(RangeError);
  });

  test('throws when truncated mid-scriptPubKey, rather than returning a shortened script', () => {
    const full = makeLegacyTx();
    // The scriptPubKey is the last field before locktime - drop enough
    // trailing bytes to cut it short without removing the whole tx.
    const truncated = full.subarray(0, full.length - 10).toString('hex');
    expect(() => parseOutput(truncated, 0)).toThrow(RangeError);
  });

  test('throws rather than losing precision for a satoshi value beyond MAX_SAFE_INTEGER', () => {
    // 2^63 as an 8-byte LE value - comfortably beyond Number.MAX_SAFE_INTEGER
    // (2^53-1) and beyond any value 21M BTC could ever encode, but a
    // corrupted or adversarial buffer could still contain it.
    const hugeValue = Buffer.alloc(8);
    hugeValue.writeBigUInt64LE(1n << 63n);
    const tx = Buffer.concat([
      Buffer.from('01000000', 'hex'),
      Buffer.from([0x01]),
      Buffer.alloc(32, 0x00),
      Buffer.from([0xff, 0xff, 0xff, 0xff]),
      Buffer.from([0x00]), // empty scriptSig
      Buffer.from([0xff, 0xff, 0xff, 0xff]),
      Buffer.from([0x01]),
      hugeValue,
      Buffer.from([0x00]), // empty scriptPubKey
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
    ]);
    expect(() => parseOutput(tx.toString('hex'), 0)).toThrow(RangeError);
  });
});
