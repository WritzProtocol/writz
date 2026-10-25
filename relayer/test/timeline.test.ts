/**
 * GET /timeline/:btcTxid - the full cycle of a position, the attribution
 * rule for receive legs, and the error answers. Every chain read is a mock;
 * no Esplora, Stellar RPC or Horizon call is made.
 */
import express from 'express';
import request from 'supertest';
import { createTimelineRouter, mintFromRelayView, orderTimeline, type TimelineRouterDeps } from '../src/routes/timeline.js';
import { attributeReceiveLegs, type OwnerOperation } from '../src/lend/receive-legs.js';
import type { PositionEventRecord } from '../src/lend/deposit-reads.js';
import { EsploraError } from '../src/bitcoin/esplora.js';

// A txid whose display and internal byte orders differ, so a mix-up shows.
const TXID = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';
const POSITION_ID = '201f1e1d1c1b1a191817161514131211100f0e0d0c0b0a090807060504030201';
const OWNER = 'GOWNER';
const SCRIPT = '0020' + '87'.repeat(32);
const RELEASE = 'ee'.repeat(32);
const h = (c: string) => c.repeat(64);
const T0 = Date.parse('2026-10-24T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

const record = (kind: PositionEventRecord['kind'], hash: string, offsetS: number, extra: Partial<PositionEventRecord> = {}): PositionEventRecord => ({
  kind,
  txid: POSITION_ID,
  stellarTxHash: hash,
  ledger: 1_000 + offsetS,
  ledgerClosedAt: iso(T0 + offsetS * 1000),
  ...extra,
});
const ownerOp = (kind: OwnerOperation['kind'], hash: string, offsetS: number): OwnerOperation => ({ kind, txHash: hash, at: T0 + offsetS * 1000 });

const HISTORY = [
  record('deposit', h('1'), 0),
  record('borrow', h('2'), 10, { account: OWNER, amount: '10000000' }),
  record('repay_full', h('5'), 100, { account: OWNER }),
];
const OPS = [ownerOp('borrow', h('2'), 10), ownerOp('swap_to_xlm', h('3'), 20), ownerOp('burn_to_base_sepolia', h('4'), 30), ownerOp('repay', h('5'), 100)];

function deps(overrides: Partial<TimelineRouterDeps> = {}): Partial<TimelineRouterDeps> {
  return {
    history: jest.fn().mockResolvedValue(HISTORY),
    position: jest.fn().mockResolvedValue({ depositor: OWNER, status: 'Closed', p2wshScriptPubkey: SCRIPT }),
    bitcoinTx: jest.fn().mockResolvedValue({
      txid: TXID,
      status: { confirmed: true, block_height: 10, block_hash: 'b', block_time: (T0 - 60_000) / 1000 },
      vout: [{ scriptpubkey: '0014' + 'aa'.repeat(20), value: 1 }, { scriptpubkey: SCRIPT, value: 10_000 }],
    }),
    outspends: jest.fn().mockResolvedValue([
      { spent: false },
      { spent: true, txid: RELEASE, vin: 0, status: { confirmed: true, block_height: 11, block_hash: 'c', block_time: (T0 + 200_000) / 1000 } },
    ]),
    ownerOperations: jest.fn().mockResolvedValue({ operations: OPS, truncated: false }),
    mint: jest.fn((burn: string) => (burn === h('4') ? { mintHash: '0x' + 'ab'.repeat(32), at: T0 + 45_000 } : undefined)),
    explorers: {
      bitcoinTx: (x) => `btc/${x}`,
      stellarTx: (x) => `xlm/${x}`,
      baseSepoliaTx: (x) => `base/${x}`,
    },
    warm: jest.fn().mockResolvedValue(undefined),
    notConfiguredReason: null,
    rateLimit: 1000,
    rateWindowMs: 60_000,
    now: () => 0,
    ...overrides,
  };
}

function appWith(d: Partial<TimelineRouterDeps>) {
  const app = express();
  app.set('trust proxy', 1);
  app.use('/timeline', createTimelineRouter(d));
  return app;
}
const get = (d: Partial<TimelineRouterDeps>, txid = TXID) => request(appWith(d)).get(`/timeline/${txid}`);

describe('GET /timeline/:btcTxid - the full cycle', () => {
  test('borrow, receive and repay: every step with its link, in chain order', async () => {
    const d = deps();
    const res = await get(d);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      btcTxid: TXID,
      positionId: POSITION_ID,
      owner: OWNER,
      status: 'Closed',
      complete: true,
      gaps: [],
      events: [
        { kind: 'btc_lock', chain: 'bitcoin', hash: TXID, at: T0 - 60_000, url: `btc/${TXID}` },
        { kind: 'verified', chain: 'stellar', hash: h('1'), at: T0, url: `xlm/${h('1')}` },
        { kind: 'borrowed', chain: 'stellar', hash: h('2'), at: T0 + 10_000, url: `xlm/${h('2')}` },
        { kind: 'received', chain: 'stellar', hash: h('3'), at: T0 + 20_000, detail: 'as XLM', url: `xlm/${h('3')}` },
        { kind: 'received', chain: 'stellar', hash: h('4'), at: T0 + 30_000, detail: 'sent to Base Sepolia', url: `xlm/${h('4')}` },
        { kind: 'received', chain: 'base-sepolia', hash: '0x' + 'ab'.repeat(32), at: T0 + 45_000, detail: 'on Base Sepolia', url: `base/0x${'ab'.repeat(32)}` },
        { kind: 'repaid', chain: 'stellar', hash: h('5'), at: T0 + 100_000, url: `xlm/${h('5')}` },
        { kind: 'released', chain: 'bitcoin', hash: RELEASE, at: T0 + 200_000, url: `btc/${RELEASE}` },
      ],
    });
    // writz-lend is keyed by the internal byte order; Bitcoin by the display order.
    expect(d.history).toHaveBeenCalledWith(POSITION_ID);
    expect(d.bitcoinTx).toHaveBeenCalledWith(TXID);
    // The owner's operations are read from the first borrow on.
    expect(d.ownerOperations).toHaveBeenCalledWith(OWNER, 1_010);
  });

  test('a fresh deposit: the lock and its verification, nothing invented', async () => {
    const res = await get(
      deps({
        history: jest.fn().mockResolvedValue([record('deposit', h('1'), 0)]),
        position: jest.fn().mockResolvedValue({ depositor: OWNER, status: 'Active', p2wshScriptPubkey: SCRIPT }),
        outspends: jest.fn().mockResolvedValue([{ spent: false }, { spent: false }]),
      }),
    );
    expect(res.body.events.map((e: { kind: string }) => e.kind)).toEqual(['btc_lock', 'verified']);
    expect(res.body.complete).toBe(true);
  });

  test('a burn whose mint the relay has not recorded shows the burn only', async () => {
    const res = await get(deps({ mint: jest.fn().mockReturnValue(undefined) }));
    expect(res.body.events.filter((e: { chain: string }) => e.chain === 'base-sepolia')).toEqual([]);
    expect(res.body.events.some((e: { hash: string }) => e.hash === h('4'))).toBe(true);
  });

  test('a liquidation is the step that repaid the debt', async () => {
    const res = await get(deps({ history: jest.fn().mockResolvedValue([record('deposit', h('1'), 0), record('liquidate', h('9'), 50)]) }));
    expect(res.body.events).toContainEqual({ kind: 'repaid', chain: 'stellar', hash: h('9'), at: T0 + 50_000, detail: 'by liquidation', url: `xlm/${h('9')}` });
  });

  test('an unconfirmed lock and release have no time', async () => {
    const res = await get(
      deps({
        outspends: jest.fn().mockResolvedValue([{ spent: false }, { spent: true, txid: RELEASE, status: { confirmed: false, block_height: null, block_hash: null, block_time: null } }]),
      }),
    );
    expect(res.body.events.at(-1)).toMatchObject({ kind: 'released', at: null });
  });
});

