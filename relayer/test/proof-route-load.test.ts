/**
 * GET /spv-proof under load: cache, coalescing, per-IP rate limit, upstream
 * unavailability and the light-client lag check. Dependencies are injected
 * through createProofRouter, so neither Esplora nor Soroban RPC is called.
 */
import express from 'express';
import request from 'supertest';
import { createProofRouter, type ProofRouterDeps } from '../src/routes/proof.js';
import { EsploraError } from '../src/bitcoin/esplora.js';
import { UnconfirmedTxError, InsufficientConfirmationsError, type SPVProofBundle } from '../src/bitcoin/spv.js';
import { TtlCache } from '../src/proof-cache.js';
import { cachedTipReader } from '../src/bitcoin/light-client.js';

const TXID = 'ab'.repeat(32);
const TXID_2 = 'cd'.repeat(32);
const BLOCK = 327_700;

function bundle(overrides: Partial<SPVProofBundle> = {}): SPVProofBundle {
  return {
    txid: TXID,
    rawTxNoWitness: '01'.repeat(80),
    blockHash: 'dd'.repeat(32),
    txIndex: 3,
    merkleProof: ['bb'.repeat(32)],
    headers: ['cc'.repeat(80)],
    blockHeight: BLOCK,
    confirmations: 1,
    bitcoinTipHeight: BLOCK + 9, // 10 deep: cacheable for the long TTL
    ...overrides,
  };
}

let t: number;

function appWith(overrides: Partial<ProofRouterDeps>) {
  const router = createProofRouter({
    lightClientTip: async () => undefined,
    rateLimit: 1_000,
    rateWindowMs: 60_000,
    cacheMaxEntries: 100,
    cacheTtlMs: 3_600_000,
    headerSyncRetryAfterSeconds: 60,
    now: () => t,
    ...overrides,
  });
  const app = express();
  app.set('trust proxy', 1);
  app.use('/spv-proof', router);
  return { app, router };
}

beforeEach(() => {
  t = 1_000_000;
});

