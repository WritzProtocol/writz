/**
 * Route integration tests - uses a standalone Express app built from the
 * router so there's no port conflict with index.ts.
 *
 * The DeFindex client module is mocked; the real @defindex/sdk / API is
 * never called.
 */

// jest.mock must be called before any module imports so ts-jest can hoist it.
jest.mock('../src/defindex/client.js', () => ({
  defindexSdk: { getVaultAPY: jest.fn(), getVaultBalance: jest.fn() },
  defindexNetwork: 'testnet',
}));

import express from 'express';
import request from 'supertest';
import { defindexRouter } from '../src/routes/defindex.js';
import { defindexSdk } from '../src/defindex/client.js';
import { config } from '../src/config.js';

const mockGetVaultAPY = defindexSdk.getVaultAPY as jest.Mock;
const mockGetVaultBalance = defindexSdk.getVaultBalance as jest.Mock;

const VAULT_ID = 'CBMHGL7GGGHODEDDJ5H2LKJEFHJWBRSQUKOXMC4FKOFDZK5HBKW6PI2S';
const VALID_ADDRESS = 'GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/defindex', defindexRouter);
  return app;
}

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = buildApp();
  mockGetVaultAPY.mockReset();
  mockGetVaultBalance.mockReset();
  config.defindexVaultId = VAULT_ID;
});

// ── GET /defindex/apy ────────────────────────────────────────────────────

describe('GET /defindex/apy', () => {
  test('200 with the vault APY converted from a DeFindex percentage to a fraction', async () => {
    // DeFindex's own API returns a percentage number (e.g. 7.21 = 7.21%),
    // confirmed against the live testnet vault - not the fraction its own
    // docs describe. The route must divide by 100 to honor the frontend's
    // documented wire contract (0.0731 = 7.31%).
    mockGetVaultAPY.mockResolvedValue({ apy: 7.21 });

    const res = await request(app).get('/defindex/apy');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ apy: 0.0721 });
    expect(mockGetVaultAPY).toHaveBeenCalledWith(VAULT_ID, 'testnet');
  });

  test('500 when DEFINDEX_VAULT_ID is not configured, and the SDK is never called', async () => {
    config.defindexVaultId = '';

    const res = await request(app).get('/defindex/apy');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DEFINDEX_VAULT_ID not configured');
    expect(mockGetVaultAPY).not.toHaveBeenCalled();
  });

  test('502 with the ContractError variant name when the SDK rejects', async () => {
    mockGetVaultAPY.mockRejectedValue({
      error: 'ContractError',
      message: 'contract call failed',
      networkDetails: { stellarErrorCode: '100' },
    });

    const res = await request(app).get('/defindex/apy');

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'NotInitialized' });
  });
});

// ── GET /defindex/position ───────────────────────────────────────────────

describe('GET /defindex/position', () => {
  test('200 with dfTokens and underlyingStroops as decimal strings', async () => {
    mockGetVaultBalance.mockResolvedValue({ dfTokens: 12_500_000, underlyingBalance: [12_734_512] });

    const res = await request(app).get(`/defindex/position?address=${VALID_ADDRESS}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dfTokens: '12500000', underlyingStroops: '12734512' });
    expect(typeof res.body.dfTokens).toBe('string');
    expect(typeof res.body.underlyingStroops).toBe('string');
    expect(mockGetVaultBalance).toHaveBeenCalledWith(VAULT_ID, VALID_ADDRESS, 'testnet');
  });

  test('400 when address is missing, and the SDK is never called', async () => {
    const res = await request(app).get('/defindex/position');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('address must be a Stellar G... public key');
    expect(mockGetVaultBalance).not.toHaveBeenCalled();
  });

  test('400 when address is malformed (wrong length)', async () => {
    const res = await request(app).get('/defindex/position?address=GTOOSHORT');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('address must be a Stellar G... public key');
  });

  test('400 when address does not start with G', async () => {
    const res = await request(app).get(
      `/defindex/position?address=C${VALID_ADDRESS.slice(1)}`,
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('address must be a Stellar G... public key');
  });

  test('404 when the vault reports the address not found', async () => {
    mockGetVaultBalance.mockRejectedValue({ error: 'NotFound', message: 'position not found' });

    const res = await request(app).get(`/defindex/position?address=${VALID_ADDRESS}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'position not found' });
  });

  test('500 when DEFINDEX_VAULT_ID is not configured', async () => {
    config.defindexVaultId = '';

    const res = await request(app).get(`/defindex/position?address=${VALID_ADDRESS}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DEFINDEX_VAULT_ID not configured');
    expect(mockGetVaultBalance).not.toHaveBeenCalled();
  });
});
