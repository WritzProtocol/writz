jest.mock('../src/defindex/client.js', () => ({
  defindexSdk: {
    getVaultAPY: jest.fn(),
    getVaultBalance: jest.fn(),
    depositToVault: jest.fn(),
    withdrawFromVault: jest.fn(),
  },
  defindexNetwork: 'testnet',
}));

import express from 'express';
import request from 'supertest';
import { defindexRouter, vaultReadLimiter, vaultTxLimiter } from '../src/routes/defindex.js';
import { defindexSdk } from '../src/defindex/client.js';
import { config } from '../src/config.js';
import { rateLimit } from '../src/rate-limit.js';
import {
  ALERT_AFTER_CONSECUTIVE_FAILURES,
  recordVaultRequest,
  resetVaultMetrics,
  vaultMetricsSnapshot,
} from '../src/defindex/metrics.js';

const mockGetVaultAPY = defindexSdk.getVaultAPY as jest.Mock;
const mockDepositToVault = defindexSdk.depositToVault as jest.Mock;

const VAULT_ID = 'CBMHGL7GGGHODEDDJ5H2LKJEFHJWBRSQUKOXMC4FKOFDZK5HBKW6PI2S';
const VALID_ADDRESS = 'GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/defindex', defindexRouter);
  return app;
}

let errorSpy: jest.SpyInstance;

beforeEach(() => {
  mockGetVaultAPY.mockReset();
  mockDepositToVault.mockReset();
  config.defindexVaultId = VAULT_ID;
  vaultReadLimiter.reset();
  vaultTxLimiter.reset();
  resetVaultMetrics();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('rateLimit middleware', () => {
  function appWith(limiter: ReturnType<typeof rateLimit>) {
    const app = express();
    app.get('/x', limiter, (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  test('allows up to the limit, then 429s with Retry-After', async () => {
    const t = 1_000_000;
    const app = appWith(rateLimit({ name: 't', limit: 2, windowMs: 60_000, now: () => t }));

    expect((await request(app).get('/x').set('X-Forwarded-For', '1.1.1.1')).status).toBe(200);
    expect((await request(app).get('/x').set('X-Forwarded-For', '1.1.1.1')).status).toBe(200);
    const blocked = await request(app).get('/x').set('X-Forwarded-For', '1.1.1.1');

    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBe('60');
  });

  test('buckets by the first X-Forwarded-For hop', async () => {
    const app = appWith(rateLimit({ name: 't', limit: 1, windowMs: 60_000 }));

    expect((await request(app).get('/x').set('X-Forwarded-For', '1.1.1.1, 10.0.0.1')).status).toBe(200);
    expect((await request(app).get('/x').set('X-Forwarded-For', '2.2.2.2, 10.0.0.1')).status).toBe(200);
    expect((await request(app).get('/x').set('X-Forwarded-For', '1.1.1.1, 10.0.0.2')).status).toBe(429);
  });

  test('a new window opens once the old one expires', async () => {
    let t = 0;
    const app = appWith(rateLimit({ name: 't', limit: 1, windowMs: 1_000, now: () => t }));

    expect((await request(app).get('/x')).status).toBe(200);
    expect((await request(app).get('/x')).status).toBe(429);
    t = 1_000;
    expect((await request(app).get('/x')).status).toBe(200);
  });
});

describe('vault route limits', () => {
  test('tx-building is capped at 10 per minute per client, before DeFindex is called', async () => {
    mockDepositToVault.mockResolvedValue({ xdr: 'AAAA' });
    const app = buildApp();
    const body = { caller: VALID_ADDRESS, amountStroops: '10000000' };

    for (let i = 0; i < 10; i++) {
      const res = await request(app).post('/defindex/deposit').set('X-Forwarded-For', '3.3.3.3').send(body);
      expect(res.status).toBe(200);
    }
    const blocked = await request(app).post('/defindex/withdraw').set('X-Forwarded-For', '3.3.3.3').send(body);

    expect(blocked.status).toBe(429);
    expect(mockDepositToVault).toHaveBeenCalledTimes(10);
  });

  test('reads have their own, larger budget', async () => {
    mockDepositToVault.mockResolvedValue({ xdr: 'AAAA' });
    mockGetVaultAPY.mockResolvedValue({ apy: 7 });
    const app = buildApp();
    const body = { caller: VALID_ADDRESS, amountStroops: '10000000' };

    for (let i = 0; i < 10; i++) {
      await request(app).post('/defindex/deposit').set('X-Forwarded-For', '4.4.4.4').send(body);
    }
    const read = await request(app).get('/defindex/apy').set('X-Forwarded-For', '4.4.4.4');

    expect(read.status).toBe(200);
  });

  test('responses, including 429s, are counted per route', async () => {
    mockGetVaultAPY.mockResolvedValue({ apy: 7 });
    const app = buildApp();

    for (let i = 0; i < 61; i++) {
      await request(app).get('/defindex/apy').set('X-Forwarded-For', '5.5.5.5');
    }
    await request(app).get('/defindex/position?address=nope').set('X-Forwarded-For', '6.6.6.6');

    const snap = vaultMetricsSnapshot();
    expect(snap.apy.requests).toBe(61);
    expect(snap.apy.rateLimited).toBe(1);
    expect(snap.position.clientErrors).toBe(1);
    expect(snap.deposit.requests).toBe(0);
  });
});

describe('vault failure alerting', () => {
  const alertLines = () =>
    errorSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[ALERT]'));

  test('logs one alert when a route reaches the consecutive-failure threshold', () => {
    for (let i = 0; i < ALERT_AFTER_CONSECUTIVE_FAILURES + 3; i++) {
      recordVaultRequest('deposit', 502, 10);
    }

    expect(alertLines()).toHaveLength(1);
    expect(alertLines()[0]).toContain('defindex deposit');
    expect(vaultMetricsSnapshot().deposit.failing).toBe(true);
  });

  test('a success clears the streak, and client errors never count toward it', () => {
    for (let i = 0; i < ALERT_AFTER_CONSECUTIVE_FAILURES - 1; i++) recordVaultRequest('apy', 502, 10);
    recordVaultRequest('apy', 200, 10);
    for (let i = 0; i < ALERT_AFTER_CONSECUTIVE_FAILURES - 1; i++) recordVaultRequest('apy', 502, 10);
    for (let i = 0; i < 20; i++) recordVaultRequest('apy', 400, 10);

    expect(alertLines()).toHaveLength(0);
    expect(vaultMetricsSnapshot().apy.failing).toBe(false);
  });

  test('upstream failures through the real route feed the alert', async () => {
    mockGetVaultAPY.mockRejectedValue(new Error('boom'));
    const app = buildApp();

    for (let i = 0; i < ALERT_AFTER_CONSECUTIVE_FAILURES; i++) {
      const res = await request(app).get('/defindex/apy').set('X-Forwarded-For', '7.7.7.7');
      expect(res.status).toBeGreaterThanOrEqual(500);
    }

    expect(alertLines()).toHaveLength(1);
    expect(vaultMetricsSnapshot().apy.serverErrors).toBe(ALERT_AFTER_CONSECUTIVE_FAILURES);
  });
});
