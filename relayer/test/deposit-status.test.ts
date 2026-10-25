/**
 * GET /deposit-status/:txid - one test per stage, the error answers, the
 * `stellarTx` submission check, and the deposit index that finds the Stellar
 * transaction. Every chain read is a
 * mock; no Esplora or Stellar RPC call is made.
 */
import express from 'express';
import request from 'supertest';
import {
  createDepositStatusRouter,
  SUBMISSION_WINDOW_MS,
  toInternalTxid,
  type DepositStatusRouterDeps,
  type Registration,
} from '../src/routes/deposit-status.js';
import { PositionEventIndex, ledgerOfCursor, type DepositEventsServer } from '../src/lend/deposit-reads.js';
import { EsploraError } from '../src/bitcoin/esplora.js';
import { cursorForLedger } from '../src/rpc-cursor.js';

// A txid whose display and internal byte orders differ, so a mix-up shows.
const TXID = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';
const TXID_INTERNAL = '201f1e1d1c1b1a191817161514131211100f0e0d0c0b0a090807060504030201';
const STELLAR_TX = 'ab'.repeat(32);

const confirmedAt = (height: number) => ({ confirmed: true, block_height: height, block_hash: 'h', block_time: 1 });
const MEMPOOL = { confirmed: false, block_height: null, block_hash: null, block_time: null };
const NOT_REGISTERED: Registration = { registered: false };
const REGISTERED: Registration = {
  registered: true,
  record: { stellarTxHash: STELLAR_TX, ledger: 5_364_245, ledgerClosedAt: '2026-10-24T12:26:52Z' },
};

function deps(overrides: Partial<DepositStatusRouterDeps> = {}): Partial<DepositStatusRouterDeps> {
  return {
    bitcoinTx: jest.fn().mockResolvedValue(confirmedAt(100)),
    bitcoinTip: jest.fn().mockResolvedValue(100),
    required: jest.fn().mockResolvedValue(1),
    registration: jest.fn().mockResolvedValue(NOT_REGISTERED),
    submission: jest.fn().mockRejectedValue(new Error('no stellarTx was named')),
    lightClientTip: jest.fn().mockResolvedValue(100),
    warm: jest.fn().mockResolvedValue(undefined),
    notConfiguredReason: null,
    rateLimit: 1000,
    rateWindowMs: 60_000,
    now: () => 0,
    ...overrides,
  };
}

function appWith(d: Partial<DepositStatusRouterDeps>) {
  const app = express();
  app.set('trust proxy', 1);
  app.use('/deposit-status', createDepositStatusRouter(d));
  return app;
}

const get = (d: Partial<DepositStatusRouterDeps>, txid = TXID) => request(appWith(d)).get(`/deposit-status/${txid}`);

