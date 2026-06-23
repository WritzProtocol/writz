import * as bitcoin from 'bitcoinjs-lib';
import {
  buildRedeemScript,
  decompileRedeemScript,
  computeTimelock,
  MIN_TIMELOCK_HEIGHT,
} from '../src/script.js';
import { generateKeyPair } from '../src/keys.js';

const network = bitcoin.networks.testnet;
const TIMELOCK = 2_900_000;

function makeKeys() {
  const protocol = generateKeyPair(network);
  const user = generateKeyPair(network);
  return { protocol, user };
}

// ── buildRedeemScript ────────────────────────────────────────────────────────

describe('buildRedeemScript', () => {
  test('returns a Buffer', () => {
    const { protocol, user } = makeKeys();
    const script = buildRedeemScript(protocol.publicKey, user.publicKey, TIMELOCK);
    expect(Buffer.isBuffer(script)).toBe(true);
    expect(script.length).toBeGreaterThan(0);
  });

  test('decompiles to the expected opcode sequence', () => {
    const { protocol, user } = makeKeys();
    const script = buildRedeemScript(protocol.publicKey, user.publicKey, TIMELOCK);
    const ops = decompileRedeemScript(script);

    // OP_IF
    expect(ops[0]).toBe(bitcoin.opcodes.OP_IF);
    // <protocol_pubkey> — 33-byte buffer
    expect(Buffer.isBuffer(ops[1])).toBe(true);
    expect((ops[1] as Buffer).length).toBe(33);
    expect((ops[1] as Buffer).equals(protocol.publicKey)).toBe(true);
    // OP_CHECKSIGVERIFY
    expect(ops[2]).toBe(bitcoin.opcodes.OP_CHECKSIGVERIFY);
    // <user_pubkey> — 33-byte buffer
    expect(Buffer.isBuffer(ops[3])).toBe(true);
    expect((ops[3] as Buffer).equals(user.publicKey)).toBe(true);
    // OP_CHECKSIG
    expect(ops[4]).toBe(bitcoin.opcodes.OP_CHECKSIG);
    // OP_ELSE
    expect(ops[5]).toBe(bitcoin.opcodes.OP_ELSE);
    // <timelock> — encoded integer
    expect(Buffer.isBuffer(ops[6])).toBe(true);
    // OP_CHECKLOCKTIMEVERIFY
    expect(ops[7]).toBe(bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY);
    // OP_DROP
    expect(ops[8]).toBe(bitcoin.opcodes.OP_DROP);
    // <user_pubkey> again
    expect(Buffer.isBuffer(ops[9])).toBe(true);
    expect((ops[9] as Buffer).equals(user.publicKey)).toBe(true);
    // OP_CHECKSIG
    expect(ops[10]).toBe(bitcoin.opcodes.OP_CHECKSIG);
    // OP_ENDIF
    expect(ops[11]).toBe(bitcoin.opcodes.OP_ENDIF);
  });

  test('timelock is encoded in the script as a Bitcoin script integer', () => {
    const { protocol, user } = makeKeys();
    const script = buildRedeemScript(protocol.publicKey, user.publicKey, TIMELOCK);
    const ops = decompileRedeemScript(script);
    const timelockBuf = ops[6] as Buffer;
    expect(bitcoin.script.number.decode(timelockBuf)).toBe(TIMELOCK);
  });

  test('different timelocks produce different scripts', () => {
    const { protocol, user } = makeKeys();
    const s1 = buildRedeemScript(protocol.publicKey, user.publicKey, TIMELOCK);
    const s2 = buildRedeemScript(protocol.publicKey, user.publicKey, TIMELOCK + 1000);
    expect(s1.equals(s2)).toBe(false);
  });

  test('different user pubkeys produce different scripts', () => {
    const { protocol, user } = makeKeys();
    const user2 = generateKeyPair(network);
    const s1 = buildRedeemScript(protocol.publicKey, user.publicKey, TIMELOCK);
    const s2 = buildRedeemScript(protocol.publicKey, user2.publicKey, TIMELOCK);
    expect(s1.equals(s2)).toBe(false);
  });

  test('same inputs always produce the same script (deterministic)', () => {
    const { protocol, user } = makeKeys();
    const s1 = buildRedeemScript(protocol.publicKey, user.publicKey, TIMELOCK);
    const s2 = buildRedeemScript(protocol.publicKey, user.publicKey, TIMELOCK);
    expect(s1.equals(s2)).toBe(true);
  });

  test('throws for 65-byte (uncompressed) protocol pubkey', () => {
    const { user } = makeKeys();
    const uncompressed = Buffer.alloc(65, 0x04);
    expect(() => buildRedeemScript(uncompressed, user.publicKey, TIMELOCK))
      .toThrow('33-byte compressed');
  });

  test('throws for 65-byte (uncompressed) user pubkey', () => {
    const { protocol } = makeKeys();
    const uncompressed = Buffer.alloc(65, 0x04);
    expect(() => buildRedeemScript(protocol.publicKey, uncompressed, TIMELOCK))
      .toThrow('33-byte compressed');
  });

  test(`throws for timelockHeight below ${MIN_TIMELOCK_HEIGHT}`, () => {
    const { protocol, user } = makeKeys();
    expect(() => buildRedeemScript(protocol.publicKey, user.publicKey, 1000))
      .toThrow(`≥ ${MIN_TIMELOCK_HEIGHT}`);
  });
});

// ── computeTimelock ──────────────────────────────────────────────────────────

describe('computeTimelock', () => {
  test('adds loan duration and default safety buffer to deposit height', () => {
    const result = computeTimelock(800_000, 4_320); // 30-day loan
    expect(result).toBe(800_000 + 4_320 + 1_008);
  });

  test('uses provided safety buffer override', () => {
    const result = computeTimelock(800_000, 4_320, 2_016); // 14-day buffer
    expect(result).toBe(800_000 + 4_320 + 2_016);
  });

  test('for a 30-day loan, timelock is approximately 37 days out', () => {
    const depositBlock = 800_000;
    const loanDuration = 4_320; // 30 days × 6 blocks/hour × 24 hours
    const timelock = computeTimelock(depositBlock, loanDuration);
    // 37 days ≈ 5,328 blocks
    expect(timelock - depositBlock).toBe(5_328);
  });
});