describe('GET /timeline/:btcTxid - partial answers', () => {
  test('Bitcoin unreadable: the lock is still listed, the release is marked unchecked', async () => {
    const res = await get(deps({ bitcoinTx: jest.fn().mockRejectedValue(new EsploraError(503, 'https://e/tx/x', '')) }));
    expect(res.status).toBe(200);
    expect(res.body.complete).toBe(false);
    expect(res.body.gaps[0]).toMatch(/^bitcoin: /);
    expect(res.body.events[0]).toMatchObject({ kind: 'btc_lock', hash: TXID, at: null });
    expect(res.body.events.some((e: { kind: string }) => e.kind === 'released')).toBe(false);
  });

  test('Horizon unreadable: no receive legs, marked incomplete', async () => {
    const res = await get(deps({ ownerOperations: jest.fn().mockRejectedValue(new Error('Horizon 503')) }));
    expect(res.body.complete).toBe(false);
    expect(res.body.gaps[0]).toMatch(/receive legs are not shown/);
    expect(res.body.events.some((e: { kind: string }) => e.kind === 'received')).toBe(false);
  });

  test('a position older than the event window says so', async () => {
    const res = await get(deps({ history: jest.fn().mockResolvedValue([]) }));
    expect(res.status).toBe(200);
    expect(res.body.complete).toBe(false);
    expect(res.body.gaps[0]).toMatch(/event window/);
    expect(res.body.events.map((e: { kind: string }) => e.kind)).toEqual(['btc_lock', 'released']);
  });

  test('a truncated read of the owner operations says so', async () => {
    const res = await get(deps({ ownerOperations: jest.fn().mockResolvedValue({ operations: OPS, truncated: true }) }));
    expect(res.body.complete).toBe(false);
    expect(res.body.events.some((e: { detail?: string }) => e.detail === 'as XLM')).toBe(true);
  });
});

