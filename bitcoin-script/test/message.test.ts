import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { ECPairFactory } from 'ecpair';
import {
  bitcoinMessageHash,
  recoverBitcoinMessagePubkey,
  signBitcoinMessage,
  verifyBitcoinMessage,
} from '../src/message.js';

const ECPair = ECPairFactory(ecc);
const priv = Buffer.alloc(32, 9);
const pub = Buffer.from(ECPair.fromPrivateKey(priv).publicKey);
const other = Buffer.from(ECPair.fromPrivateKey(Buffer.alloc(32, 8)).publicKey);
const MSG = 'Writz Signet faucet\nnonce:abc\nstellar:GABC\nsignet:tb1qxyz';

describe('BIP-137 messages', () => {
  test('hashes the standard framing (known vector for "hello")', () => {
    const magic = Buffer.from('Bitcoin Signed Message:\n');
    const frame = Buffer.concat([Buffer.from([magic.length]), magic, Buffer.from([5]), Buffer.from('hello')]);
    expect(bitcoinMessageHash('hello').equals(bitcoin.crypto.hash256(frame))).toBe(true);
  });

  test('a signature recovers the signing key and verifies', () => {
    const sig = signBitcoinMessage(MSG, priv);
    expect(Buffer.from(sig, 'base64')[0]).toBeGreaterThanOrEqual(39);
    expect(recoverBitcoinMessagePubkey(MSG, sig)?.equals(pub)).toBe(true);
    expect(verifyBitcoinMessage(MSG, sig, pub)).toBe(true);
  });

  test('accepts the compressed P2PKH header most wallets emit', () => {
    const raw = Buffer.from(signBitcoinMessage(MSG, priv), 'base64');
    raw[0] = raw[0] - 39 + 31;
    expect(verifyBitcoinMessage(MSG, raw, pub)).toBe(true);
  });

  test('refuses another key, another message, a tampered or malformed signature', () => {
    const sig = signBitcoinMessage(MSG, priv);
    expect(verifyBitcoinMessage(MSG, sig, other)).toBe(false);
    expect(verifyBitcoinMessage(MSG + 'x', sig, pub)).toBe(false);
    const raw = Buffer.from(sig, 'base64');
    raw[10] ^= 1;
    expect(verifyBitcoinMessage(MSG, raw, pub)).toBe(false);
    expect(verifyBitcoinMessage(MSG, Buffer.alloc(64), pub)).toBe(false);
    expect(verifyBitcoinMessage(MSG, 'not base64 at all', pub)).toBe(false);
  });

  test('refuses an uncompressed-key header', () => {
    const raw = Buffer.from(signBitcoinMessage(MSG, priv), 'base64');
    raw[0] = raw[0] - 39 + 27;
    expect(recoverBitcoinMessagePubkey(MSG, raw)).toBeNull();
  });
});