describe('GET /deposit-status/:txid - stages', () => {
  test('unseen: the Bitcoin indexer does not know the txid', async () => {
    const res = await get(deps({ bitcoinTx: jest.fn().mockResolvedValue(null) }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      txid: TXID,
      stage: 'unseen',
      confirmations: 0,
      required: 1,
      blockHeight: null,
      proofReady: false,
      lightClientTipHeight: null,
      stellarTxHash: null,
      ledger: null,
      verifiedAt: null,
      submission: null,
    });
  });

  test('mempool: broadcast, not in a block, and the tip is not read', async () => {
    const d = deps({ bitcoinTx: jest.fn().mockResolvedValue(MEMPOOL) });
    const res = await get(d);
    expect(res.body).toMatchObject({ stage: 'mempool', confirmations: 0, blockHeight: null, proofReady: false });
    expect(d.bitcoinTip).not.toHaveBeenCalled();
  });

  test('confirming: fewer confirmations than the deployment requires', async () => {
    const d = deps({ required: jest.fn().mockResolvedValue(6), bitcoinTip: jest.fn().mockResolvedValue(102) });
    const res = await get(d);
    expect(res.body).toMatchObject({ stage: 'confirming', confirmations: 3, required: 6, blockHeight: 100, proofReady: false });
    // The light client cannot change the stage yet, so it is not asked.
    expect(d.lightClientTip).not.toHaveBeenCalled();
    expect(res.body.lightClientTipHeight).toBeNull();
  });

  test('confirming: enough confirmations, but the light client lacks the confirming headers', async () => {
    const res = await get(
      deps({
        required: jest.fn().mockResolvedValue(6),
        bitcoinTip: jest.fn().mockResolvedValue(106),
        lightClientTip: jest.fn().mockResolvedValue(104),
      }),
    );
    expect(res.body).toMatchObject({ stage: 'confirming', confirmations: 7, required: 6, proofReady: false, lightClientTipHeight: 104 });
  });

  test('ready: the light client holds the block and every confirming header', async () => {
    const res = await get(
      deps({
        required: jest.fn().mockResolvedValue(6),
        bitcoinTip: jest.fn().mockResolvedValue(106),
        lightClientTip: jest.fn().mockResolvedValue(105),
      }),
    );
    expect(res.body).toMatchObject({ stage: 'ready', confirmations: 7, required: 6, proofReady: true, lightClientTipHeight: 105, stellarTxHash: null });
  });

  test('ready at the testnet minimum of 1: the block itself is the only header needed', async () => {
    const res = await get(deps());
    expect(res.body).toMatchObject({ stage: 'ready', confirmations: 1, required: 1, proofReady: true, lightClientTipHeight: 100 });
  });

  test('ready when the light client tip is unknown, as the proof route treats it', async () => {
    const res = await get(deps({ lightClientTip: jest.fn().mockResolvedValue(undefined) }));
    expect(res.body).toMatchObject({ stage: 'ready', proofReady: true, lightClientTipHeight: null });
  });

  test('a tip below the block (a lagging fallback host) still counts one confirmation', async () => {
    const res = await get(deps({ bitcoinTip: jest.fn().mockResolvedValue(99) }));
    expect(res.body.confirmations).toBe(1);
  });

  test('verified: writz-lend registered it, with the Stellar transaction from the deposit event', async () => {
    const res = await get(deps({ bitcoinTip: jest.fn().mockResolvedValue(154), registration: jest.fn().mockResolvedValue(REGISTERED) }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      txid: TXID,
      stage: 'verified',
      confirmations: 55,
      required: 1,
      blockHeight: 100,
      proofReady: true,
      lightClientTipHeight: 100,
      stellarTxHash: STELLAR_TX,
      ledger: 5_364_245,
      verifiedAt: '2026-10-24T12:26:52Z',
      submission: null,
    });
  });

  test('verified without a hash when the event is older than the RPC keeps', async () => {
    const res = await get(deps({ registration: jest.fn().mockResolvedValue({ registered: true, record: null }) }));
    expect(res.body).toMatchObject({ stage: 'verified', stellarTxHash: null, ledger: null, verifiedAt: null });
  });

  test('verified comes only from Stellar, never from the confirmation count', async () => {
    const res = await get(deps({ bitcoinTip: jest.fn().mockResolvedValue(10_000) }));
    expect(res.body.stage).toBe('ready');
    expect(res.body.stellarTxHash).toBeNull();
  });

  test('verified is still answered when Bitcoin cannot be read, with the Bitcoin fields null', async () => {
    const res = await get(
      deps({
        bitcoinTx: jest.fn().mockRejectedValue(new EsploraError(503, 'https://e/tx/x', '')),
        registration: jest.fn().mockResolvedValue(REGISTERED),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stage: 'verified', confirmations: null, blockHeight: null, proofReady: null, stellarTxHash: STELLAR_TX });
  });

  test('looks the deposit up on Stellar by the internal-order txid', async () => {
    const d = deps();
    await get(d);
    expect(d.registration).toHaveBeenCalledWith(TXID_INTERNAL);
    expect(toInternalTxid(TXID)).toBe(TXID_INTERNAL);
  });

  test('without stellarTx the transaction lookup is never made', async () => {
    const d = deps();
    const res = await get(d);
    expect(res.body.submission).toBeNull();
    expect(d.submission).not.toHaveBeenCalled();
  });

  test('normalises an uppercase txid', async () => {
    const d = deps();
    const res = await get(d, TXID.toUpperCase());
    expect(res.status).toBe(200);
    expect(res.body.txid).toBe(TXID);
    expect(d.bitcoinTx).toHaveBeenCalledWith(TXID);
  });
});

describe('GET /deposit-status/:txid - errors', () => {
  test('400 for a txid that is not 64 hex characters', async () => {
    for (const bad of ['deadbeef', 'z'.repeat(64), 'a'.repeat(65)]) {
      const res = await get(deps(), bad);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_txid');
    }
  });

  test('503 lending_not_configured without WRITZ_LEND_ID', async () => {
    const d = deps({ notConfiguredReason: 'WRITZ_LEND_ID is not set on this relayer' });
    const res = await get(d);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('lending_not_configured');
    expect(d.bitcoinTx).not.toHaveBeenCalled();
  });

  test('503 upstream_unavailable with Retry-After when Esplora is unavailable', async () => {
    const res = await get(deps({ bitcoinTx: jest.fn().mockRejectedValue(new EsploraError(429, 'https://e/tx/x', '')) }));
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('upstream_unavailable');
    expect(res.headers['retry-after']).toBe('10');
  });

  test('502 upstream_error for an unexpected Esplora answer', async () => {
    const res = await get(deps({ bitcoinTip: jest.fn().mockRejectedValue(new Error('could not parse a block height')) }));
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('upstream_error');
  });

  test('503 stellar_unavailable when the deployment minimum cannot be read', async () => {
    const res = await get(deps({ required: jest.fn().mockRejectedValue(new Error('rpc down')) }));
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('stellar_unavailable');
    expect(res.headers['retry-after']).toBe('10');
  });

  test('503 stellar_unavailable when the registration cannot be read, never a guessed stage', async () => {
    const res = await get(deps({ registration: jest.fn().mockRejectedValue(new Error('rpc down')) }));
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('stellar_unavailable');
  });

  test('429 once the per-IP budget is spent', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const app = appWith(deps({ rateLimit: 2 }));
    await request(app).get(`/deposit-status/${TXID}`);
    await request(app).get(`/deposit-status/${TXID}`);
    const res = await request(app).get(`/deposit-status/${TXID}`);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('rate_limited');
    expect(res.headers['retry-after']).toBeDefined();
    warn.mockRestore();
  });
});

