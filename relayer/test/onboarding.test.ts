/**
 * Onboarding funnel: request validation, chain checks for the loan steps,
 * one row per subject and step, faucet outcomes from the faucet route,
 * pseudonymous subjects, the summary and its headline, and the HTTP surface.
 */
import express from 'express';
import request from 'supertest';
import {
  OnboardingFunnel,
  parseStepReport,
  positionReached,
  FunnelError,
  type PositionFacts,
} from '../src/onboarding/funnel.js';
import { memoryFunnelStore } from '../src/onboarding/store.js';
import { createOnboardingRouter } from '../src/routes/onboarding.js';
import { createFaucetRouter } from '../src/routes/faucet.js';
import { positionFactsOf } from '../src/lend/deposit-reads.js';

const G = (c: string) => `G${c.repeat(55)}`;
const ALICE = G('A');
const BOB = G('B');
const CAROL = G('C');
const TX = (n: number) => n.toString(16).padStart(64, '0');
const DAY = 86_400_000;

function setup(positions: Record<string, PositionFacts | Error> = {}, start = Date.UTC(2026, 9, 25, 12)) {
  let t = start;
  const store = memoryFunnelStore('s3cret');
  const funnel = new OnboardingFunnel({
    store,
    contractId: 'CWRITZLEND',
    now: () => t,
    readPosition: async (txid) => {
      const p = positions[txid];
      if (p instanceof Error) throw p;
      return p ?? null;
    },
  });
  return { funnel, store, advance: (ms: number) => (t += ms) };
}

const active = (depositor: string, debt = 0n): PositionFacts => ({ depositor, status: 'active', debtStroops: debt });
const closed = (depositor: string): PositionFacts => ({ depositor, status: 'closed', debtStroops: 0n });

describe('parseStepReport', () => {
  test('accepts the app steps and defaults the channel to wallet', () => {
    expect(parseStepReport({ step: 'sign_in', stellarAddress: ALICE })).toEqual({ step: 'sign_in', stellarAddress: ALICE, channel: 'wallet' });
    expect(parseStepReport({ step: 'deposit', stellarAddress: ALICE, channel: 'social', txid: TX(1).toUpperCase() })).toEqual({
      step: 'deposit',
      stellarAddress: ALICE,
      channel: 'social',
      txid: TX(1),
    });
  });

  test.each([
    [{ step: 'faucet_paid', stellarAddress: ALICE }, /step must be/],
    [{ step: 'sign_in', stellarAddress: 'alice@example.com' }, /stellarAddress/],
    [{ step: 'sign_in', stellarAddress: ALICE, channel: 'email' }, /channel/],
    [{ step: 'borrow', stellarAddress: ALICE }, /deposit txid/],
    [{ step: 'borrow', stellarAddress: ALICE, txid: 'abc' }, /deposit txid/],
    [null, /step must be/],
  ])('refuses %j', (body, message) => {
    expect(() => parseStepReport(body)).toThrow(message);
  });
});

describe('positionReached', () => {
  test('borrow needs debt or a closed loan; release needs a closed loan', () => {
    expect(positionReached('deposit', active(ALICE))).toBe(true);
    expect(positionReached('borrow', active(ALICE))).toBe(false);
    expect(positionReached('borrow', active(ALICE, 5n))).toBe(true);
    expect(positionReached('borrow', closed(ALICE))).toBe(true);
    expect(positionReached('release', active(ALICE))).toBe(false);
    expect(positionReached('release', closed(ALICE))).toBe(true);
    expect(positionReached('sign_in', active(ALICE))).toBe(false);
  });
});

describe('positionFactsOf', () => {
  test('reads the decoded Position shape', () => {
    expect(positionFactsOf({ depositor: ALICE, status: ['Closed'], usdc_debt: 0n })).toEqual({
      depositor: ALICE,
      status: 'closed',
      debtStroops: 0n,
    });
    expect(positionFactsOf({ depositor: ALICE, status: 'Active', usdc_debt: 7 }).debtStroops).toBe(7n);
    expect(() => positionFactsOf({ depositor: ALICE, status: ['Weird'] })).toThrow(/unknown position status/);
  });
});

