/**
 * Signet faucet: address validation, payment construction, the address
 * cooldown, the per-IP allowance, the daily cap, the balance check, serialized sends and the HTTP surface.
 * Esplora is a mock; signing is real (@writz/bitcoin-script), so every paid
 * transaction is decoded and checked.
 */
import express from 'express';
import request from 'supertest';
import * as btc from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { keyPairFromPrivkey, pubkeyToP2WPKHAddress } from '@writz/bitcoin-script';
import { EsploraError, type AddressUtxo } from '../src/bitcoin/esplora.js';
import {
  SignetFaucet,
  FaucetError,
  normalizeSignetAddress,
  type FaucetEsplora,
  type FaucetSettings,
} from '../src/faucet/service.js';
import { MemoryClaimStore } from '../src/faucet/store.js';
import { createFaucetRouter } from '../src/routes/faucet.js';

btc.initEccLib(ecc);
const net = btc.networks.testnet;
const wallet = keyPairFromPrivkey(Buffer.alloc(32, 7), net);
const FAUCET_ADDR = pubkeyToP2WPKHAddress(wallet.publicKey, net);
const userAddr = (n: number) => pubkeyToP2WPKHAddress(keyPairFromPrivkey(Buffer.alloc(32, n), net).publicKey, net);
const USER = userAddr(11);
const USER_2 = userAddr(12);