describe('proof cache', () => {
  test('serves a deeply confirmed proof from cache, without rebuilding', async () => {
    const build = jest.fn().mockResolvedValue(bundle());
    const { app } = appWith({ build });

    const first = await request(app).get(`/spv-proof/${TXID}?confirmations=1`);
    t += 30 * 60_000; // 30 minutes later, inside the 1 h TTL
    const second = await request(app).get(`/spv-proof/${TXID}?confirmations=1`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(build).toHaveBeenCalledTimes(1);
  });

  test('does not return the internal bitcoinTipHeight field', async () => {
    const { app } = appWith({ build: jest.fn().mockResolvedValue(bundle()) });
    const res = await request(app).get(`/spv-proof/${TXID}?confirmations=1`);
    expect(res.body.bitcoinTipHeight).toBeUndefined();
    expect(res.body.sorobanArgs.min_confirmations).toBe(1);
  });

  test('rebuilds a deep proof once the long TTL expires', async () => {
    const build = jest.fn().mockResolvedValue(bundle());
    const { app } = appWith({ build, cacheTtlMs: 60_000 });

    await request(app).get(`/spv-proof/${TXID}?confirmations=1`);
    t += 60_001;
    await request(app).get(`/spv-proof/${TXID}?confirmations=1`);

    expect(build).toHaveBeenCalledTimes(2);
  });

  test('keeps a shallow proof only briefly (15 s)', async () => {
    const build = jest.fn().mockResolvedValue(bundle({ bitcoinTipHeight: BLOCK + 1 }));
    const { app } = appWith({ build });

    await request(app).get(`/spv-proof/${TXID}?confirmations=1`);
    t += 10_000;
    await request(app).get(`/spv-proof/${TXID}?confirmations=1`);
    expect(build).toHaveBeenCalledTimes(1);
    t += 6_000;
    await request(app).get(`/spv-proof/${TXID}?confirmations=1`);
    expect(build).toHaveBeenCalledTimes(2);
  });

  test('keys by confirmations: a different depth is a different proof', async () => {
    const build = jest.fn().mockResolvedValue(bundle());
    const { app } = appWith({ build });

    await request(app).get(`/spv-proof/${TXID}?confirmations=1`);
    await request(app).get(`/spv-proof/${TXID}?confirmations=2`);

    expect(build).toHaveBeenCalledTimes(2);
  });

  test('treats an uppercase txid as the same entry', async () => {
    const build = jest.fn().mockResolvedValue(bundle());
    const { app } = appWith({ build });

    await request(app).get(`/spv-proof/${TXID}?confirmations=1`);
    await request(app).get(`/spv-proof/${TXID.toUpperCase()}?confirmations=1`);

    expect(build).toHaveBeenCalledTimes(1);
  });

  test('caches "unconfirmed" and "insufficient confirmations" for 15 s only', async () => {
    const build = jest.fn()
      .mockRejectedValueOnce(new UnconfirmedTxError(TXID))
      .mockRejectedValueOnce(new InsufficientConfirmationsError(TXID, 6, 2));
    const { app } = appWith({ build });

    expect((await request(app).get(`/spv-proof/${TXID}`)).body.error).toBe('unconfirmed');
    t += 5_000;
    expect((await request(app).get(`/spv-proof/${TXID}`)).body.error).toBe('unconfirmed');
    t += 11_000;
    const res = await request(app).get(`/spv-proof/${TXID}`);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'insufficient_confirmations', requested: 6, available: 2 });
    expect(build).toHaveBeenCalledTimes(2);
  });

  test('never caches an upstream failure', async () => {
    const build = jest.fn()
      .mockRejectedValueOnce(new Error('unexpected body'))
      .mockResolvedValueOnce(bundle());
    const { app } = appWith({ build });

    expect((await request(app).get(`/spv-proof/${TXID}?confirmations=1`)).status).toBe(502);
    expect((await request(app).get(`/spv-proof/${TXID}?confirmations=1`)).status).toBe(200);
    expect(build).toHaveBeenCalledTimes(2);
  });

  test('coalesces concurrent identical requests into one build', async () => {
    let release!: (b: SPVProofBundle) => void;
    const build = jest.fn().mockImplementation(() => new Promise<SPVProofBundle>((r) => { release = r; }));
    const { app } = appWith({ build });

    const pending = Array.from({ length: 5 }, () =>
      request(app).get(`/spv-proof/${TXID}?confirmations=1`).then((r) => r),
    );
    // Let every request reach the route before the build resolves.
    await new Promise((r) => setTimeout(r, 50));
    release(bundle());
    const responses = await Promise.all(pending);

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(build).toHaveBeenCalledTimes(1);
  });

  test('coalesced callers all see a failure, and the next request retries', async () => {
    let reject!: (e: Error) => void;
    const build = jest.fn()
      .mockImplementationOnce(() => new Promise<SPVProofBundle>((_r, rej) => { reject = rej; }))
      .mockResolvedValueOnce(bundle());
    const { app } = appWith({ build });

    const pending = [1, 2, 3].map(() => request(app).get(`/spv-proof/${TXID}?confirmations=1`).then((r) => r));
    await new Promise((r) => setTimeout(r, 50));
    reject(new EsploraError(503, 'https://example.invalid/tx', ''));
    const responses = await Promise.all(pending);

    expect(responses.map((r) => r.status)).toEqual([503, 503, 503]);
    expect((await request(app).get(`/spv-proof/${TXID}?confirmations=1`)).status).toBe(200);
    expect(build).toHaveBeenCalledTimes(2);
  });
});

