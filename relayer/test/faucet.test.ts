/**
 * Signet faucet, social-login claims only: request shape, the single-use
 * nonce, key control (BIP-137 over the nonce and both addresses, P2WPKH of
 * the key), the Pollar login check (Server API mocked), one claim per
 * account, Stellar address and Signet address, the per-IP allowance, the
 * daily cap, the balance check, serialized sends and the HTTP surface.
 * Esplora is a mock; signing is real (@writz/bitcoin-script), so every paid
 * transaction is decoded and checked.
 */
import express from 'express';
import request from 'supertest';
import * as btc from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { keyPairFromPrivkey, pubkeyToP2WPKHAddress, signBitcoinMessage } from '@writz/bitcoin-script';
import { EsploraError, type AddressUtxo } from '../src/bitcoin/esplora.js';
import {
  SignetFaucet,
  FaucetError,
  normalizeSignetAddress,
  type ClaimRequest,
  type FaucetEsplora,
  type FaucetSettings,
} from '../src/faucet/service.js';
import { MemoryClaimStore } from '../src/faucet/store.js';
import { faucetClaimMessage, NonceBook } from '../src/faucet/nonce.js';
import { createPollarVerifier, userKeyFor, type LoginVerifier } from '../src/faucet/pollar.js';
import { createFaucetRouter } from '../src/routes/faucet.js';

btc.initEccLib(ecc);
const net = btc.networks.testnet;
const FAUCET_PRIV = Buffer.alloc(32, 7);
const wallet = keyPairFromPrivkey(FAUCET_PRIV, net);
const FAUCET_ADDR = pubkeyToP2WPKHAddress(wallet.publicKey, net);
const priv = (n: number) => Buffer.alloc(32, n);
const pubOf = (n: number) => keyPairFromPrivkey(priv(n), net).publicKey;
const userAddr = (n: number) => pubkeyToP2WPKHAddress(pubOf(n), net);
const USER = userAddr(11);

/** A well-formed G-address per number (the faucet never decodes it; Pollar vouches for it). */
const stellar = (n: number) => {
  let tail = '';
  for (let i = 0, k = n; i < 5; i++, k = Math.floor(k / 26)) tail = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[k % 26] + tail;
  return `G${'A'.repeat(50)}${tail}`;
};

const SETTINGS: FaucetSettings = {
  amountSat: 20_000,
  dailyCap: 3,
  ipClaimsPerWindow: 20,
  ipWindowMs: 3_600_000,
  minFeeRate: 2,
  maxFeeRate: 25,
  feeTargetBlocks: 3,
};

/** A minimal Esplora: UTXOs disappear when spent and change appears, like mempool.space. */
class FakeEsplora implements FaucetEsplora {
  utxos: AddressUtxo[];
  fees: Record<string, number> = { '1': 3, '3': 1.2, '6': 1 };
  broadcasts: string[] = [];
  failBroadcast: Error | undefined;
  failUtxos: Error | undefined;
  listLag = false;

  constructor(values: number[]) {
    this.utxos = values.map((value, i) => ({
      txid: (i + 1).toString(16).padStart(2, '0').repeat(32),
      vout: 0,
      value,
      status: { confirmed: true },
    }));
  }

  async getAddressUtxos(address: string) {
    if (this.failUtxos) throw this.failUtxos;
    expect(address).toBe(FAUCET_ADDR);
    return [...this.utxos];
  }

  async getFeeEstimates() {
    return this.fees;
  }

  async broadcastTx(hex: string) {
    if (this.failBroadcast) throw this.failBroadcast;
    this.broadcasts.push(hex);
    const tx = btc.Transaction.fromHex(hex);
    if (!this.listLag) {
      const spent = new Set(tx.ins.map((i) => `${Buffer.from(i.hash).reverse().toString('hex')}:${i.index}`));
      this.utxos = this.utxos.filter((u) => !spent.has(`${u.txid}:${u.vout}`));
      tx.outs.forEach((o, vout) => {
        if (vout > 0) this.utxos.push({ txid: tx.getId(), vout, value: o.value, status: { confirmed: false } });
      });
    }
    return tx.getId();
  }
}

/** Stands in for Pollar in the service tests: token -> account. The real client is tested below with fetch mocked. */
class FakeLogins implements LoginVerifier {
  readonly accounts = new Map<string, { userId: string; address: string }>();
  calls = 0;
  async verify(token: string, stellarAddress: string) {
    this.calls++;
    const a = this.accounts.get(token);
    if (!a) throw new FaucetError('login_invalid', 'the sign-in token is not valid');
    if (a.address !== stellarAddress) throw new FaucetError('login_address_mismatch', 'mismatch');
    return { userKey: userKeyFor(a.userId), stellarAddress };
  }
}

