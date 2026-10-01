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

beforeEach(() => {
  mockGetVaultAPY.mockReset();
  mockDepositToVault.mockReset();
  config.defindexVaultId = VAULT_ID;
  vaultReadLimiter.reset();
  vaultTxLimiter.reset();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
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
});