describe('TtlCache', () => {
  test('evicts the least recently used entry beyond maxEntries', () => {
    const cache = new TtlCache<number>(2, () => 0);
    cache.set('a', 1, 1_000);
    cache.set('b', 2, 1_000);
    cache.get('a'); // a is now more recent than b
    cache.set('c', 3, 1_000);

    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  test('a zero TTL is not stored', () => {
    const cache = new TtlCache<number>(2, () => 0);
    cache.set('a', 1, 0);
    expect(cache.get('a')).toBeUndefined();
  });
});

describe('per-IP rate limit', () => {
  test('429 with a JSON error and Retry-After once the budget is spent', async () => {
    const { app } = appWith({ build: jest.fn().mockResolvedValue(bundle()), rateLimit: 2, rateWindowMs: 60_000 });

    for (let i = 0; i < 2; i++) {
      expect((await request(app).get(`/spv-proof/${TXID}`).set('X-Forwarded-For', '1.1.1.1')).status).toBe(200);
    }
    const blocked = await request(app).get(`/spv-proof/${TXID}`).set('X-Forwarded-For', '1.1.1.1');

    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBe('60');
    expect(blocked.body).toMatchObject({ error: 'rate_limited', retryAfterSeconds: 60 });
  });

  test('counts invalid requests too, so malformed floods are limited', async () => {
    const { app } = appWith({ build: jest.fn(), rateLimit: 1 });
    await request(app).get('/spv-proof/nothex').set('X-Forwarded-For', '1.1.1.1');
    expect((await request(app).get('/spv-proof/nothex').set('X-Forwarded-For', '1.1.1.1')).status).toBe(429);
  });

  test('separate clients have separate budgets', async () => {
    const { app } = appWith({ build: jest.fn().mockResolvedValue(bundle()), rateLimit: 1 });

    expect((await request(app).get(`/spv-proof/${TXID}`).set('X-Forwarded-For', '1.1.1.1')).status).toBe(200);
    expect((await request(app).get(`/spv-proof/${TXID}`).set('X-Forwarded-For', '2.2.2.2')).status).toBe(200);
    expect((await request(app).get(`/spv-proof/${TXID}`).set('X-Forwarded-For', '1.1.1.1')).status).toBe(429);
  });

  test('a spoofed left-most X-Forwarded-For entry does not open a new budget', async () => {
    const { app } = appWith({ build: jest.fn().mockResolvedValue(bundle()), rateLimit: 1 });

    expect((await request(app).get(`/spv-proof/${TXID}`).set('X-Forwarded-For', '7.7.7.7, 1.1.1.1')).status).toBe(200);
    expect((await request(app).get(`/spv-proof/${TXID}`).set('X-Forwarded-For', '8.8.8.8, 1.1.1.1')).status).toBe(429);
  });

  test('the window resets', async () => {
    const { app } = appWith({ build: jest.fn().mockResolvedValue(bundle()), rateLimit: 1, rateWindowMs: 1_000 });
    await request(app).get(`/spv-proof/${TXID}`);
    expect((await request(app).get(`/spv-proof/${TXID}`)).status).toBe(429);
    t += 1_000;
    expect((await request(app).get(`/spv-proof/${TXID}`)).status).toBe(200);
  });
});

describe('upstream failures', () => {
  test.each([429, 500, 502, 503])('Esplora %i becomes a 503 with Retry-After', async (status) => {
    const build = jest.fn().mockRejectedValue(new EsploraError(status, 'https://example.invalid/x', 'busy'));
    const { app } = appWith({ build });

    const res = await request(app).get(`/spv-proof/${TXID}`);

    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('10');
    expect(res.body).toMatchObject({ error: 'upstream_unavailable', retryAfterSeconds: 10 });
  });

  test('a network error becomes a 503', async () => {
    const build = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    const { app } = appWith({ build });
    expect((await request(app).get(`/spv-proof/${TXID}`)).status).toBe(503);
  });

  test('a txid Esplora does not know is a 404 tx_not_found, cached briefly', async () => {
    const build = jest.fn().mockRejectedValue(new EsploraError(404, `https://example.invalid/tx/${TXID}`, 'Transaction not found'));
    const { app } = appWith({ build });

    const res = await request(app).get(`/spv-proof/${TXID}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tx_not_found');
    await request(app).get(`/spv-proof/${TXID}`);
    expect(build).toHaveBeenCalledTimes(1);
  });

  test('a 404 from another Esplora path stays a 502', async () => {
    const build = jest.fn().mockRejectedValue(new EsploraError(404, `https://example.invalid/tx/${TXID}/merkle-proof`, ''));
    const { app } = appWith({ build });
    expect((await request(app).get(`/spv-proof/${TXID}`)).status).toBe(502);
  });
});

describe('light-client lag', () => {
  test('409 light_client_behind when bitcoin-spv does not hold the block yet', async () => {
    const { app } = appWith({ build: jest.fn().mockResolvedValue(bundle()), lightClientTip: async () => BLOCK - 1 });

    const res = await request(app).get(`/spv-proof/${TXID}?confirmations=1`);

    expect(res.status).toBe(409);
    expect(res.headers['retry-after']).toBe('60');
    expect(res.body).toMatchObject({
      error: 'light_client_behind',
      requested: 1,
      available: 0,
      blockHeight: BLOCK,
      lightClientTipHeight: BLOCK - 1,
      retryAfterSeconds: 60,
    });
  });

  test('409 when the block is stored but not yet deep enough on-chain', async () => {
    const { app } = appWith({
      build: jest.fn().mockResolvedValue(bundle({ confirmations: 6, headers: Array(6).fill('cc'.repeat(80)) })),
      lightClientTip: async () => BLOCK + 3,
    });

    const res = await request(app).get(`/spv-proof/${TXID}?confirmations=6`);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'light_client_behind', requested: 6, available: 4 });
  });

  test('200 once the light client tip covers the requested depth', async () => {
    const { app } = appWith({
      build: jest.fn().mockResolvedValue(bundle({ confirmations: 6 })),
      lightClientTip: async () => BLOCK + 5,
    });
    expect((await request(app).get(`/spv-proof/${TXID}?confirmations=6`)).status).toBe(200);
  });

  test('the check is re-run on cache hits, so a cached proof turns 200 once the sync catches up', async () => {
    let lcTip = BLOCK - 1;
    const build = jest.fn().mockResolvedValue(bundle());
    const { app } = appWith({ build, lightClientTip: async () => lcTip });

    expect((await request(app).get(`/spv-proof/${TXID}?confirmations=1`)).status).toBe(409);
    lcTip = BLOCK;
    expect((await request(app).get(`/spv-proof/${TXID}?confirmations=1`)).status).toBe(200);
    expect(build).toHaveBeenCalledTimes(1);
  });

  test('an unknown light-client tip skips the check', async () => {
    const { app } = appWith({ build: jest.fn().mockResolvedValue(bundle()), lightClientTip: async () => undefined });
    expect((await request(app).get(`/spv-proof/${TXID_2}?confirmations=1`)).status).toBe(200);
  });
});

describe('cachedTipReader', () => {
  test('shares one in-flight read and reuses it for the TTL', async () => {
    let now = 0;
    const read = jest.fn().mockResolvedValue(100);
    const tip = cachedTipReader(read, 5_000, () => now);

    expect(await Promise.all([tip(), tip(), tip()])).toEqual([100, 100, 100]);
    now = 4_999;
    await tip();
    expect(read).toHaveBeenCalledTimes(1);
    now = 5_000;
    await tip();
    expect(read).toHaveBeenCalledTimes(2);
  });

  test('a failed read resolves to undefined', async () => {
    const tip = cachedTipReader(() => Promise.reject(new Error('rpc down')), 5_000);
    await expect(tip()).resolves.toBeUndefined();
  });
});