describe('OnboardingFunnel', () => {
  test('stores a keyed hash of the address, never the address', async () => {
    const { funnel, store } = setup();
    await funnel.report({ step: 'sign_in', stellarAddress: ALICE, channel: 'social' });
    const rows = store.rows();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(ALICE);
    expect(rows[0].subject).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].subject).toBe(funnel.subjectOf(ALICE));
    // A different secret gives a different subject for the same address.
    const other = new OnboardingFunnel({ store: memoryFunnelStore('other') });
    expect(other.subjectOf(ALICE)).not.toBe(rows[0].subject);
  });

  test('records a step once per subject', async () => {
    const { funnel } = setup();
    expect(await funnel.report({ step: 'sign_in', stellarAddress: ALICE })).toEqual({ recorded: true, verified: false });
    expect(await funnel.report({ step: 'sign_in', stellarAddress: ALICE })).toEqual({ recorded: false, verified: false });
    expect(funnel.summary().totals.sign_in).toBe(1);
  });

  test('checks the loan steps on writz-lend before recording them', async () => {
    const { funnel, store } = setup({
      [TX(1)]: active(ALICE, 10n),
      [TX(2)]: active(BOB),
      [TX(3)]: new Error('rpc down'),
    });
    await expect(funnel.report({ step: 'deposit', stellarAddress: ALICE, txid: TX(1) })).resolves.toEqual({ recorded: true, verified: true });
    await expect(funnel.report({ step: 'borrow', stellarAddress: ALICE, txid: TX(1) })).resolves.toEqual({ recorded: true, verified: true });

    const code = async (body: unknown) => {
      try {
        await funnel.report(body);
        return 'ok';
      } catch (e) {
        return (e as FunnelError).code;
      }
    };
    expect(await code({ step: 'deposit', stellarAddress: BOB, txid: TX(1) })).toBe('not_owner');
    expect(await code({ step: 'deposit', stellarAddress: ALICE, txid: TX(9) })).toBe('not_on_chain');
    expect(await code({ step: 'borrow', stellarAddress: BOB, txid: TX(2) })).toBe('step_not_reached');
    expect(await code({ step: 'release', stellarAddress: ALICE, txid: TX(1) })).toBe('step_not_reached');
    expect(await code({ step: 'deposit', stellarAddress: ALICE, txid: TX(3) })).toBe('chain_unavailable');
    expect(store.rows().map((r) => r.step)).toEqual(['deposit', 'borrow']);
  });

  test('answers not_configured for loan steps without a writz-lend contract', async () => {
    const funnel = new OnboardingFunnel({ store: memoryFunnelStore() });
    await expect(funnel.report({ step: 'deposit', stellarAddress: ALICE, txid: TX(1) })).rejects.toMatchObject({ code: 'not_configured', httpStatus: 503 });
    await expect(funnel.report({ step: 'key_created', stellarAddress: ALICE })).resolves.toEqual({ recorded: true, verified: false });
  });

  test('records faucet outcomes for valid addresses only', () => {
    const { funnel, store } = setup();
    funnel.recordFaucet(ALICE, 'paid');
    funnel.recordFaucet(BOB, 'account_already_claimed');
    funnel.recordFaucet(BOB, 'account_already_claimed');
    funnel.recordFaucet('not-an-address', 'paid');
    funnel.recordFaucet(undefined, 'invalid_request');
    funnel.recordFaucet(CAROL, 'Bad Code!');
    expect(store.rows().map((r) => [r.outcome, r.verified])).toEqual([
      ['paid', true],
      ['account_already_claimed', false],
    ]);
    const s = funnel.summary();
    expect(s.faucetOutcomes).toEqual({ paid: 1, account_already_claimed: 1 });
    expect(s.totals.faucet_paid).toBe(1);
  });

  test('computes the funnel, the daily rows and the headline', async () => {
    const { funnel, advance } = setup({
      [TX(1)]: active(ALICE, 10n),
      [TX(2)]: closed(BOB),
      [TX(3)]: active(CAROL),
    });
    // Alice: social, paid, deposit, borrow -> activated.
    await funnel.report({ step: 'sign_in', stellarAddress: ALICE, channel: 'social' });
    await funnel.report({ step: 'key_created', stellarAddress: ALICE, channel: 'social' });
    funnel.recordFaucet(ALICE, 'paid');
    await funnel.report({ step: 'deposit', stellarAddress: ALICE, channel: 'social', txid: TX(1) });
    await funnel.report({ step: 'borrow', stellarAddress: ALICE, channel: 'social', txid: TX(1) });
    advance(DAY);
    // Bob: an extension wallet user, full loop, never paid by the faucet.
    await funnel.report({ step: 'deposit', stellarAddress: BOB, txid: TX(2) });
    await funnel.report({ step: 'borrow', stellarAddress: BOB, txid: TX(2) });
    await funnel.report({ step: 'repay', stellarAddress: BOB, txid: TX(2) });
    await funnel.report({ step: 'release', stellarAddress: BOB, txid: TX(2) });
    // Carol: social, paid, deposited, not borrowed yet.
    await funnel.report({ step: 'sign_in', stellarAddress: CAROL, channel: 'social' });
    funnel.recordFaucet(CAROL, 'paid');
    await funnel.report({ step: 'deposit', stellarAddress: CAROL, channel: 'social', txid: TX(3) });

    const s = funnel.summary();
    expect(s.headline).toEqual({ activatedSocialUsers: 1, socialUsersWithDeposit: 2 });
    expect(s.totals).toEqual({ sign_in: 2, key_created: 1, faucet_paid: 2, deposit: 3, borrow: 2, repay: 1, release: 1 });
    expect(s.social).toEqual({ sign_in: 2, key_created: 1, faucet_paid: 2, deposit: 2, borrow: 1, repay: 0, release: 0 });
    expect(s.daily).toEqual([
      { day: '2026-10-25', sign_in: 1, key_created: 1, faucet_paid: 1, deposit: 1, borrow: 1, repay: 0, release: 0 },
      { day: '2026-10-26', sign_in: 1, key_created: 0, faucet_paid: 1, deposit: 2, borrow: 1, repay: 1, release: 1 },
    ]);
    expect(s.contract).toBe('CWRITZLEND');
    expect(s.network).toBe('testnet');
    expect(JSON.stringify(s)).not.toContain(ALICE);
  });
});