let t: number;
function setup(values = [100_000], settings: Partial<FaucetSettings> = {}, verifier?: LoginVerifier) {
  const esplora = new FakeEsplora(values);
  const store = new MemoryClaimStore();
  const logins = new FakeLogins();
  const faucet = new SignetFaucet({
    wallet,
    esplora,
    store,
    settings: { ...SETTINGS, ...settings },
    verifier: verifier ?? logins,
    nonces: new NonceBook(() => t),
    now: () => t,
    log: () => {},
  });
  return { esplora, store, faucet, logins };
}

interface Who {
  /** Signet key number. */
  key: number;
  /** Stellar address number. */
  stellar?: number;
  /** Pollar user id. */
  user?: string;
}

/**
 * A complete claim body for a user: registers the login with `logins` (when
 * given) and signs a fresh nonce with the user's Signet key.
 */
function claimBody(faucet: SignetFaucet, logins: FakeLogins | undefined, who: Who, patch: Partial<ClaimRequest> = {}): ClaimRequest {
  const stellarAddress = stellar(who.stellar ?? who.key);
  const token = `tok-${who.user ?? `user-${who.key}`}-${stellarAddress.slice(-5)}`;
  logins?.accounts.set(token, { userId: who.user ?? `user-${who.key}`, address: stellarAddress });
  const signetAddress = pubkeyToP2WPKHAddress(pubOf(who.key), net);
  const nonce = patch.nonce ?? faucet.issueNonce().nonce;
  const sa = patch.stellarAddress ?? stellarAddress;
  const sg = patch.signetAddress ?? signetAddress;
  return {
    pollarAccessToken: token,
    stellarAddress: sa,
    signetAddress: sg,
    signetPubkey: pubOf(who.key).toString('hex'),
    nonce,
    keySig: signBitcoinMessage(faucetClaimMessage(nonce, sa, sg), priv(who.key)),
    ...patch,
  };
}

function appFor(faucet: SignetFaucet | undefined, rateLimit = 100, disabledReason = 'no faucet key is configured') {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/faucet', createFaucetRouter({ faucet, disabledReason, rateLimit, rateWindowMs: 60_000, now: () => t }));
  return app;
}

