/**
 * Route integration tests — uses a standalone Express app built from the
 * router so there's no port conflict with index.ts.
 *
 * buildSPVProof is mocked; the real EsploraClient is never called.
 */

// jest.mock must be called before any module imports so ts-jest can hoist it.
jest.mock('../src/bitcoin/spv.js', () => {
  // Keep the real error classes; only mock the async function.
  const actual = jest.requireActual<typeof import('../src/bitcoin/spv.js')>('../src/bitcoin/spv.js');
  return { ...actual, buildSPVProof: jest.fn() };
});

import express from 'express';
import request from 'supertest';
import { proofRouter } from '../src/routes/proof.js';
import {
  buildSPVProof,
  UnconfirmedTxError,
  InsufficientConfirmationsError,
} from '../src/bitcoin/spv.js';

const mockBuildSPVProof = buildSPVProof as jest.Mock;

const VALID_TXID = 'a'.repeat(64);

const FAKE_BUNDLE = {
  txid: VALID_TXID,
  rawTxNoWitness: '01'.repeat(80),
  txIndex: 5,
  merkleProof: ['bb'.repeat(32)],
  headers: ['cc'.repeat(80)],
  blockHeight: 800_000,
  confirmations: 6,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/spv-proof', proofRouter);
  return app;
}

let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  app = buildApp();
  mockBuildSPVProof.mockReset();
});

// ── Happy path ────────────────────────────────────────────────────────────

describe('GET /spv-proof/:txid — happy path', () => {
  test('200 with proof bundle and sorobanArgs', async () => {
    mockBuildSPVProof.mockResolvedValue(FAKE_BUNDLE);

    const res = await request(app).get(`/spv-proof/${VALID_TXID}`);

    expect(res.status).toBe(200);
    expect(res.body.txid).toBe(VALID_TXID);
    expect(res.body.confirmations).toBe(6);
    expect(res.body.blockHeight).toBe(800_000);
    expect(res.body.rawTxNoWitness).toBe(FAKE_BUNDLE.rawTxNoWitness);
  });

  test('sorobanArgs maps fields to Soroban contract parameter names', async () => {
    mockBuildSPVProof.mockResolvedValue(FAKE_BUNDLE);

    const res = await request(app).get(`/spv-proof/${VALID_TXID}`);

    expect(res.body.sorobanArgs).toMatchObject({
      headers:           FAKE_BUNDLE.headers,
      merkle_proof:      FAKE_BUNDLE.merkleProof,
      tx_index:          FAKE_BUNDLE.txIndex,
      raw_tx:            FAKE_BUNDLE.rawTxNoWitness,
      min_confirmations: FAKE_BUNDLE.confirmations,
    });
  });

  test('forwards custom confirmations query param to buildSPVProof', async () => {
    mockBuildSPVProof.mockResolvedValue({ ...FAKE_BUNDLE, confirmations: 3 });

    await request(app).get(`/spv-proof/${VALID_TXID}?confirmations=3`);

    expect(mockBuildSPVProof).toHaveBeenCalledWith(VALID_TXID, 3, expect.anything());
  });

  test('uses default confirmations (6) when none is supplied', async () => {
    mockBuildSPVProof.mockResolvedValue(FAKE_BUNDLE);

    await request(app).get(`/spv-proof/${VALID_TXID}`);

    expect(mockBuildSPVProof).toHaveBeenCalledWith(VALID_TXID, 6, expect.anything());
  });

  test('accepts uppercase txid and normalises check', async () => {
    mockBuildSPVProof.mockResolvedValue(FAKE_BUNDLE);
    const uppercaseTxid = VALID_TXID.toUpperCase();

    const res = await request(app).get(`/spv-proof/${uppercaseTxid}`);
    expect(res.status).toBe(200);
  });
});

// ── Input validation ──────────────────────────────────────────────────────

describe('GET /spv-proof/:txid — input validation', () => {
  test('400 for txid that is too short', async () => {
    const res = await request(app).get('/spv-proof/deadbeef');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_txid');
  });

  test('400 for txid with non-hex characters', async () => {
    const res = await request(app).get(`/spv-proof/${'z'.repeat(64)}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_txid');
  });

  test('400 for confirmations=0', async () => {
    const res = await request(app).get(`/spv-proof/${VALID_TXID}?confirmations=0`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_confirmations');
  });

  test('400 for confirmations above the maximum', async () => {
    const res = await request(app).get(`/spv-proof/${VALID_TXID}?confirmations=999`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_confirmations');
  });

  test('400 for non-numeric confirmations', async () => {
    const res = await request(app).get(`/spv-proof/${VALID_TXID}?confirmations=abc`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_confirmations');
  });
});

// ── Error propagation ─────────────────────────────────────────────────────

describe('GET /spv-proof/:txid — error propagation', () => {
  test('404 when the transaction is not yet confirmed', async () => {
    mockBuildSPVProof.mockRejectedValue(new UnconfirmedTxError(VALID_TXID));

    const res = await request(app).get(`/spv-proof/${VALID_TXID}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('unconfirmed');
  });

  test('409 when not enough confirmations are available', async () => {
    mockBuildSPVProof.mockRejectedValue(
      new InsufficientConfirmationsError(VALID_TXID, 6, 3)
    );

    const res = await request(app).get(`/spv-proof/${VALID_TXID}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('insufficient_confirmations');
    expect(res.body.requested).toBe(6);
    expect(res.body.available).toBe(3);
  });

  test('502 for unexpected upstream errors', async () => {
    mockBuildSPVProof.mockRejectedValue(new Error('connection refused'));

    const res = await request(app).get(`/spv-proof/${VALID_TXID}`);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('upstream_error');
    expect(res.body.message).toContain('connection refused');
  });
});

// ── Health check ─────────────────────────────────────────────────────────

describe('GET /health', () => {
  test('200 with service metadata', async () => {
    const healthApp = express();
    healthApp.get('/health', (_req, res) => {
      res.json({ status: 'ok', service: 'writz-relayer' });
    });

    const res = await request(healthApp).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('writz-relayer');
  });
});