describe('HTTP', () => {
  function app(positions: Record<string, PositionFacts> = {}) {
    const { funnel } = setup(positions);
    const a = express();
    a.use(express.json());
    a.use('/metrics/onboarding', createOnboardingRouter({ funnel, rateLimit: 3, rateWindowMs: 60_000, now: () => 0 }));
    a.use('/faucet', createFaucetRouter({ faucet: undefined, disabledReason: 'off', rateLimit: 10, rateWindowMs: 60_000, onClaim: (s, o) => funnel.recordFaucet(s, o) }));
    return a;
  }

  test('POST /events records, GET summarizes, errors carry their code', async () => {
    const a = app({ [TX(1)]: active(ALICE) });
    await request(a).post('/metrics/onboarding/events').send({ step: 'sign_in', stellarAddress: ALICE, channel: 'social' }).expect(202, { recorded: true, verified: false });
    await request(a).post('/metrics/onboarding/events').send({ step: 'deposit', stellarAddress: ALICE, txid: TX(1) }).expect(202, { recorded: true, verified: true });
    const bad = await request(a).post('/metrics/onboarding/events').send({ step: 'borrow', stellarAddress: ALICE, txid: TX(1) });
    expect(bad.status).toBe(422);
    expect(bad.body.error).toBe('step_not_reached');
    const limited = await request(a).post('/metrics/onboarding/events').send({ step: 'sign_in', stellarAddress: BOB });
    expect(limited.status).toBe(429);

    const s = await request(a).get('/metrics/onboarding').expect(200);
    expect(s.body.totals.sign_in).toBe(1);
    expect(s.body.totals.deposit).toBe(1);
    expect(s.body.headline).toEqual({ activatedSocialUsers: 0, socialUsersWithDeposit: 0 });
  });

  test('the faucet route reports a claim against a disabled faucet', async () => {
    const a = app();
    await request(a).post('/faucet/signet').send({ stellarAddress: ALICE }).expect(503);
    const s = await request(a).get('/metrics/onboarding').expect(200);
    expect(s.body.faucetOutcomes).toEqual({ faucet_disabled: 1 });
    expect(s.body.totals.faucet_paid).toBe(0);
  });
});