describe('GET /timeline/:btcTxid - errors', () => {
  test('400 for a malformed txid', async () => {
    const res = await get(deps(), 'xyz');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_txid');
  });

  test('404 when writz-lend knows nothing of the txid', async () => {
    const res = await get(deps({ history: jest.fn().mockResolvedValue([]), position: jest.fn().mockResolvedValue(undefined) }));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('position_not_found');
  });

  test('503 when Stellar RPC cannot be read', async () => {
    const res = await get(deps({ history: jest.fn().mockRejectedValue(new Error('rpc down')) }));
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('stellar_unavailable');
    expect(res.headers['retry-after']).toBe('10');
  });

  test('503 when lending is not configured', async () => {
    const res = await get(deps({ notConfiguredReason: 'WRITZ_LEND_ID is not set on this relayer' }));
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('lending_not_configured');
  });

  test('rate limited per address', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const app = appWith(deps({ rateLimit: 1 }));
    expect((await request(app).get(`/timeline/${TXID}`)).status).toBe(200);
    const res = await request(app).get(`/timeline/${TXID}`);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('rate_limited');
    warn.mockRestore();
  });

  test('one answer per txid is shared for a few seconds', async () => {
    let t = 0;
    const d = deps({ now: () => t });
    const app = appWith(d);
    await request(app).get(`/timeline/${TXID}`);
    await request(app).get(`/timeline/${TXID.toUpperCase()}`);
    expect(d.history).toHaveBeenCalledTimes(1);
    t = 10_001;
    await request(app).get(`/timeline/${TXID}`);
    expect(d.history).toHaveBeenCalledTimes(2);
  });
});

describe('attributeReceiveLegs', () => {
  const mine = new Set([h('2')]);

  test('legs after this position borrow belong to it', () => {
    expect(attributeReceiveLegs(OPS, mine).map((l) => l.txHash)).toEqual([h('3'), h('4')]);
  });

  test('a later borrow on another position takes the legs after it', () => {
    const ops = [ownerOp('borrow', h('2'), 10), ownerOp('swap_to_xlm', h('3'), 20), ownerOp('borrow', h('8'), 30), ownerOp('swap_to_xlm', h('4'), 40)];
    expect(attributeReceiveLegs(ops, mine).map((l) => l.txHash)).toEqual([h('3')]);
    expect(attributeReceiveLegs(ops, new Set([h('8')])).map((l) => l.txHash)).toEqual([h('4')]);
  });

  test('a repay closes the window: a leg after it belongs to no position', () => {
    const ops = [ownerOp('borrow', h('2'), 10), ownerOp('repay', h('7'), 20), ownerOp('swap_to_xlm', h('3'), 30)];
    expect(attributeReceiveLegs(ops, mine)).toEqual([]);
  });

  test('a leg before any borrow belongs to no position', () => {
    expect(attributeReceiveLegs([ownerOp('swap_to_xlm', h('3'), 5), ownerOp('borrow', h('2'), 10)], mine)).toEqual([]);
  });
});

describe('orderTimeline', () => {
  test('matches the app: lock and verification first, release last, time between', () => {
    const e = (kind: Parameters<typeof orderTimeline>[0][number]['kind'], hash: string, at: number | null) => ({ kind, chain: 'stellar' as const, hash, at });
    const ordered = orderTimeline([e('released', 'r', 1), e('repaid', 'p', 30), e('received', 'x', null), e('borrowed', 'b', 20), e('btc_lock', 'l', null), e('verified', 'v', 10), e('borrowed', 'b', 20)]);
    expect(ordered.map((x) => x.hash)).toEqual(['l', 'v', 'b', 'p', 'x', 'r']);
  });
});

describe('mintFromRelayView', () => {
  const base = { burnHash: h('4'), createdAt: iso(T0), updatedAt: iso(T0 + 45_000) };
  test('an arrived transfer with its mint hash is a mint', () => {
    expect(mintFromRelayView({ ...base, kind: 'arrived', mintHash: '0xab' })).toEqual({ mintHash: '0xab', at: T0 + 45_000 });
  });

  test('no mint while retrying, still looking the mint up, failed or unknown', () => {
    expect(mintFromRelayView({ ...base, kind: 'confirmed', retrying: true, reason: 'rpc down', nextRetryAt: iso(T0 + 60_000) })).toBeUndefined();
    expect(mintFromRelayView({ ...base, kind: 'arrived', mintHash: null })).toBeUndefined();
    expect(mintFromRelayView({ ...base, kind: 'failed', reason: 'refused' })).toBeUndefined();
    expect(mintFromRelayView(undefined)).toBeUndefined();
  });
});
