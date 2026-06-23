import * as bitcoin from 'bitcoinjs-lib';
import { deriveDepositAddress, redeemScriptHash } from '../src/address.js';
import { generateKeyPair } from '../src/keys.js';
import type { LockingParams } from '../src/address.js';

const mainnet = bitcoin.networks.bitcoin;
const testnet = bitcoin.networks.testnet;
const TIMELOCK = 2_900_000;

function makeParams(network: bitcoin.networks.Network): LockingParams {
  return {
    protocolPubkey: generateKeyPair(network).publicKey,
    userPubkey: generateKeyPair(network).publicKey,
    timelockHeight: TIMELOCK,
  };
}

// ── deriveDepositAddress ─────────────────────────────────────────────────────

describe('deriveDepositAddress', () => {
  test('returns a bech32 address on testnet starting with tb1q', () => {
    const addr = deriveDepositAddress(makeParams(testnet), testnet);
    expect(addr.address.startsWith('tb1q')).toBe(true);
  });

  test('returns a bech32 address on mainnet starting with bc1q', () => {
    const addr = deriveDepositAddress(makeParams(mainnet), mainnet);
    expect(addr.address.startsWith('bc1q')).toBe(true);
  });

  test('scriptPubKey is 34 bytes: OP_0 + 32-byte script hash', () => {
    const addr = deriveDepositAddress(makeParams(testnet), testnet);
    expect(addr.scriptPubKey.length).toBe(34);
    expect(addr.scriptPubKey[0]).toBe(0x00); // OP_0
    expect(addr.scriptPubKey[1]).toBe(0x20); // push 32 bytes
  });

  test('redeemScript is included in the result', () => {
    const addr = deriveDepositAddress(makeParams(testnet), testnet);
    expect(Buffer.isBuffer(addr.redeemScript)).toBe(true);
    expect(addr.redeemScript.length).toBeGreaterThan(0);
  });

  test('derivation is deterministic — same params, same address', () => {
    const params = makeParams(testnet);
    const addr1 = deriveDepositAddress(params, testnet);
    const addr2 = deriveDepositAddress(params, testnet);
    expect(addr1.address).toBe(addr2.address);
    expect(addr1.scriptPubKey.equals(addr2.scriptPubKey)).toBe(true);
  });

  test('different timelocks → different addresses', () => {
    const params = makeParams(testnet);
    const addr1 = deriveDepositAddress(params, testnet);
    const addr2 = deriveDepositAddress({ ...params, timelockHeight: TIMELOCK + 1000 }, testnet);
    expect(addr1.address).not.toBe(addr2.address);
  });

  test('different user pubkeys → different addresses', () => {
    const params = makeParams(testnet);
    const addr1 = deriveDepositAddress(params, testnet);
    const addr2 = deriveDepositAddress(
      { ...params, userPubkey: generateKeyPair(testnet).publicKey },
      testnet,
    );
    expect(addr1.address).not.toBe(addr2.address);
  });

  test('different protocol pubkeys → different addresses', () => {
    const params = makeParams(testnet);
    const addr1 = deriveDepositAddress(params, testnet);
    const addr2 = deriveDepositAddress(
      { ...params, protocolPubkey: generateKeyPair(testnet).publicKey },
      testnet,
    );
    expect(addr1.address).not.toBe(addr2.address);
  });

  test('mainnet and testnet produce different addresses for same keys', () => {
    const protocolKey = generateKeyPair(mainnet);
    const userKey = generateKeyPair(mainnet);
    // Build params manually since keys are not network-bound in the pubkey bytes
    const mainnetAddr = deriveDepositAddress(
      { protocolPubkey: protocolKey.publicKey, userPubkey: userKey.publicKey, timelockHeight: TIMELOCK },
      mainnet,
    );
    const testnetAddr = deriveDepositAddress(
      { protocolPubkey: protocolKey.publicKey, userPubkey: userKey.publicKey, timelockHeight: TIMELOCK },
      testnet,
    );
    expect(mainnetAddr.address).not.toBe(testnetAddr.address);
  });

  test('scriptPubKey matches SHA256(redeemScript) after the OP_0 + push byte', () => {
    const addr = deriveDepositAddress(makeParams(testnet), testnet);
    const expectedHash = bitcoin.crypto.sha256(addr.redeemScript);
    const actualHash = addr.scriptPubKey.subarray(2); // skip OP_0 + push-32 byte
    expect(actualHash.equals(expectedHash)).toBe(true);
  });
});

// ── redeemScriptHash ─────────────────────────────────────────────────────────

describe('redeemScriptHash', () => {
  test('returns 32-byte SHA256 digest', () => {
    const addr = deriveDepositAddress(makeParams(testnet), testnet);
    const hash = redeemScriptHash(addr.redeemScript);
    expect(hash.length).toBe(32);
  });

  test('matches the hash embedded in the scriptPubKey', () => {
    const addr = deriveDepositAddress(makeParams(testnet), testnet);
    const hash = redeemScriptHash(addr.redeemScript);
    const fromSpk = addr.scriptPubKey.subarray(2);
    expect(hash.equals(fromSpk)).toBe(true);
  });
});