beforeEach(() => {
  t = Date.UTC(2026, 9, 24, 12, 0, 0);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('normalizeSignetAddress', () => {
  test('accepts tb1q and tb1p, and lowercases an all-uppercase address', () => {
    expect(normalizeSignetAddress(USER)).toBe(USER);
    expect(normalizeSignetAddress(`  ${USER.toUpperCase()} `)).toBe(USER);
    const tr = btc.payments.p2tr({ internalPubkey: wallet.publicKey.subarray(1), network: net }).address!;
    expect(normalizeSignetAddress(tr)).toBe(tr);
  });

  test.each([
    ['mainnet bech32', pubkeyToP2WPKHAddress(wallet.publicKey, btc.networks.bitcoin)],
    ['regtest', pubkeyToP2WPKHAddress(wallet.publicKey, btc.networks.regtest)],
    ['testnet legacy', btc.payments.p2pkh({ pubkey: wallet.publicKey, network: net }).address!],
    ['bad checksum', USER.slice(0, -1) + (USER.endsWith('q') ? 'p' : 'q')],
    ['mixed case', USER.slice(0, 10).toUpperCase() + USER.slice(10)],
    ['not a string', 42],
    ['empty', ''],
  ])('refuses %s', (_label, addr) => {
    expect(() => normalizeSignetAddress(addr)).toThrow(FaucetError);
  });
});

describe('claim message', () => {
  test('binds the nonce and both addresses, byte for byte as the app builds it (frontend lib/faucet/claim.ts)', () => {
    expect(faucetClaimMessage('0123456789abcdef0123456789abcdef', 'GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT', 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe(
      'Writz Signet faucet\nnonce:0123456789abcdef0123456789abcdef\nstellar:GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT\nsignet:tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
    );
  });
});

describe('claim request and key control', () => {
  test.each([
    ['no body', undefined],
    ['missing token', { pollarAccessToken: undefined }],
    ['bad Stellar address', { stellarAddress: 'GSHORT' }],
    ['uncompressed pubkey', { signetPubkey: '04' + 'a'.repeat(128) }],
    ['malformed nonce', { nonce: 'not-a-nonce' }],
    ['malformed signature', { keySig: 'abc' }],
  ])('400 invalid_request: %s', async (_label, patch) => {
    const { faucet, logins } = setup();
    const body = patch === undefined ? undefined : { ...claimBody(faucet, logins, { key: 11 }), ...patch };
    await expect(faucet.claim(body, '1.1.1.1')).rejects.toMatchObject({ code: 'invalid_request', httpStatus: 400 });
    expect(logins.calls).toBe(0);
  });

  test('an unknown nonce is refused', async () => {
    const { faucet, logins } = setup();
    const body = claimBody(faucet, logins, { key: 11 }, { nonce: 'ab'.repeat(16) });
    await expect(faucet.claim(body, '1.1.1.1')).rejects.toMatchObject({ code: 'nonce_invalid', httpStatus: 400 });
    expect(logins.calls).toBe(0);
  });

  test('an expired nonce is refused', async () => {
    const { faucet, logins } = setup();
    const body = claimBody(faucet, logins, { key: 11 });
    t += 5 * 60_000;
    await expect(faucet.claim(body, '1.1.1.1')).rejects.toMatchObject({ code: 'nonce_invalid' });
  });

  test('a nonce is single use, even when its first claim was refused', async () => {
    const { faucet, logins } = setup([500_000], { dailyCap: 10 });
    const ok = claimBody(faucet, logins, { key: 11 });
    await faucet.claim(ok, '1.1.1.1');
    // Replaying the paid request: the nonce is spent.
    await expect(faucet.claim(ok, '1.1.1.1')).rejects.toMatchObject({ code: 'nonce_invalid' });
    // A refused claim spends its nonce too.
    const refused = claimBody(faucet, logins, { key: 12 }, { pollarAccessToken: 'unknown' });
    await expect(faucet.claim(refused, '1.1.1.1')).rejects.toMatchObject({ code: 'login_invalid' });
    const retry = { ...claimBody(faucet, logins, { key: 12 }), nonce: refused.nonce, keySig: refused.keySig };
    await expect(faucet.claim(retry, '1.1.1.1')).rejects.toMatchObject({ code: 'nonce_invalid' });
  });

  test('a signature by another key is refused before Pollar is asked', async () => {
    const { faucet, logins } = setup();
    const body = claimBody(faucet, logins, { key: 11 });
    body.keySig = signBitcoinMessage(faucetClaimMessage(body.nonce, body.stellarAddress, body.signetAddress), priv(12));
    await expect(faucet.claim(body, '1.1.1.1')).rejects.toMatchObject({ code: 'bad_signature', httpStatus: 400 });
    expect(logins.calls).toBe(0);
  });

  test('the signature binds the Stellar address: one signed for another account does not verify', async () => {
    const { faucet, logins } = setup();
    const body = claimBody(faucet, logins, { key: 11 });
    body.keySig = signBitcoinMessage(faucetClaimMessage(body.nonce, stellar(99), body.signetAddress), priv(11));
    await expect(faucet.claim(body, '1.1.1.1')).rejects.toMatchObject({ code: 'bad_signature' });
  });

  test('the Signet address must be the P2WPKH of the key', async () => {
    const { faucet, logins } = setup();
    const body = claimBody(faucet, logins, { key: 11 }, { signetAddress: userAddr(12) });
    await expect(faucet.claim(body, '1.1.1.1')).rejects.toMatchObject({ code: 'address_key_mismatch', httpStatus: 400 });
    const tr = btc.payments.p2tr({ internalPubkey: pubOf(11).subarray(1), network: net }).address!;
    const taproot = claimBody(faucet, logins, { key: 11 }, { signetAddress: tr });
    await expect(faucet.claim(taproot, '1.1.1.1')).rejects.toMatchObject({ code: 'address_key_mismatch' });
  });

  test('a mainnet address is refused', async () => {
    const { faucet, logins } = setup();
    const body = claimBody(faucet, logins, { key: 11 }, { signetAddress: pubkeyToP2WPKHAddress(pubOf(11), btc.networks.bitcoin) });
    await expect(faucet.claim(body, '1.1.1.1')).rejects.toMatchObject({ code: 'invalid_address' });
  });

  test("refuses the faucet's own address", async () => {
    const { faucet, logins } = setup();
    const nonce = faucet.issueNonce().nonce;
    const body = { ...claimBody(faucet, logins, { key: 7 }), nonce };
    body.keySig = signBitcoinMessage(faucetClaimMessage(nonce, body.stellarAddress, FAUCET_ADDR), FAUCET_PRIV);
    await expect(faucet.claim(body, '1.1.1.1')).rejects.toMatchObject({ code: 'faucet_address' });
  });
});

describe('one claim per account, Stellar address and Signet address', () => {
  test('pays the fixed amount to the Signet address, with change back to the faucet, and records the hashed account', async () => {
    const { esplora, store, faucet, logins } = setup();
    const r = await faucet.claim(claimBody(faucet, logins, { key: 11 }), '1.2.3.4');

    const tx = btc.Transaction.fromHex(esplora.broadcasts[0]);
    expect(r.txid).toBe(tx.getId());
    expect(tx.outs[0].value).toBe(20_000);
    expect(tx.outs[0].script.equals(btc.address.toOutputScript(USER, net))).toBe(true);
    expect(tx.outs[1].script.equals(btc.address.toOutputScript(FAUCET_ADDR, net))).toBe(true);
    expect(tx.outs[1].value).toBe(100_000 - 20_000 - r.feeSats);
    // Esplora's 3-block estimate (1.2) is below the floor, so the floor (2) applies.
    expect(r.feeSats / tx.virtualSize()).toBeGreaterThanOrEqual(2);
    expect(r.feeSats / tx.virtualSize()).toBeLessThan(2.2);
    expect(store.claims).toHaveLength(1);
    expect(store.claims[0]).toMatchObject({ address: USER, stellarAddress: stellar(11), userKey: userKeyFor('user-11') });
    expect(store.claims[0].userKey).not.toContain('user-11');
    expect(store.claims[0].ipHash).not.toContain('1.2.3.4');
  });

  test('caps the fee rate at the ceiling', async () => {
    const { esplora, faucet, logins } = setup();
    esplora.fees = { '3': 500 };
    const r = await faucet.claim(claimBody(faucet, logins, { key: 11 }), '1.2.3.4');
    expect(r.feeSats / btc.Transaction.fromHex(esplora.broadcasts[0]).virtualSize()).toBeLessThan(26);
  });

  test('a reused Pollar account is refused, with any other Stellar or Signet address, at any time', async () => {
    const { faucet, logins } = setup([500_000], { dailyCap: 10 });
    await faucet.claim(claimBody(faucet, logins, { key: 11, user: 'alice' }), '1.1.1.1');
    t += 30 * 86_400_000;
    await expect(faucet.claim(claimBody(faucet, logins, { key: 12, stellar: 40, user: 'alice' }), '2.2.2.2')).rejects.toMatchObject({
      code: 'account_already_claimed',
      httpStatus: 409,
    });
  });

  test('a reused Stellar address is refused, under any account', async () => {
    const { faucet, logins } = setup([500_000], { dailyCap: 10 });
    await faucet.claim(claimBody(faucet, logins, { key: 11, stellar: 40, user: 'alice' }), '1.1.1.1');
    const second = claimBody(faucet, logins, { key: 12, stellar: 40, user: 'bob' });
    await expect(faucet.claim(second, '2.2.2.2')).rejects.toMatchObject({ code: 'stellar_address_already_claimed', httpStatus: 409 });
    // Refused before Pollar is asked: a Stellar address is public, so no login is needed to know it claimed.
    expect(logins.calls).toBe(1);
  });

  test('a reused Signet address is refused, under any account', async () => {
    const { faucet, logins } = setup([500_000], { dailyCap: 10 });
    await faucet.claim(claimBody(faucet, logins, { key: 11, stellar: 40, user: 'alice' }), '1.1.1.1');
    const second = claimBody(faucet, logins, { key: 11, stellar: 41, user: 'bob' });
    await expect(faucet.claim(second, '2.2.2.2')).rejects.toMatchObject({ code: 'signet_address_already_claimed', httpStatus: 409 });
  });

  test('a Signet address paid before claims needed a login is refused too', async () => {
    const { faucet, logins, store } = setup([500_000], { dailyCap: 10 });
    store.claims.push({ address: USER, ipHash: 'old', userKey: '', stellarAddress: '', txid: 'f'.repeat(64), amountSat: 20_000, createdAt: t - 86_400_000 });
    await expect(faucet.claim(claimBody(faucet, logins, { key: 11 }), '1.1.1.1')).rejects.toMatchObject({ code: 'signet_address_already_claimed' });
  });

  test('two concurrent claims by one account pay once', async () => {
    const { esplora, faucet, logins } = setup([500_000], { dailyCap: 10 });
    const results = await Promise.allSettled([
      faucet.claim(claimBody(faucet, logins, { key: 11, stellar: 40, user: 'alice' }), '1.1.1.1'),
      faucet.claim(claimBody(faucet, logins, { key: 12, stellar: 41, user: 'alice' }), '2.2.2.2'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'account_already_claimed' } });
    expect(esplora.broadcasts).toHaveLength(1);
  });

  test('a refused login pays nothing and records nothing', async () => {
    const { esplora, store, faucet, logins } = setup();
    const body = claimBody(faucet, logins, { key: 11 }, { pollarAccessToken: 'forged' });
    await expect(faucet.claim(body, '1.1.1.1')).rejects.toMatchObject({ code: 'login_invalid', httpStatus: 401 });
    expect(esplora.broadcasts).toHaveLength(0);
    expect(store.claims).toHaveLength(0);
  });
});

describe('per-IP allowance, daily cap and payment', () => {
  test('N claims per IP per window; claim N+1 waits for the oldest to leave', async () => {
    const { faucet, logins } = setup([500_000], { dailyCap: 100, ipClaimsPerWindow: 3 });
    for (let i = 0; i < 3; i++) {
      await expect(faucet.claim(claimBody(faucet, logins, { key: 60 + i }), '1.1.1.1')).resolves.toBeDefined();
      t += 10 * 60_000;
    }
    // 30 minutes in: the first claim leaves the window 60 minutes after it was made.
    await expect(faucet.claim(claimBody(faucet, logins, { key: 63 }), '1.1.1.1')).rejects.toMatchObject({
      code: 'ip_cooldown', httpStatus: 429, retryAfterSeconds: 30 * 60,
    });
    // Another IP is not affected.
    await expect(faucet.claim(claimBody(faucet, logins, { key: 64 }), '2.2.2.2')).resolves.toBeDefined();
  });

  test('the per-IP window slides: each slot frees one window after its claim', async () => {
    const { faucet, logins } = setup([500_000], { dailyCap: 100, ipClaimsPerWindow: 3 });
    const start = t;
    for (let i = 0; i < 3; i++) {
      await faucet.claim(claimBody(faucet, logins, { key: 70 + i }), '1.1.1.1');
      t += 10 * 60_000;
    }
    t = start + 3_600_000 - 1;
    await expect(faucet.claim(claimBody(faucet, logins, { key: 73 }), '1.1.1.1')).rejects.toMatchObject({ code: 'ip_cooldown', retryAfterSeconds: 1 });
    t = start + 3_600_000;
    await expect(faucet.claim(claimBody(faucet, logins, { key: 73 }), '1.1.1.1')).resolves.toBeDefined();
    await expect(faucet.claim(claimBody(faucet, logins, { key: 74 }), '1.1.1.1')).rejects.toMatchObject({ code: 'ip_cooldown', retryAfterSeconds: 10 * 60 });
  });

  test('global daily cap, reset at 00:00 UTC', async () => {
    const { faucet, logins } = setup([500_000]);
    for (let i = 0; i < 3; i++) await faucet.claim(claimBody(faucet, logins, { key: 20 + i }), `9.9.9.${i}`);
    await expect(faucet.claim(claimBody(faucet, logins, { key: 30 }), '8.8.8.8')).rejects.toMatchObject({ code: 'daily_cap_reached', retryAfterSeconds: 12 * 3600 });
    t = Date.UTC(2026, 9, 25, 0, 0, 1);
    await expect(faucet.claim(claimBody(faucet, logins, { key: 30 }), '8.8.8.8')).resolves.toBeDefined();
  });

  test('faucet_empty when the balance does not cover amount plus fee, and nothing is recorded', async () => {
    const { esplora, store, faucet, logins } = setup([20_100]);
    await expect(faucet.claim(claimBody(faucet, logins, { key: 11 }), '1.1.1.1')).rejects.toMatchObject({ code: 'faucet_empty', httpStatus: 503 });
    expect(esplora.broadcasts).toHaveLength(0);
    expect(store.claims).toHaveLength(0);
  });

  test('concurrent claims never spend the same outpoint', async () => {
    const { esplora, faucet, logins } = setup([30_000, 30_000, 30_000], { dailyCap: 10 });
    esplora.listLag = true; // Esplora still lists spent outputs: only the local reservations prevent reuse.
    const results = await Promise.allSettled([1, 2, 3, 4].map((n) => faucet.claim(claimBody(faucet, logins, { key: 40 + n }), `7.7.7.${n}`)));
    const spent = esplora.broadcasts.flatMap((hex) =>
      btc.Transaction.fromHex(hex).ins.map((i) => `${Buffer.from(i.hash).reverse().toString('hex')}:${i.index}`));
    expect(new Set(spent).size).toBe(spent.length);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    // Three claims use the three funded UTXOs; the fourth can only be paid from
    // their unlisted change, which the faucet tracks itself.
    const fourth = btc.Transaction.fromHex(esplora.broadcasts[3]);
    const earlier = new Set(esplora.broadcasts.slice(0, 3).map((h) => btc.Transaction.fromHex(h).getId()));
    expect(fourth.ins.every((i) => earlier.has(Buffer.from(i.hash).reverse().toString('hex')))).toBe(true);
    // A fifth has nothing left that covers amount plus fee and fails closed.
    await expect(faucet.claim(claimBody(faucet, logins, { key: 50 }), '7.7.7.9')).rejects.toMatchObject({ code: 'faucet_empty' });
  });

  test('spends its own unconfirmed change before Esplora lists it', async () => {
    const { esplora, faucet, logins } = setup([100_000], { dailyCap: 10 });
    esplora.listLag = true;
    await faucet.claim(claimBody(faucet, logins, { key: 11 }), '1.1.1.1');
    await faucet.claim(claimBody(faucet, logins, { key: 12 }), '2.2.2.2');
    const second = btc.Transaction.fromHex(esplora.broadcasts[1]);
    expect(Buffer.from(second.ins[0].hash).reverse().toString('hex')).toBe(btc.Transaction.fromHex(esplora.broadcasts[0]).getId());
    expect(second.ins[0].index).toBe(1);
  });

  test('a rejected broadcast is reported and not recorded, so the user can retry', async () => {
    const { esplora, store, faucet, logins } = setup();
    esplora.failBroadcast = new EsploraError(400, 'https://x/tx', 'sendrawtransaction RPC error: bad-txns');
    await expect(faucet.claim(claimBody(faucet, logins, { key: 11 }), '1.1.1.1')).rejects.toMatchObject({ code: 'broadcast_rejected', httpStatus: 502 });
    expect(store.claims).toHaveLength(0);
    esplora.failBroadcast = undefined;
    await expect(faucet.claim(claimBody(faucet, logins, { key: 11 }), '1.1.1.1')).resolves.toBeDefined();
  });

  test('an unavailable Esplora answers upstream_unavailable', async () => {
    const { esplora, faucet, logins } = setup();
    esplora.failUtxos = new EsploraError(503, 'https://x/address', 'down');
    await expect(faucet.claim(claimBody(faucet, logins, { key: 11 }), '1.1.1.1')).rejects.toMatchObject({ code: 'upstream_unavailable', httpStatus: 503 });
  });

  test('refuses an amount above the 50,000 sat ceiling', () => {
    expect(() => setup([100_000], { amountSat: 60_000 })).toThrow(/FAUCET_AMOUNT_SATS/);
  });

  test('refuses a per-IP allowance or window that is not positive', () => {
    expect(() => setup([100_000], { ipClaimsPerWindow: 0 })).toThrow(/FAUCET_IP_CLAIMS_PER_WINDOW/);
    expect(() => setup([100_000], { ipClaimsPerWindow: 1.5 })).toThrow(/FAUCET_IP_CLAIMS_PER_WINDOW/);
    expect(() => setup([100_000], { ipWindowMs: 0 })).toThrow(/FAUCET_IP_WINDOW_HOURS/);
  });
});

/** Pollar's Server API, answering like POST /v3/tokens/verify. */
function pollarApi(answer: (token: string) => { status: number; body: unknown }) {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetchMock = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const parsed = JSON.parse(String(init?.body)) as { token: string };
    calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body: parsed });
    const { status, body } = answer(parsed.token);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
  return { fetchMock: fetchMock as unknown as typeof fetch, calls };
}

const APP_ID = 'cmwritztestnetapp';
const verified = (over: Record<string, unknown> = {}) => ({
  status: 200,
  body: {
    success: true,
    code: 'SERVER_TOKEN_VERIFIED',
    content: {
      userId: 'pollar-user-1',
      applicationId: APP_ID,
      expiresAt: 1_800_000_000,
      network: 'testnet',
      wallet: { type: 'internal', address: stellar(11) },
      profile: { email: 'someone@example.com', firstName: null, lastName: null, avatar: null },
      authProvider: 'google',
      ...over,
    },
  },
});
const pollarError = (status: number, code: string) => ({ status, body: { success: false, code } });

describe('Pollar login check (Server API mocked)', () => {
  const verifier = (answer: Parameters<typeof pollarApi>[0], allowEmail = false) => {
    const api = pollarApi(answer);
    return {
      ...api,
      v: createPollarVerifier({
        secretKey: 'sec_testnet_secret',
        applicationId: APP_ID,
        apiUrl: 'https://pollar.test/v3/',
        fetch: api.fetchMock,
        allowEmail,
        log: () => {},
      }),
    };
  };

  test('calls POST /tokens/verify with the secret key header and the token, and keeps only a hash of the user id', async () => {
    const { v, calls } = verifier(() => verified());
    const login = await v.verify('the-token', stellar(11));
    expect(calls).toEqual([
      { url: 'https://pollar.test/v3/tokens/verify', headers: expect.objectContaining({ 'x-pollar-api-key': 'sec_testnet_secret' }), body: { token: 'the-token' } },
    ]);
    expect(login).toEqual({ userKey: userKeyFor('pollar-user-1'), stellarAddress: stellar(11) });
    expect(JSON.stringify(login)).not.toMatch(/pollar-user-1|someone@example.com/);
  });

  test.each([
    ['an expired token', pollarError(401, 'SDK_AUTH_TOKEN_EXPIRED'), 'login_expired', 401],
    ['an invalid token', pollarError(401, 'SDK_AUTH_INVALID_TOKEN'), 'login_invalid', 401],
    ["another application's token", pollarError(403, 'SDK_TOKEN_WRONG_APPLICATION'), 'login_wrong_app', 403],
    ['a different application id', verified({ applicationId: 'cmsomeoneelse' }), 'login_wrong_app', 403],
    ['a mainnet login', verified({ network: 'mainnet' }), 'login_wrong_network', 403],
    ['a connected (external) wallet', verified({ wallet: { type: 'external', address: stellar(11) } }), 'login_not_social', 403],
    ['a passkey smart account', verified({ wallet: { type: 'smart', address: 'C'.padEnd(56, 'A') } }), 'login_not_social', 403],
    ['no wallet', verified({ wallet: null }), 'login_not_social', 403],
    ["another user's Stellar address", verified({ wallet: { type: 'internal', address: stellar(12) } }), 'login_address_mismatch', 403],
    ['an email one-time-code login', verified({ authProvider: 'email' }), 'login_provider_not_allowed', 403],
    ['our key rejected by Pollar', pollarError(404, 'API_KEY_NOT_FOUND'), 'login_check_unavailable', 503],
    ['our key expired', pollarError(401, 'API_KEY_EXPIRED'), 'login_check_unavailable', 503],
    ['a Pollar outage', pollarError(502, 'INTERNAL'), 'login_check_unavailable', 503],
    ['an unexpected 200 body', { status: 200, body: { success: true, code: 'SOMETHING_ELSE' } }, 'login_check_unavailable', 503],
  ])('refuses %s', async (_label, answer, code, httpStatus) => {
    const { v } = verifier(() => answer);
    await expect(v.verify('tok', stellar(11))).rejects.toMatchObject({ code, httpStatus });
  });

  test('email logins claim only when FAUCET_ALLOW_EMAIL is on', async () => {
    const { v } = verifier(() => verified({ authProvider: 'email' }), true);
    await expect(v.verify('tok', stellar(11))).resolves.toMatchObject({ stellarAddress: stellar(11) });
  });

  test('an unreachable Pollar answers login_check_unavailable', async () => {
    const v = createPollarVerifier({
      secretKey: 'sec_testnet_secret',
      applicationId: APP_ID,
      fetch: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch,
      log: () => {},
    });
    await expect(v.verify('tok', stellar(11))).rejects.toMatchObject({ code: 'login_check_unavailable', httpStatus: 503 });
  });
});

describe('HTTP routes', () => {
  /** A faucet wired to the real Pollar client, with Pollar's API mocked. */
  function liveSetup(values = [100_000], settings: Partial<FaucetSettings> = {}) {
    const api = pollarApi((token) => (token === 'good-token' ? verified() : pollarError(401, 'SDK_AUTH_INVALID_TOKEN')));
    const verifier = createPollarVerifier({ secretKey: 'sec_testnet_secret', applicationId: APP_ID, fetch: api.fetchMock, log: () => {} });
    return { ...setup(values, settings, verifier), api };
  }

  async function signedBody(app: express.Express, key = 11, token = 'good-token') {
    const n = await request(app).get('/faucet/signet/nonce');
    expect(n.status).toBe(200);
    const nonce = n.body.nonce as string;
    const stellarAddress = stellar(11);
    const signetAddress = userAddr(key);
    return {
      pollarAccessToken: token,
      stellarAddress,
      signetAddress,
      signetPubkey: pubOf(key).toString('hex'),
      nonce,
      keySig: signBitcoinMessage(faucetClaimMessage(nonce, stellarAddress, signetAddress), priv(key)),
    };
  }

  test('nonce, then POST: pays and returns the txid and an explorer link', async () => {
    const { faucet } = liveSetup();
    const app = appFor(faucet);
    const n = await request(app).get('/faucet/signet/nonce');
    expect(n.body.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(Date.parse(n.body.expiresAt) - t).toBe(5 * 60_000);
    const res = await request(app).post('/faucet/signet').send(await signedBody(app));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ address: USER, amountSats: 20_000 });
    expect(res.body.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.explorerUrl).toBe(`https://mempool.space/signet/tx/${res.body.txid}`);
  });

  test('the old open request ({ address }) is refused', async () => {
    const { faucet, esplora } = liveSetup();
    const res = await request(appFor(faucet)).post('/faucet/signet').send({ address: USER });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(esplora.broadcasts).toHaveLength(0);
  });

  test('401 for a token Pollar does not recognise', async () => {
    const { faucet, esplora } = liveSetup();
    const app = appFor(faucet);
    const res = await request(app).post('/faucet/signet').send(await signedBody(app, 11, 'forged-token'));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('login_invalid');
    expect(esplora.broadcasts).toHaveLength(0);
  });

  test('409 for a second claim by the same account', async () => {
    const { faucet } = liveSetup([500_000]);
    const app = appFor(faucet);
    await request(app).post('/faucet/signet').send(await signedBody(app, 11));
    const res = await request(app).post('/faucet/signet').send(await signedBody(app, 12));
    expect(res.status).toBe(409);
  });

  test('429 with Retry-After on the per-IP allowance; the IP comes from the trusted hop, not a spoofed header', async () => {
    const { faucet, logins } = setup([100_000], { ipClaimsPerWindow: 1 });
    const app = appFor(faucet);
    await request(app).post('/faucet/signet').set('X-Forwarded-For', '5.5.5.5').send(claimBody(faucet, logins, { key: 11 }));
    // A different left-most entry does not give the caller a new IP bucket.
    const res = await request(app).post('/faucet/signet').set('X-Forwarded-For', '6.6.6.6, 5.5.5.5').send(claimBody(faucet, logins, { key: 12 }));
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('ip_cooldown');
    expect(res.headers['retry-after']).toBe('3600');
    expect(res.body.retryAfterSeconds).toBe(3600);
  });

  test('burst limit on attempts', async () => {
    const { faucet } = setup();
    const app = appFor(faucet, 2);
    await request(app).post('/faucet/signet').send({});
    await request(app).post('/faucet/signet').send({});
    const res = await request(app).post('/faucet/signet').send({});
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('rate_limited');
  });

  test('503 faucet_empty lists public faucets', async () => {
    const { faucet, logins } = setup([5_000]);
    const res = await request(appFor(faucet)).post('/faucet/signet').send(claimBody(faucet, logins, { key: 11 }));
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('faucet_empty');
    expect(res.body.publicFaucets.length).toBeGreaterThan(0);
  });

  test('without a Pollar key the faucet is off: claim and nonce answer 503 with the reason, never open mode', async () => {
    const reason = 'claims require a Writz testnet app social login, and this relayer has no Pollar server key or application id configured';
    const app = appFor(undefined, 100, reason);
    const post = await request(app).post('/faucet/signet').send({ address: USER });
    expect(post.status).toBe(503);
    expect(post.body).toMatchObject({ error: 'faucet_disabled', reason });
    const nonce = await request(app).get('/faucet/signet/nonce');
    expect(nonce.status).toBe(503);
    const get = await request(app).get('/faucet/signet');
    expect(get.status).toBe(200);
    expect(get.body).toMatchObject({ enabled: false, access: 'testnet_app_social_login', reason });
    expect(get.body.message).toMatch(/social login/);
  });

  test('GET /faucet/signet says who can claim and exposes no balance, per-IP or claim details', async () => {
    const { faucet, logins } = setup([100_000, 50_000]);
    const app = appFor(faucet);
    await request(app).post('/faucet/signet').send(claimBody(faucet, logins, { key: 11 }));
    const res = await request(app).get('/faucet/signet');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      enabled: true,
      network: 'signet',
      access: 'testnet_app_social_login',
      message: expect.stringMatching(/social login/),
      address: FAUCET_ADDR,
      amountSats: 20_000,
      dailyCap: 3,
      remainingToday: 2,
      resetsAt: '2026-10-25T00:00:00.000Z',
      funded: true,
      publicFaucets: expect.any(Array),
    });
  });
});
