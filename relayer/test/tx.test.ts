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
});