describe('GET /deposit-status/:txid - caching', () => {
  test('shares one answer per txid for 5 s, then reads again', async () => {
    let t = 0;
    const d = deps({ now: () => t });
    const app = appWith(d);
    await request(app).get(`/deposit-status/${TXID}`);
    await request(app).get(`/deposit-status/${TXID}`);
    expect(d.bitcoinTx).toHaveBeenCalledTimes(1);
    t = 5_001;
    await request(app).get(`/deposit-status/${TXID}`);
    expect(d.bitcoinTx).toHaveBeenCalledTimes(2);
  });

  test('does not keep a failure', async () => {
    const bitcoinTx = jest.fn().mockRejectedValueOnce(new EsploraError(503, 'https://e/tx/x', '')).mockResolvedValue(confirmedAt(100));
    const app = appWith(deps({ bitcoinTx }));
    expect((await request(app).get(`/deposit-status/${TXID}`)).status).toBe(503);
    expect((await request(app).get(`/deposit-status/${TXID}`)).status).toBe(200);
  });

  test('warm() runs the index warm-up and only logs a failure', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const router = createDepositStatusRouter(deps({ warm: jest.fn().mockRejectedValue(new Error('rpc down')) }));
    await expect(router.warm()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ── ?stellarTx= ──────────────────────────────────────────────────────────

const SUBMITTED_TX = 'cd'.repeat(32);
const SUCCESS = { status: 'success' as const, ledger: 5_383_080, closedAt: '2026-10-25T14:36:27Z' };
const FAILED = {
  status: 'failed' as const,
  ledger: 5_383_001,
  closedAt: '2026-10-25T10:09:41Z',
  reason: 'ScriptPubKeyMismatch',
  errorCode: 21,
};
const NOT_FOUND = { status: 'not_found' as const };

const getWith = (app: ReturnType<typeof appWith>, stellarTx: string, txid = TXID) =>
  request(app).get(`/deposit-status/${txid}`).query({ stellarTx });

describe('GET /deposit-status/:txid?stellarTx= - submission', () => {
  test('submitted: the RPC does not hold the hash yet and the Bitcoin transaction is in a block', async () => {
    const d = deps({ submission: jest.fn().mockResolvedValue(NOT_FOUND) });
    const res = await getWith(appWith(d), SUBMITTED_TX);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      stage: 'submitted',
      confirmations: 1,
      proofReady: true,
      stellarTxHash: null,
      submission: {
        stellarTxHash: SUBMITTED_TX,
        status: 'not_found',
        ledger: null,
        closedAt: null,
        reason: null,
        errorCode: null,
      },
    });
    // Looked up by the internal-order txid the envelope check compares against.
    expect(d.submission).toHaveBeenCalledWith(TXID_INTERNAL, SUBMITTED_TX);
  });

  test('a not-found hash stops counting as submitted once the window has passed', async () => {
    let t = 0;
    const d = deps({ now: () => t, submission: jest.fn().mockResolvedValue(NOT_FOUND) });
    const app = appWith(d);
    expect((await getWith(app, SUBMITTED_TX)).body.stage).toBe('submitted');
    // Past the 5 s answer cache, still inside the window.
    t = SUBMISSION_WINDOW_MS - 5_001;
    expect((await getWith(app, SUBMITTED_TX)).body.stage).toBe('submitted');
    t = SUBMISSION_WINDOW_MS;
    const res = await getWith(app, SUBMITTED_TX);
    // Dropped or never sent: back to what Bitcoin says, and the app can tell why.
    expect(res.body).toMatchObject({ stage: 'ready', submission: { status: 'not_found' } });
  });

  test('the window runs from the first request that named this hash for this txid', async () => {
    let t = 0;
    const d = deps({ now: () => t, submission: jest.fn().mockResolvedValue(NOT_FOUND) });
    const app = appWith(d);
    await getWith(app, SUBMITTED_TX);
    t = SUBMISSION_WINDOW_MS;
    // Another hash, first named now, gets its own full window.
    expect((await getWith(app, 'ef'.repeat(32))).body.stage).toBe('submitted');
    expect((await getWith(app, SUBMITTED_TX)).body.stage).toBe('ready');
  });

  test('a not-found hash is not believed before the Bitcoin transaction is in a block', async () => {
    const mempool = deps({ bitcoinTx: jest.fn().mockResolvedValue(MEMPOOL), submission: jest.fn().mockResolvedValue(NOT_FOUND) });
    expect((await getWith(appWith(mempool), SUBMITTED_TX)).body.stage).toBe('mempool');
    const unseen = deps({ bitcoinTx: jest.fn().mockResolvedValue(null), submission: jest.fn().mockResolvedValue(NOT_FOUND) });
    expect((await getWith(appWith(unseen), SUBMITTED_TX)).body.stage).toBe('unseen');
  });

  test('submitted: the call succeeded but the registration read has not caught up', async () => {
    const d = deps({ submission: jest.fn().mockResolvedValue(SUCCESS) });
    const res = await getWith(appWith(d), SUBMITTED_TX);
    expect(res.body).toMatchObject({
      stage: 'submitted',
      stellarTxHash: null,
      submission: { status: 'success', ledger: 5_383_080, closedAt: '2026-10-25T14:36:27Z', reason: null },
    });
  });

  test('a successful call stays submitted past the window, until the registration lands', async () => {
    let t = 0;
    const registration = jest.fn().mockResolvedValue(NOT_REGISTERED);
    const d = deps({ now: () => t, registration, submission: jest.fn().mockResolvedValue(SUCCESS) });
    const app = appWith(d);
    t = SUBMISSION_WINDOW_MS * 2;
    expect((await getWith(app, SUBMITTED_TX)).body.stage).toBe('submitted');
    registration.mockResolvedValue(REGISTERED);
    t += 5_001;
    expect((await getWith(app, SUBMITTED_TX)).body.stage).toBe('verified');
  });

  test('failed: the call is in a ledger and failed, with the contract error', async () => {
    const res = await getWith(appWith(deps({ submission: jest.fn().mockResolvedValue(FAILED) })), SUBMITTED_TX);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      stage: 'failed',
      stellarTxHash: null,
      verifiedAt: null,
      submission: {
        stellarTxHash: SUBMITTED_TX,
        status: 'failed',
        ledger: 5_383_001,
        closedAt: '2026-10-25T10:09:41Z',
        reason: 'ScriptPubKeyMismatch',
        errorCode: 21,
      },
    });
  });

  test('verified wins over a failed earlier attempt for the same deposit', async () => {
    const d = deps({ registration: jest.fn().mockResolvedValue(REGISTERED), submission: jest.fn().mockResolvedValue(FAILED) });
    const res = await getWith(appWith(d), SUBMITTED_TX);
    expect(res.body).toMatchObject({ stage: 'verified', stellarTxHash: STELLAR_TX, submission: { status: 'failed' } });
  });

  test('verified: a successful stellarTx fills the hash when the event is not indexed', async () => {
    const d = deps({
      registration: jest.fn().mockResolvedValue({ registered: true, record: null }),
      submission: jest.fn().mockResolvedValue(SUCCESS),
    });
    const res = await getWith(appWith(d), SUBMITTED_TX);
    expect(res.body).toMatchObject({
      stage: 'verified',
      stellarTxHash: SUBMITTED_TX,
      ledger: 5_383_080,
      verifiedAt: '2026-10-25T14:36:27Z',
    });
  });

  test('verified: the deposit event stays the source when it is indexed', async () => {
    const d = deps({ registration: jest.fn().mockResolvedValue(REGISTERED), submission: jest.fn().mockResolvedValue(SUCCESS) });
    const res = await getWith(appWith(d), SUBMITTED_TX);
    expect(res.body).toMatchObject({ stage: 'verified', stellarTxHash: STELLAR_TX, ledger: 5_364_245 });
  });

  test('verified when Bitcoin cannot be read still reports the submission', async () => {
    const d = deps({
      bitcoinTx: jest.fn().mockRejectedValue(new EsploraError(503, 'https://e/tx/x', '')),
      registration: jest.fn().mockResolvedValue({ registered: true, record: null }),
      submission: jest.fn().mockResolvedValue(SUCCESS),
    });
    const res = await getWith(appWith(d), SUBMITTED_TX);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stage: 'verified', confirmations: null, stellarTxHash: SUBMITTED_TX, submission: { status: 'success' } });
  });

  test('normalises an uppercase stellarTx', async () => {
    const d = deps({ submission: jest.fn().mockResolvedValue(NOT_FOUND) });
    const res = await getWith(appWith(d), SUBMITTED_TX.toUpperCase());
    expect(res.body.submission.stellarTxHash).toBe(SUBMITTED_TX);
    expect(d.submission).toHaveBeenCalledWith(TXID_INTERNAL, SUBMITTED_TX);
  });
});