const SETTINGS: FaucetSettings = {
  amountSat: 20_000,
  dailyCap: 3,
  cooldownMs: 24 * 3_600_000,
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

let t: number;
function setup(values = [100_000], settings: Partial<FaucetSettings> = {}) {
  const esplora = new FakeEsplora(values);
  const store = new MemoryClaimStore();
  const faucet = new SignetFaucet({
    wallet, esplora, store, settings: { ...SETTINGS, ...settings }, now: () => t, log: () => {},
  });
  return { esplora, store, faucet };
}

function appFor(faucet: SignetFaucet | undefined, rateLimit = 100) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/faucet', createFaucetRouter({ faucet, disabledReason: 'no faucet key is configured', rateLimit, rateWindowMs: 60_000, now: () => t }));
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

describe('SignetFaucet.claim', () => {
  test('pays the fixed amount to the address with change back to the faucet', async () => {
    const { esplora, store, faucet } = setup();
    const r = await faucet.claim(USER, '1.2.3.4');

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
    expect(store.claims[0].ipHash).not.toContain('1.2.3.4');
  });

  test('caps the fee rate at the ceiling', async () => {
    const { esplora, faucet } = setup();
    esplora.fees = { '3': 500 };
    const r = await faucet.claim(USER, '1.2.3.4');
    expect(r.feeSats / btc.Transaction.fromHex(esplora.broadcasts[0]).virtualSize()).toBeLessThan(26);
  });

  test('one claim per address per cooldown, from any IP', async () => {
    const { faucet } = setup();
    await faucet.claim(USER, '1.1.1.1');
    await expect(faucet.claim(USER, '2.2.2.2')).rejects.toMatchObject({ code: 'address_cooldown', httpStatus: 429, retryAfterSeconds: 86_400 });
    t += 24 * 3_600_000;
    await expect(faucet.claim(USER, '2.2.2.2')).resolves.toMatchObject({ amountSats: 20_000 });
  });

  test('N claims per IP per window to different addresses; claim N+1 waits for the oldest to leave', async () => {
    const { faucet } = setup([500_000], { dailyCap: 100, ipClaimsPerWindow: 3 });
    for (let i = 0; i < 3; i++) {
      await expect(faucet.claim(userAddr(60 + i), '1.1.1.1')).resolves.toBeDefined();
      t += 10 * 60_000;
    }
    // 30 minutes in: the first claim leaves the window 60 minutes after it was made.
    await expect(faucet.claim(userAddr(63), '1.1.1.1')).rejects.toMatchObject({
      code: 'ip_cooldown', httpStatus: 429, retryAfterSeconds: 30 * 60,
    });
    // Another IP is not affected.
    await expect(faucet.claim(userAddr(64), '2.2.2.2')).resolves.toBeDefined();
  });

  test('the per-IP window slides: each slot frees one window after its claim', async () => {
    const { faucet } = setup([500_000], { dailyCap: 100, ipClaimsPerWindow: 3 });
    const start = t;
    for (let i = 0; i < 3; i++) {
      await faucet.claim(userAddr(70 + i), '1.1.1.1');
      t += 10 * 60_000;
    }
    t = start + 3_600_000 - 1;
    await expect(faucet.claim(userAddr(73), '1.1.1.1')).rejects.toMatchObject({ code: 'ip_cooldown', retryAfterSeconds: 1 });
    t = start + 3_600_000;
    await expect(faucet.claim(userAddr(73), '1.1.1.1')).resolves.toBeDefined();
    // The window is full again; the next slot is the claim made at start + 10 min.
    await expect(faucet.claim(userAddr(74), '1.1.1.1')).rejects.toMatchObject({ code: 'ip_cooldown', retryAfterSeconds: 10 * 60 });
    t = start + 3_600_000 + 10 * 60_000;
    await expect(faucet.claim(userAddr(74), '1.1.1.1')).resolves.toBeDefined();
  });

  test('a refused claim does not use the per-IP allowance', async () => {
    const { faucet } = setup([500_000], { dailyCap: 100, ipClaimsPerWindow: 2 });
    await faucet.claim(USER, '1.1.1.1');
    await expect(faucet.claim(USER, '1.1.1.1')).rejects.toMatchObject({ code: 'address_cooldown' });
    await expect(faucet.claim('nope', '1.1.1.1')).rejects.toMatchObject({ code: 'invalid_address' });
    await expect(faucet.claim(USER_2, '1.1.1.1')).resolves.toBeDefined();
  });

  test('the address cooldown is independent of the per-IP window', async () => {
    const { faucet } = setup([500_000], { dailyCap: 100, ipClaimsPerWindow: 2 });
    await faucet.claim(USER, '1.1.1.1');
    // Two hours later the IP window is empty, but the address still waits out its 24 hours.
    t += 2 * 3_600_000;
    await expect(faucet.claim(USER, '1.1.1.1')).rejects.toMatchObject({ code: 'address_cooldown', retryAfterSeconds: 22 * 3600 });
    await expect(faucet.claim(USER, '3.3.3.3')).rejects.toMatchObject({ code: 'address_cooldown' });
    // And an IP that used its allowance does not hold back an address from elsewhere.
    await faucet.claim(userAddr(80), '4.4.4.4');
    await faucet.claim(userAddr(81), '4.4.4.4');
    await expect(faucet.claim(userAddr(82), '4.4.4.4')).rejects.toMatchObject({ code: 'ip_cooldown' });
    await expect(faucet.claim(userAddr(82), '5.5.5.5')).resolves.toBeDefined();
  });

  test('global daily cap, reset at 00:00 UTC', async () => {
    const { faucet } = setup([500_000]);
    for (let i = 0; i < 3; i++) await faucet.claim(userAddr(20 + i), `9.9.9.${i}`);
    await expect(faucet.claim(userAddr(30), '8.8.8.8')).rejects.toMatchObject({ code: 'daily_cap_reached', retryAfterSeconds: 12 * 3600 });
    t = Date.UTC(2026, 9, 25, 0, 0, 1);
    await expect(faucet.claim(userAddr(30), '8.8.8.8')).resolves.toBeDefined();
  });

  test('faucet_empty when the balance does not cover amount plus fee, and nothing is recorded', async () => {
    const { esplora, store, faucet } = setup([20_100]);
    await expect(faucet.claim(USER, '1.1.1.1')).rejects.toMatchObject({ code: 'faucet_empty', httpStatus: 503 });
    expect(esplora.broadcasts).toHaveLength(0);
    expect(store.claims).toHaveLength(0);
  });

  test('refuses its own address', async () => {
    const { faucet } = setup();
    await expect(faucet.claim(FAUCET_ADDR, '1.1.1.1')).rejects.toMatchObject({ code: 'faucet_address' });
  });

  test('concurrent claims never spend the same outpoint', async () => {
    const { esplora, faucet } = setup([30_000, 30_000, 30_000], { dailyCap: 10 });
    esplora.listLag = true; // Esplora still lists spent outputs: only the local reservations prevent reuse.
    const results = await Promise.allSettled([1, 2, 3, 4].map((n) => faucet.claim(userAddr(40 + n), `7.7.7.${n}`)));
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
    // A fifth has nothing left that covers amount plus fee and fails closed.
    await expect(faucet.claim(userAddr(50), '7.7.7.9')).rejects.toMatchObject({ code: 'faucet_empty' });
  });

  test('spends its own unconfirmed change before Esplora lists it', async () => {
    const { esplora, faucet } = setup([100_000], { dailyCap: 10 });
    esplora.listLag = true;
    await faucet.claim(USER, '1.1.1.1');
    await faucet.claim(USER_2, '2.2.2.2');
    const second = btc.Transaction.fromHex(esplora.broadcasts[1]);
    expect(Buffer.from(second.ins[0].hash).reverse().toString('hex')).toBe(btc.Transaction.fromHex(esplora.broadcasts[0]).getId());
    expect(second.ins[0].index).toBe(1);
  });

  test('a rejected broadcast is reported and not recorded', async () => {
    const { esplora, store, faucet } = setup();
    esplora.failBroadcast = new EsploraError(400, 'https://x/tx', 'sendrawtransaction RPC error: bad-txns');
    await expect(faucet.claim(USER, '1.1.1.1')).rejects.toMatchObject({ code: 'broadcast_rejected', httpStatus: 502 });
    expect(store.claims).toHaveLength(0);
  });

  test('an unavailable Esplora answers upstream_unavailable', async () => {
    const { esplora, faucet } = setup();
    esplora.failUtxos = new EsploraError(503, 'https://x/address', 'down');
    await expect(faucet.claim(USER, '1.1.1.1')).rejects.toMatchObject({ code: 'upstream_unavailable', httpStatus: 503 });
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

describe('HTTP routes', () => {
  test('POST /faucet/signet returns the txid and an explorer link', async () => {
    const { faucet } = setup();
    const res = await request(appFor(faucet)).post('/faucet/signet').send({ address: USER });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ address: USER, amountSats: 20_000 });
    expect(res.body.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.explorerUrl).toBe(`https://mempool.space/signet/tx/${res.body.txid}`);
  });

  test('400 for a mainnet address', async () => {
    const { faucet } = setup();
    const res = await request(appFor(faucet)).post('/faucet/signet').send({ address: pubkeyToP2WPKHAddress(wallet.publicKey, btc.networks.bitcoin) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_address');
  });

  test('429 with Retry-After on the per-IP allowance; the IP comes from the trusted hop, not a spoofed header', async () => {
    const { faucet } = setup([100_000], { ipClaimsPerWindow: 1 });
    const app = appFor(faucet);
    await request(app).post('/faucet/signet').set('X-Forwarded-For', '5.5.5.5').send({ address: USER });
    // A different left-most entry does not give the caller a new IP bucket.
    const res = await request(app).post('/faucet/signet').set('X-Forwarded-For', '6.6.6.6, 5.5.5.5').send({ address: USER_2 });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('ip_cooldown');
    expect(res.headers['retry-after']).toBe('3600');
    expect(res.body.retryAfterSeconds).toBe(3600);
  });

  test('burst limit on attempts', async () => {
    const { faucet } = setup();
    const app = appFor(faucet, 2);
    await request(app).post('/faucet/signet').send({ address: 'nope' });
    await request(app).post('/faucet/signet').send({ address: 'nope' });
    const res = await request(app).post('/faucet/signet').send({ address: 'nope' });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('rate_limited');
  });

  test('503 faucet_empty lists public faucets', async () => {
    const { faucet } = setup([5_000]);
    const res = await request(appFor(faucet)).post('/faucet/signet').send({ address: USER });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('faucet_empty');
    expect(res.body.publicFaucets.length).toBeGreaterThan(0);
  });

  test('503 faucet_disabled without a key, and GET reports it', async () => {
    const app = appFor(undefined);
    const post = await request(app).post('/faucet/signet').send({ address: USER });
    expect(post.status).toBe(503);
    expect(post.body.error).toBe('faucet_disabled');
    const get = await request(app).get('/faucet/signet');
    expect(get.status).toBe(200);
    expect(get.body).toMatchObject({ enabled: false, reason: 'no faucet key is configured' });
  });

  test('GET /faucet/signet reports amount, daily cap left, per-IP allowance, address and balance', async () => {
    const { faucet } = setup([100_000, 50_000]);
    const app = appFor(faucet);
    await request(app).post('/faucet/signet').send({ address: USER });
    const res = await request(app).get('/faucet/signet');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enabled: true,
      network: 'signet',
      address: FAUCET_ADDR,
      amountSats: 20_000,
      dailyCap: 3,
      claimsToday: 1,
      remainingToday: 2,
      cooldownHours: 24,
      ipClaimsPerWindow: 20,
      ipWindowHours: 1,
      resetsAt: '2026-10-25T00:00:00.000Z',
    });
    expect(res.body.balanceSats).toBeGreaterThan(100_000);
    expect(res.body.claimsLeftAtBalance).toBeGreaterThanOrEqual(5);
  });
});