describe('GET /deposit-status/:txid?stellarTx= - errors and caching', () => {
  test('400 stellar_tx_mismatch for a hash that is not a writz-lend deposit for this txid', async () => {
    for (const registration of [NOT_REGISTERED, REGISTERED]) {
      const d = deps({ registration: jest.fn().mockResolvedValue(registration), submission: jest.fn().mockResolvedValue({ status: 'mismatch' }) });
      const res = await getWith(appWith(d), SUBMITTED_TX);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('stellar_tx_mismatch');
    }
  });

  test('400 invalid_stellar_tx for a malformed or repeated parameter', async () => {
    const d = deps({ submission: jest.fn().mockResolvedValue(NOT_FOUND) });
    const app = appWith(d);
    for (const bad of ['', 'deadbeef', 'z'.repeat(64), 'a'.repeat(65)]) {
      const res = await getWith(app, bad);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_stellar_tx');
    }
    const repeated = await request(app).get(`/deposit-status/${TXID}?stellarTx=${SUBMITTED_TX}&stellarTx=${SUBMITTED_TX}`);
    expect(repeated.status).toBe(400);
    expect(repeated.body.error).toBe('invalid_stellar_tx');
    expect(d.submission).not.toHaveBeenCalled();
  });

  test('503 stellar_unavailable when the transaction cannot be read, never a guessed stage', async () => {
    const res = await getWith(appWith(deps({ submission: jest.fn().mockRejectedValue(new Error('rpc down')) })), SUBMITTED_TX);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('stellar_unavailable');
    expect(res.headers['retry-after']).toBe('10');
  });

  test('answers are cached per txid and hash, so a hash never speaks for another request', async () => {
    const d = deps({ submission: jest.fn().mockResolvedValue(FAILED) });
    const app = appWith(d);
    expect((await getWith(app, SUBMITTED_TX)).body.stage).toBe('failed');
    expect((await request(app).get(`/deposit-status/${TXID}`)).body).toMatchObject({ stage: 'ready', submission: null });
    await getWith(app, SUBMITTED_TX);
    expect(d.submission).toHaveBeenCalledTimes(1);
  });
});

// ── Deposit index ──────────────────────────────────────────────────────────

type Page = Awaited<ReturnType<DepositEventsServer['getEvents']>>;
const FILTER = { type: 'contract' as const, contractIds: ['C'], topics: [['deposit', '*']] };
const event = (txid: string, ledger: number) => ({ topic: [txid], txHash: `tx-${txid}`, ledger, ledgerClosedAt: `t${ledger}` });
const page = (events: ReturnType<typeof event>[], cursorLedger: number, latestLedger: number): Page => ({
  events,
  cursor: cursorForLedger(cursorLedger),
  latestLedger,
});

function index(pages: Page[], opts: { now?: () => number; oldestLedger?: number } = {}) {
  const server = {
    getHealth: jest.fn().mockResolvedValue({ oldestLedger: opts.oldestLedger ?? 1_000, latestLedger: 50_000 }),
    getEvents: jest.fn(),
  };
  for (const p of pages) server.getEvents.mockResolvedValueOnce(p);
  const idx = new PositionEventIndex({
    server,
    contractId: 'C',
    freshForMs: 5_000,
    now: opts.now ?? (() => 0),
    filter: FILTER,
    decode: (e) => ({ kind: 'deposit', txid: e.topic[0] as string }),
  });
  return { idx, server };
}

describe('PositionEventIndex', () => {
  test('walks from the oldest retained ledger to the tip, page by page', async () => {
    const { idx, server } = index([
      page([event('aa', 3_000)], 11_000, 30_000),
      page([], 21_000, 30_000),
      page([event('bb', 29_000)], 30_000, 30_000),
    ]);
    expect(await idx.lookup('bb')).toEqual({ stellarTxHash: 'tx-bb', ledger: 29_000, ledgerClosedAt: 't29000' });
    expect(await idx.lookup('aa')).toMatchObject({ ledger: 3_000 });
    expect(server.getEvents).toHaveBeenCalledTimes(3);
    expect(server.getEvents.mock.calls[0][0]).toMatchObject({ startLedger: 1_000 });
    expect(server.getEvents.mock.calls[1][0]).toMatchObject({ cursor: cursorForLedger(11_000) });
  });

  test('keeps walking after a full page, even at the tip', async () => {
    const full = Array.from({ length: 200 }, (_, i) => event(`f${i}`, 30_000));
    const { idx, server } = index([page(full, 30_000, 30_000), page([event('last', 30_000)], 30_000, 30_000)]);
    expect(await idx.lookup('last')).toBeDefined();
    expect(server.getEvents).toHaveBeenCalledTimes(2);
  });

  test('reuses a fresh walk, then follows the tip from its cursor', async () => {
    let t = 0;
    const { idx, server } = index([page([], 30_000, 30_000), page([event('cc', 30_010)], 30_010, 30_010)], { now: () => t });
    expect(await idx.lookup('cc')).toBeUndefined();
    expect(await idx.lookup('cc')).toBeUndefined();
    expect(server.getEvents).toHaveBeenCalledTimes(1);
    t = 5_001;
    expect(await idx.lookup('cc')).toMatchObject({ ledger: 30_010 });
    expect(server.getEvents.mock.calls[1][0]).toMatchObject({ cursor: cursorForLedger(30_000) });
  });

  test('a forced refresh reads again inside the freshness window', async () => {
    const { idx, server } = index([page([], 30_000, 30_000), page([event('dd', 30_001)], 30_001, 30_001)]);
    await idx.refresh();
    await idx.refresh(true);
    expect(await idx.lookup('dd')).toBeDefined();
    expect(server.getEvents).toHaveBeenCalledTimes(2);
  });

  test('concurrent lookups share one walk', async () => {
    const { idx, server } = index([page([event('ee', 30_000)], 30_000, 30_000)]);
    await Promise.all([idx.lookup('ee'), idx.lookup('ee'), idx.lookup('ee')]);
    expect(server.getEvents).toHaveBeenCalledTimes(1);
  });

  test('restarts from the oldest ledger when its cursor fell out of retention, keeping what it indexed', async () => {
    let t = 0;
    const { idx, server } = index([page([event('old', 2_000)], 2_000, 2_000)], { now: () => t });
    await idx.lookup('old');
    server.getHealth.mockResolvedValue({ oldestLedger: 9_000, latestLedger: 60_000 });
    server.getEvents
      .mockRejectedValueOnce(new Error('cursor is before the oldest ledger'))
      .mockResolvedValueOnce(page([event('new', 59_000)], 60_000, 60_000));
    t = 10_000;
    expect(await idx.lookup('new')).toBeDefined();
    expect(await idx.lookup('old')).toBeDefined();
    expect(server.getEvents.mock.calls[2][0]).toMatchObject({ startLedger: 9_000 });
  });

  test('a failed read inside retention is an error, not a restart', async () => {
    let t = 0;
    const { idx, server } = index([page([], 30_000, 30_000)], { now: () => t });
    await idx.refresh();
    server.getEvents.mockRejectedValueOnce(new Error('rpc down'));
    t = 10_000;
    await expect(idx.refresh()).rejects.toThrow('rpc down');
  });

  test('history keeps every event of a position, once, across a restart from the oldest ledger', async () => {
    const server = {
      getHealth: jest.fn().mockResolvedValue({ oldestLedger: 1_000, latestLedger: 50_000 }),
      getEvents: jest.fn(),
    };
    const ev = (kind: string, txHash: string, ledger: number) => ({ topic: [kind, 'p1'], txHash, ledger, ledgerClosedAt: `t${ledger}` });
    let t = 0;
    const idx = new PositionEventIndex({
      server,
      contractId: 'C',
      freshForMs: 5_000,
      now: () => t,
      filter: FILTER,
      decode: (e) => ({ kind: e.topic[0] as 'deposit', txid: e.topic[1] as string }),
    });
    server.getEvents.mockResolvedValueOnce(page([ev('deposit', 'd', 2_000), ev('borrow', 'b', 2_001)] as never, 2_001, 2_001));
    await idx.refresh();
    // The cursor fell out of retention; the walk restarts, and the mock replays events already indexed.
    server.getEvents
      .mockRejectedValueOnce(new Error('cursor is before the oldest ledger'))
      .mockResolvedValueOnce(page([ev('deposit', 'd', 2_000), ev('borrow', 'b', 2_001), ev('repay_full', 'r', 2_005)] as never, 2_005, 2_005));
    server.getHealth.mockResolvedValue({ oldestLedger: 2_002, latestLedger: 2_005 });
    t = 10_000;
    expect((await idx.history('p1')).map((e) => [e.kind, e.stellarTxHash])).toEqual([
      ['deposit', 'd'],
      ['borrow', 'b'],
      ['repay_full', 'r'],
    ]);
    expect(await idx.lookup('p1')).toEqual({ stellarTxHash: 'd', ledger: 2_000, ledgerClosedAt: 't2000' });
  });

  test('ledgerOfCursor reads the ledger from the TOID', () => {
    expect(ledgerOfCursor(cursorForLedger(5_382_891))).toBe(5_382_891);
    expect(ledgerOfCursor('0023119345097900031-4294967295')).toBe(5_382_891);
  });
});
