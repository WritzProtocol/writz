/**
 * CCTP relay: message decoding and the route check, the Iris lookup, every
 * status transition, idempotency, a nonce already spent, restarts, the caps
 * and the HTTP surface. Base Sepolia is a fake `RelayChain` and Iris a fake
 * fetch; the message fixture is the real one Circle signed for a 10 USDC
 * Stellar testnet burn to Base Sepolia.
 */
import express from 'express';
import request from 'supertest';
import {
  assertRelayable,
  decodeBurnMessage,
  MessageRefusedError,
  BASE_SEPOLIA_TOKEN_MESSENGER,
} from '../src/cctp/message.js';
import { fetchIrisMessage, IrisError } from '../src/cctp/iris.js';
import { SendError, type MintLog, type ReceiptOutcome, type RelayChain, type SimulateOutcome } from '../src/cctp/chain.js';
import { MemoryRelayStore, lookupCctpRelay, type RelayRecord } from '../src/cctp/store.js';
import {
  CctpRelay,
  MINT_LOOKUP_ATTEMPTS,
  RelayError,
  RETRY_GIVE_UP_MS,
  RETRY_INITIAL_MS,
  RETRY_MAX_MS,
  retryDelayMs,
  type RelaySettings,
} from '../src/cctp/service.js';
import { findMintOnIndexer, IndexerError, MESSAGE_RECEIVED_TOPIC } from '../src/cctp/indexer.js';
import { toEventSelector } from 'viem';
import { createCctpRouter } from '../src/routes/cctp.js';

/** Stellar testnet burn 246bc8d7...9c62, as Iris serves it. */
const BURN = '246bc8d7afaf7810738c6e3267bd82ad15980e21c995de37bd4798a0a6bf9c62';
const MESSAGE =
  '0x000000010000001b0000000636d735f4953feae0fae54c26182d3525f906f665eb913bc29cf794d7277ab6b7da6f9ee0786c812344d82817ef19b648b4af120f8bd10bf658e6b99eacff24b80000000000000000000000008fe6b999dc680ccfdd5bf7eb0974218be2542daa0000000000000000000000000000000000000000000000000000000000000000000007d0000007d0000000015045cd5ec0729a768fd5ad02505852df4f028dce830e5ac52209ba48483b2f01000000000000000000000000c766579fe25474e41f612dd345772a61325878d20000000000000000000000000000000000000000000000000000000000989680519c86016d31b18436a8decdbda330b42e9c4beb84a292e5c4e7c26045323cb3000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
const ATTESTATION =
  '0xbc5ca974aba197077b45042a0a6294708a8b93a5e14a14792909dd748848e11b72afbc5cfba2cb658b5135692e078e8039b9be9457a1cc0f4ff1395027be37e61b418e978da96197716aa8dcf9e774c8c9cd62c25ef4b4423d763da8b25c5a7ea769a6b1f6d03cf964f953bb2c23887c159ec93bfd4c5d58872851a72c3529361e1c';
const NONCE = '0x36d735f4953feae0fae54c26182d3525f906f665eb913bc29cf794d7277ab6b7';
const RECIPIENT = '0xc766579fe25474e41f612dd345772a61325878d2';
const RELAY_ADDRESS = '0x1111111111111111111111111111111111111111';
const MINT_TX = `0x${'ab'.repeat(32)}`;
const OTHER_TX = `0x${'cd'.repeat(32)}`;
const IRIS = 'https://iris.test';

/** Overwrites `hex` bytes at byte offset `at` of the message (header offsets; the body starts at 148). */
function patch(message: string, at: number, hex: string): string {
  const raw = message.slice(2);
  return `0x${raw.slice(0, at * 2)}${hex}${raw.slice(at * 2 + hex.length)}`;
}

describe('decodeBurnMessage', () => {
  test('decodes the signed message of a real Stellar to Base Sepolia burn', () => {
    const m = decodeBurnMessage(MESSAGE);
    expect(m.version).toBe(1);
    expect(m.sourceDomain).toBe(27);
    expect(m.destinationDomain).toBe(6);
    expect(m.nonce).toBe(NONCE);
    expect(m.recipient).toBe(`0x${'0'.repeat(24)}${BASE_SEPOLIA_TOKEN_MESSENGER.slice(2).toLowerCase()}`);
    expect(m.destinationCaller).toBe(`0x${'0'.repeat(64)}`);
    expect(m.minFinalityThreshold).toBe(2000);
    expect(m.finalityThresholdExecuted).toBe(2000);
    expect(m.body.version).toBe(1);
    expect(m.body.mintRecipient).toBe(`0x${'0'.repeat(24)}${RECIPIENT.slice(2)}`);
    expect(m.body.amount).toBe('10000000');
    expect(m.body.maxFee).toBe('0');
    expect(m.body.feeExecuted).toBe('0');
    expect(m.body.expirationBlock).toBe('0');
    expect(m.body.hookData).toBe('0x');
  });

  test('refuses a message that is too short or not hex', () => {
    expect(() => decodeBurnMessage(MESSAGE.slice(0, 300))).toThrow(MessageRefusedError);
    expect(() => decodeBurnMessage('0xzz')).toThrow(MessageRefusedError);
  });
});

describe('assertRelayable', () => {
  test('accepts the real burn and returns its Base Sepolia recipient', () => {
    const { mintRecipient, message } = assertRelayable(MESSAGE);
    expect(mintRecipient).toBe(RECIPIENT);
    expect(message.nonce).toBe(NONCE);
  });

  test.each([
    ['a V1 message', patch(MESSAGE, 0, '00000000'), /not a CCTP V2 burn/],
    ['a V1 burn body', patch(MESSAGE, 148, '00000000'), /not a CCTP V2 burn/],
    ['a burn from Ethereum (domain 0)', patch(MESSAGE, 4, '00000000'), /not sent from Stellar/],
    ['a burn to Arbitrum (domain 3)', patch(MESSAGE, 8, '00000003'), /not addressed to Base Sepolia/],
    ['a message to another contract', patch(MESSAGE, 76 + 12, 'ee'.repeat(20)), /TokenMessenger/],
    ['a message only a named caller may complete', patch(MESSAGE, 108 + 12, '22'.repeat(20)), /names its own caller/],
    ['a burn with a hook', `${MESSAGE}deadbeef`, /hook/],
    ['a non-EVM recipient', patch(MESSAGE, 148 + 36, 'ff'), /not a Base Sepolia address/],
    ['the zero recipient', patch(MESSAGE, 148 + 36 + 12, '00'.repeat(20)), /not a Base Sepolia address/],
    ['a zero amount', patch(MESSAGE, 148 + 68, '00'.repeat(32)), /amount is zero/],
  ])('refuses %s', (_label, message, reason) => {
    expect(() => assertRelayable(message)).toThrow(reason);
  });
});

function irisResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? 'not found' : JSON.stringify(body), { status });
}
const complete = (message = MESSAGE) =>
  irisResponse(200, { messages: [{ status: 'complete', message, attestation: ATTESTATION }] });
const pending = () => irisResponse(200, { messages: [{ status: 'pending_confirmations', message: '0x', attestation: 'PENDING' }] });

describe('fetchIrisMessage', () => {
  test('reads 404 as unknown, a pending message as pending, and a signed one as complete', async () => {
    const urls: string[] = [];
    const responses = [irisResponse(404), pending(), complete()];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return responses.shift()!;
    }) as unknown as typeof fetch;
    expect(await fetchIrisMessage(IRIS, BURN.toUpperCase(), fetchImpl)).toEqual({ state: 'unknown' });
    expect(await fetchIrisMessage(IRIS, BURN, fetchImpl)).toEqual({ state: 'pending' });
    expect(await fetchIrisMessage(IRIS, BURN, fetchImpl)).toEqual({ state: 'complete', message: MESSAGE, attestation: ATTESTATION });
    expect(urls[0]).toBe(`${IRIS}/v2/messages/27?transactionHash=${BURN}`);
  });

  test('throws IrisError on a server error or a network failure', async () => {
    const down = (async () => irisResponse(503, {})) as unknown as typeof fetch;
    await expect(fetchIrisMessage(IRIS, BURN, down)).rejects.toThrow(IrisError);
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(fetchIrisMessage(IRIS, BURN, offline)).rejects.toThrow(IrisError);
  });
});

/** Base Sepolia as the relay sees it: MessageTransmitterV2 spends each nonce once. */
class FakeChain implements RelayChain {
  readonly address = RELAY_ADDRESS;
  used = new Map<string, MintLog>();
  sends: string[] = [];
  simulations = 0;
  balance = 10n ** 17n;
  simulateResult: SimulateOutcome | undefined;
  sendError: Error | undefined;
  receipts: ReceiptOutcome[] = [];
  /** Runs when `sendReceive` is called, before it returns: a competing mint, a crash. */
  onSend: (() => void) | undefined;

  async balanceWei() {
    return this.balance;
  }
  async isNonceUsed(nonce: string) {
    return this.used.has(nonce);
  }
  async findMint(nonce: string) {
    return this.used.get(nonce);
  }
  async simulateReceive(): Promise<SimulateOutcome> {
    this.simulations += 1;
    return this.simulateResult ?? { ok: true };
  }
  async sendReceive(message: string) {
    if (this.sendError) throw this.sendError;
    this.onSend?.();
    this.sends.push(message);
    const tx = this.sends.length === 1 ? MINT_TX : `0x${String(this.sends.length).padStart(64, '0')}`;
    const nonce = decodeBurnMessage(message).nonce;
    if (!this.used.has(nonce)) this.used.set(nonce, { txHash: tx, caller: RELAY_ADDRESS });
    return tx;
  }
  async waitForReceipt(): Promise<ReceiptOutcome> {
    return this.receipts.shift() ?? 'success';
  }
}

const SETTINGS: RelaySettings = {
  irisUrl: IRIS,
  confirmTimeoutMs: 30 * 60_000,
  dailyCap: 5,
  maxOpen: 10,
  pollInitialMs: 3_000,
  pollMaxMs: 30_000,
};

let t: number;
const INDEXER = 'https://indexer.test/api';

/** What the fake indexer answers; every call's URL is kept. */
interface FakeIndexer {
  calls: string[];
  reply: () => Response;
}

function setup(irisReplies: (() => Response)[] = [complete], settings: Partial<RelaySettings> = {}, store = new MemoryRelayStore(), chain = new FakeChain()) {
  const states: string[] = [];
  const replies = [...irisReplies];
  const indexer: FakeIndexer = { calls: [], reply: () => irisResponse(200, { status: '0', message: 'No logs found', result: [] }) };
  const fetchImpl = (async (url: string) => {
    if (url.startsWith(INDEXER)) {
      indexer.calls.push(url);
      return indexer.reply();
    }
    states.push(store.get(BURN)?.state ?? 'none');
    const next = replies.length > 1 ? replies.shift()! : replies[0];
    return next();
  }) as unknown as typeof fetch;
  const relay = new CctpRelay({
    chain,
    store,
    settings: { ...SETTINGS, ...settings },
    fetchImpl,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    log: () => {},
  });
  return { relay, chain, store, states, indexer };
}

/** Parks a relay's jobs at their first Iris backoff, so a test can hold transfers in flight without the clock moving. */
function stall(relay: CctpRelay): CctpRelay {
  (relay as unknown as { sleep: (ms: number) => Promise<void> }).sleep = () => new Promise(() => {});
  return relay;
}

beforeEach(() => {
  t = Date.UTC(2026, 9, 25, 12, 0, 0);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('CctpRelay', () => {
  test('goes sent, confirming, confirmed, arrived, and records the mint and what was minted', async () => {
    const { relay, chain, store, states } = setup([() => irisResponse(404), pending, complete]);
    expect(relay.request(BURN)).toMatchObject({ burnHash: BURN, kind: 'sent' });
    await relay.idle();

    // Iris was asked while the record was sent, then confirming, then it answered complete.
    expect(states).toEqual(['sent', 'sent', 'confirming']);
    expect(chain.sends).toEqual([MESSAGE]);
    const view = relay.status(BURN);
    expect(view).toMatchObject({
      kind: 'arrived',
      mintHash: MINT_TX,
      explorerUrl: `https://sepolia.basescan.org/tx/${MINT_TX}`,
      recipient: RECIPIENT,
      amount: '10000000',
      feeExecuted: '0',
      mintedBy: 'relay',
    });
    expect(store.get(BURN)).toMatchObject({ nonce: NONCE, submittedAt: expect.any(Number), retryable: false });
  });

  test('reports confirmed while the mint is being sent and mined', async () => {
    const { relay, chain } = setup();
    let seen: string | undefined;
    chain.waitForReceipt = async () => {
      seen = relay.status(BURN).kind;
      return 'success';
    };
    relay.request(BURN);
    await relay.idle();
    expect(seen).toBe('confirmed');
    expect(relay.status(BURN).kind).toBe('arrived');
  });

  test('is idempotent: repeated and concurrent requests send one mint', async () => {
    const { relay, chain } = setup();
    relay.request(BURN);
    relay.request(BURN.toUpperCase());
    relay.request(` ${BURN} `);
    await relay.idle();
    expect(relay.request(BURN).kind).toBe('arrived');
    await relay.idle();
    expect(chain.sends).toHaveLength(1);
    expect(chain.simulations).toBe(1);
  });

  test('does not send when the nonce is already spent, and links the mint that spent it', async () => {
    const { relay, chain } = setup();
    chain.used.set(NONCE, { txHash: OTHER_TX, caller: '0x9999999999999999999999999999999999999999' });
    relay.request(BURN);
    await relay.idle();
    expect(chain.sends).toHaveLength(0);
    expect(chain.simulations).toBe(0);
    expect(relay.status(BURN)).toMatchObject({ kind: 'arrived', mintHash: OTHER_TX, mintedBy: 'other' });
  });

  test('reports arrived with a null mint hash when the spending transaction is out of the search range', async () => {
    const { relay, chain } = setup();
    chain.used.set(NONCE, { txHash: OTHER_TX, caller: '0x9999999999999999999999999999999999999999' });
    chain.findMint = async () => undefined;
    relay.request(BURN);
    await relay.idle();
    const view = relay.status(BURN);
    expect(view).toMatchObject({ kind: 'arrived', mintHash: null, mintedBy: 'other' });
    expect(view.explorerUrl).toBeUndefined();
  });

  test('treats a "Nonce already used" revert in the simulation as arrived', async () => {
    const { relay, chain } = setup();
    chain.simulateReceive = async () => {
      chain.used.set(NONCE, { txHash: OTHER_TX, caller: '0x9999999999999999999999999999999999999999' });
      return { ok: false, transient: false, revert: 'Nonce already used', detail: 'reverted' };
    };
    relay.request(BURN);
    await relay.idle();
    expect(chain.sends).toHaveLength(0);
    expect(relay.status(BURN)).toMatchObject({ kind: 'arrived', mintHash: OTHER_TX });
  });

  test('treats its own mint reverting behind a competing one as arrived', async () => {
    const { relay, chain } = setup();
    chain.onSend = () => chain.used.set(NONCE, { txHash: OTHER_TX, caller: '0x9999999999999999999999999999999999999999' });
    chain.receipts = ['reverted'];
    relay.request(BURN);
    await relay.idle();
    expect(relay.status(BURN)).toMatchObject({ kind: 'arrived', mintHash: OTHER_TX, mintedBy: 'other' });
  });

  test('refuses a signed message that is not Stellar to Base Sepolia, before any chain call', async () => {
    const { relay, chain } = setup([() => complete(patch(MESSAGE, 8, '00000003'))]);
    relay.request(BURN);
    await relay.idle();
    expect(chain.simulations).toBe(0);
    expect(chain.sends).toHaveLength(0);
    const view = relay.status(BURN);
    expect(view.kind).toBe('failed');
    expect(view.reason).toMatch(/not addressed to Base Sepolia/);

    // Refused stays refused: asking again does not reopen it.
    expect(relay.request(BURN).kind).toBe('failed');
    await relay.idle();
    expect(chain.simulations).toBe(0);
  });

  test('fails without retry when Base Sepolia refuses the mint in the simulation', async () => {
    const { relay, chain } = setup();
    chain.simulateResult = { ok: false, transient: false, revert: 'Invalid signature', detail: 'reverted' };
    relay.request(BURN);
    await relay.idle();
    expect(relay.status(BURN)).toMatchObject({ kind: 'failed', reason: 'Base Sepolia refused the mint: Invalid signature' });
    relay.request(BURN);
    await relay.idle();
    expect(chain.simulations).toBe(1);
    expect(chain.sends).toHaveLength(0);
  });

  test('retries an out-of-gas mint by itself once the account is refilled, reporting confirmed and retrying meanwhile', async () => {
    const { relay, chain, store } = setup();
    chain.sendError = new SendError('insufficient_funds', 'insufficient funds for gas');
    relay.request(BURN);
    await relay.idle();
    const first = t;
    expect(relay.status(BURN)).toMatchObject({
      kind: 'confirmed',
      retrying: true,
      reason: expect.stringMatching(/out of Base Sepolia gas/),
      nextRetryAt: new Date(first + RETRY_INITIAL_MS).toISOString(),
    });
    expect(store.get(BURN)).toMatchObject({ state: 'failed', failureCode: 'out_of_gas', attempts: 1, retryingSince: first });

    // Not due yet: neither a sweep nor a repeated POST sends anything.
    expect(relay.retryDue()).toBe(0);
    expect(relay.request(BURN)).toMatchObject({ kind: 'confirmed', retrying: true });
    await relay.idle();
    expect(chain.simulations).toBe(1);

    // Due, but the account is still empty: no simulation, rescheduled with a longer backoff.
    chain.balance = 0n;
    t += RETRY_INITIAL_MS;
    expect(relay.retryDue()).toBe(1);
    await relay.idle();
    expect(chain.simulations).toBe(1);
    expect(store.get(BURN)).toMatchObject({ failureCode: 'out_of_gas', attempts: 2, retryAt: t + 2 * RETRY_INITIAL_MS });

    // Refilled: the next poll of the status runs the retry, and it mints once.
    chain.balance = 10n ** 17n;
    chain.sendError = undefined;
    t += 2 * RETRY_INITIAL_MS;
    // The poll answers at once (the balance check runs in the background) and starts the retry.
    expect(relay.status(BURN)).toMatchObject({ kind: 'confirmed', retrying: true });
    await relay.idle();
    expect(relay.status(BURN)).toMatchObject({ kind: 'arrived', mintHash: MINT_TX });
    expect(chain.sends).toHaveLength(1);
    expect(store.get(BURN)).toMatchObject({ retryable: false });
    expect(store.get(BURN)?.retryAt).toBeUndefined();
    expect(store.get(BURN)?.attempts).toBeUndefined();
  });

  test('a balance that cannot be read keeps an out-of-gas transfer waiting', async () => {
    const { relay, chain, store } = setup();
    chain.sendError = new SendError('insufficient_funds', 'insufficient funds for gas');
    relay.request(BURN);
    await relay.idle();
    chain.balanceWei = async () => {
      throw new Error('rpc down');
    };
    t += RETRY_INITIAL_MS;
    relay.retryDue();
    await relay.idle();
    expect(chain.simulations).toBe(1);
    expect(store.get(BURN)).toMatchObject({ failureCode: 'out_of_gas', attempts: 2 });
  });

  test('gives up on a burn Iris never heard of after ten minutes, without spending gas', async () => {
    const { relay, chain } = setup([() => irisResponse(404)]);
    relay.request(BURN);
    await relay.idle();
    const view = relay.status(BURN);
    expect(view.kind).toBe('failed');
    expect(view.reason).toMatch(/Circle has no record of this burn/);
    expect(view.reason).not.toMatch(/attestation/i);
    expect(chain.simulations).toBe(0);
  });

  test('keeps waiting on a burn Circle has not confirmed within the window, then mints once it does', async () => {
    const delays: number[] = [];
    let signed = false;
    const { relay, chain, store } = setup([() => (signed ? complete() : pending())]);
    const start = t;
    (relay as unknown as { sleep: (ms: number) => Promise<void> }).sleep = async (ms) => {
      delays.push(ms);
      t += ms;
    };
    relay.request(BURN);
    await relay.idle();
    expect(t - start).toBeGreaterThanOrEqual(SETTINGS.confirmTimeoutMs);
    expect(delays.slice(0, 5)).toEqual([3_000, 6_000, 12_000, 24_000, 30_000]);
    // Circle has not signed: still confirming, not a dead end.
    expect(relay.status(BURN)).toMatchObject({ kind: 'confirming', retrying: true, reason: expect.stringMatching(/not confirmed the transfer yet/) });
    expect(store.get(BURN)?.failureCode).toBe('confirm_timeout');

    signed = true;
    t += RETRY_INITIAL_MS;
    expect(relay.retryDue()).toBe(1);
    await relay.idle();
    expect(relay.status(BURN)).toMatchObject({ kind: 'arrived', mintHash: MINT_TX });
    expect(chain.sends).toHaveLength(1);
  });

  test('keeps polling through Iris errors', async () => {
    const { relay } = setup([() => irisResponse(500, {}), () => irisResponse(502, {}), complete]);
    relay.request(BURN);
    await relay.idle();
    expect(relay.status(BURN).kind).toBe('arrived');
  });

  test('waits at the daily mint cap and resumes after 00:00 UTC', async () => {
    const store = new MemoryRelayStore();
    for (let i = 0; i < SETTINGS.dailyCap; i++) {
      store.put({ burnHash: String(i).padStart(64, 'e'), state: 'arrived', retryable: false, createdAt: t, updatedAt: t, submittedAt: t });
    }
    const { relay, chain } = setup([complete], {}, store);
    relay.request(BURN);
    await relay.idle();
    expect(chain.sends).toHaveLength(0);
    const midnight = Date.UTC(2026, 9, 26);
    expect(relay.status(BURN)).toMatchObject({
      kind: 'confirmed',
      retrying: true,
      reason: expect.stringMatching(/daily limit of 5/),
      nextRetryAt: new Date(midnight).toISOString(),
    });

    t = midnight - 1;
    expect(relay.retryDue()).toBe(0);
    t = midnight;
    expect(relay.retryDue()).toBe(1);
    await relay.idle();
    expect(relay.status(BURN)).toMatchObject({ kind: 'arrived', mintHash: MINT_TX });
    expect(chain.sends).toHaveLength(1);
  });

  test('refuses new transfers beyond the in-flight limit', () => {
    const { relay } = setup([pending], { maxOpen: 1 });
    stall(relay);
    relay.request(BURN);
    expect(() => relay.request('f'.repeat(64))).toThrow(RelayError);
    // The transfer already in flight is still answered.
    expect(relay.request(BURN).kind).toBe('sent');
  });

  test('rejects a burn hash that is not 64 hex characters', () => {
    const { relay } = setup();
    for (const bad of [undefined, 42, '', 'xyz', BURN.slice(1), `0x${BURN}`]) {
      expect(() => relay.request(bad)).toThrow(expect.objectContaining({ code: 'invalid_burn_hash' }));
    }
    expect(() => relay.status('0'.repeat(64))).toThrow(expect.objectContaining({ code: 'not_found' }));
  });

  test('a restart resumes a mint the previous process broadcast, without sending again', async () => {
    const store = new MemoryRelayStore();
    const before: RelayRecord = {
      burnHash: BURN,
      state: 'submitted',
      nonce: NONCE,
      recipient: RECIPIENT,
      amount: '10000000',
      message: MESSAGE,
      attestation: ATTESTATION,
      mintHash: MINT_TX,
      mintedBy: 'relay',
      retryable: false,
      createdAt: t,
      updatedAt: t,
      submittedAt: t,
    };
    store.put(before);
    const { relay, chain } = setup([complete], {}, store);
    expect(relay.resume()).toBe(1);
    await relay.idle();
    expect(chain.sends).toHaveLength(0);
    expect(relay.status(BURN)).toMatchObject({ kind: 'arrived', mintHash: MINT_TX, mintedBy: 'relay' });
  });

  test('a restart after a broadcast whose hash was never recorded finds the mint by its nonce', async () => {
    const store = new MemoryRelayStore();
    store.put({
      burnHash: BURN, state: 'confirmed', nonce: NONCE, message: MESSAGE, attestation: ATTESTATION,
      retryable: false, createdAt: t, updatedAt: t,
    });
    const chain = new FakeChain();
    chain.used.set(NONCE, { txHash: MINT_TX, caller: RELAY_ADDRESS });
    const { relay } = setup([complete], {}, store, chain);
    relay.resume();
    await relay.idle();
    expect(chain.sends).toHaveLength(0);
    expect(relay.status(BURN)).toMatchObject({ kind: 'arrived', mintHash: MINT_TX, mintedBy: 'relay' });
  });

  test('lookupCctpRelay reads a transfer by burn hash for the timeline', async () => {
    const { relay, store } = setup();
    expect(lookupCctpRelay(store, BURN)).toBeUndefined();
    relay.request(BURN);
    await relay.idle();
    expect(lookupCctpRelay(store, BURN.toUpperCase())).toMatchObject({ kind: 'arrived', mintHash: MINT_TX });
    expect(relay.lookup(BURN)).toEqual(lookupCctpRelay(store, BURN));
    expect(lookupCctpRelay(store, 'not-a-hash')).toBeUndefined();
  });

  test('info reports the relay address, its balance and the mints today', async () => {
    const { relay, chain } = setup();
    chain.balance = 10n ** 15n;
    relay.request(BURN);
    await relay.idle();
    expect(await relay.info()).toMatchObject({
      enabled: true,
      network: 'base-sepolia',
      address: RELAY_ADDRESS,
      balanceWei: '1000000000000000',
      lowBalance: true,
      mintsToday: 1,
      dailyCap: 5,
      inFlight: 0,
    });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('cctp_relay_low_balance'));
  });
});

/** A broadcast that does not spend the nonce (not mined yet, or reverted): the fake chain otherwise spends it on send. */
function unspentOnSend(chain: FakeChain): void {
  const send = chain.sendReceive.bind(chain);
  chain.sendReceive = async (message: string) => {
    const tx = await send(message);
    chain.used.delete(NONCE);
    return tx;
  };
}

describe('CctpRelay automatic retries', () => {
  test('backs off exponentially from 30 seconds to 15 minutes', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(retryDelayMs)).toEqual([
      30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000, 900_000,
    ]);
    expect(RETRY_MAX_MS).toBe(15 * 60_000);
  });

  test('an RPC outage in the simulation is retried with growing delays, and the mint goes out once it is back', async () => {
    const { relay, chain, store } = setup();
    chain.simulateResult = { ok: false, transient: true, detail: 'fetch failed' };
    relay.request(BURN);
    await relay.idle();
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = store.get(BURN)!;
      expect(r).toMatchObject({ state: 'failed', failureCode: 'rpc', attempts: i + 1 });
      seen.push(r.retryAt! - t);
      t = r.retryAt!;
      relay.retryDue();
      await relay.idle();
    }
    expect(seen).toEqual([30_000, 60_000, 120_000]);
    chain.simulateResult = undefined;
    t = store.get(BURN)!.retryAt!;
    relay.retryDue();
    await relay.idle();
    expect(relay.status(BURN)).toMatchObject({ kind: 'arrived', mintHash: MINT_TX });
    expect(chain.sends).toHaveLength(1);
  });

  test('a send that fails and a mint that is not mined in time are retried without a second broadcast', async () => {
    const { relay, chain, store } = setup();
    chain.sendError = new SendError('failed', 'nonce too low');
    relay.request(BURN);
    await relay.idle();
    expect(store.get(BURN)?.failureCode).toBe('send_failed');
    expect(relay.status(BURN)).toMatchObject({ kind: 'confirmed', retrying: true });

    // The retry broadcasts, but the receipt does not come within the wait.
    chain.sendError = undefined;
    unspentOnSend(chain);
    chain.receipts = ['pending', 'pending', 'pending', 'pending'];
    t = store.get(BURN)!.retryAt!;
    relay.retryDue();
    await relay.idle();
    expect(chain.sends).toHaveLength(1);
    expect(store.get(BURN)).toMatchObject({ failureCode: 'not_mined', mintHash: MINT_TX, mintedBy: 'relay' });

    // The next retry checks that broadcast first and finds it mined: nothing new is sent.
    t = store.get(BURN)!.retryAt!;
    relay.retryDue();
    await relay.idle();
    expect(chain.sends).toHaveLength(1);
    expect(relay.status(BURN)).toMatchObject({ kind: 'arrived', mintHash: MINT_TX, mintedBy: 'relay' });
  });

  test('a mint that reverted is retried, and a lasting refusal in the next simulation turns final', async () => {
    const { relay, chain, store } = setup();
    // Reverted when it lands, and still reverted when the retry checks it first.
    chain.receipts = ['reverted', 'reverted'];
    unspentOnSend(chain);
    relay.request(BURN);
    await relay.idle();
    expect(store.get(BURN)?.failureCode).toBe('reverted');
    expect(relay.status(BURN)).toMatchObject({ kind: 'confirmed', retrying: true });

    chain.simulateResult = { ok: false, transient: false, revert: 'Invalid attestation', detail: 'reverted' };
    t = store.get(BURN)!.retryAt!;
    relay.retryDue();
    await relay.idle();
    expect(relay.status(BURN)).toMatchObject({ kind: 'failed', reason: 'Base Sepolia refused the mint: Invalid attestation' });
    expect(relay.status(BURN).retrying).toBeUndefined();
    expect(store.get(BURN)).toMatchObject({ failureCode: 'mint_refused', retryable: false });
    expect(store.get(BURN)?.retryAt).toBeUndefined();
    expect(chain.sends).toHaveLength(1);
  });

  test('an unexpected error is retried like any transient failure', async () => {
    const { relay, chain, store } = setup();
    let broken = true;
    const used = chain.isNonceUsed.bind(chain);
    chain.isNonceUsed = async (nonce: string) => {
      if (broken) throw new Error('boom');
      return used(nonce);
    };
    relay.request(BURN);
    await relay.idle();
    expect(store.get(BURN)).toMatchObject({ state: 'failed', failureCode: 'unexpected', retryable: true });
    expect(relay.status(BURN)).toMatchObject({ kind: 'confirmed', retrying: true });
    broken = false;
    t = store.get(BURN)!.retryAt!;
    relay.retryDue();
    await relay.idle();
    expect(relay.status(BURN).kind).toBe('arrived');
  });

  test('final failures are never retried by themselves', async () => {
    // Refused by MessageTransmitterV2.
    const a = setup();
    a.chain.simulateResult = { ok: false, transient: false, revert: 'Message expired', detail: 'reverted' };
    a.relay.request(BURN);
    await a.relay.idle();
    t += RETRY_GIVE_UP_MS;
    expect(a.relay.retryDue()).toBe(0);
    expect(a.relay.status(BURN)).toMatchObject({ kind: 'failed', reason: expect.stringMatching(/Message expired/) });
    await a.relay.idle();
    expect(a.chain.simulations).toBe(1);

    // A burn Circle never reported: final until a new POST, which starts it over.
    const b = setup([() => irisResponse(404)]);
    b.relay.request(BURN);
    await b.relay.idle();
    expect(b.store.get(BURN)).toMatchObject({ failureCode: 'unseen', retryable: true });
    t += RETRY_GIVE_UP_MS;
    expect(b.relay.retryDue()).toBe(0);
    expect(b.relay.status(BURN).kind).toBe('failed');
    expect(b.relay.request(BURN).kind).toBe('sent');
  });

  test('gives up after 24 hours of transient failures, reports failed, and a new POST starts over', async () => {
    const { relay, chain, store } = setup();
    chain.simulateResult = { ok: false, transient: true, detail: 'fetch failed' };
    const start = t;
    relay.request(BURN);
    await relay.idle();
    let rounds = 0;
    while (store.get(BURN)!.retryAt !== undefined) {
      expect(relay.status(BURN).kind).toBe('confirmed');
      t = store.get(BURN)!.retryAt!;
      relay.retryDue();
      await relay.idle();
      rounds += 1;
      if (rounds > 500) throw new Error('never gave up');
    }
    expect(t - start).toBeGreaterThanOrEqual(RETRY_GIVE_UP_MS);
    expect(t - start).toBeLessThan(RETRY_GIVE_UP_MS + RETRY_MAX_MS + 1);
    const view = relay.status(BURN);
    expect(view).toMatchObject({ kind: 'failed', reason: expect.stringMatching(/stopped after 24 hours of retrying \(Base Sepolia could not be reached\)/) });
    expect(view.retrying).toBeUndefined();
    expect(store.get(BURN)).toMatchObject({ failureCode: 'gave_up', retryable: true });
    expect(chain.sends).toHaveLength(0);

    chain.simulateResult = undefined;
    expect(relay.request(BURN).kind).toBe('confirmed');
    await relay.idle();
    expect(relay.status(BURN)).toMatchObject({ kind: 'arrived', mintHash: MINT_TX });
    expect(store.get(BURN)?.retryingSince).toBeUndefined();
  });

  test('a due retry runs once however many polls and sweeps ask for it', async () => {
    const { relay, chain, store } = setup();
    chain.sendError = new SendError('failed', 'timeout');
    relay.request(BURN);
    await relay.idle();
    chain.sendError = undefined;
    t = store.get(BURN)!.retryAt!;
    relay.status(BURN);
    relay.status(BURN);
    relay.request(BURN);
    relay.retryDue();
    await relay.idle();
    expect(chain.sends).toHaveLength(1);
    expect(relay.status(BURN).kind).toBe('arrived');
  });

  test('a due retry waits while the relay is at its in-flight limit', async () => {
    const { relay, chain, store } = setup([complete], { maxOpen: 1 });
    chain.sendError = new SendError('failed', 'timeout');
    relay.request(BURN);
    await relay.idle();
    chain.sendError = undefined;
    // Another transfer holds the only slot.
    stall(relay);
    const other = 'f'.repeat(64);
    store.put({ burnHash: other, state: 'sent', retryable: false, createdAt: t, updatedAt: t });
    relay.resume();
    t = store.get(BURN)!.retryAt!;
    expect(relay.retryDue()).toBe(0);
    expect(relay.status(BURN)).toMatchObject({ kind: 'confirmed', retrying: true });
  });

  test('a restarted relay picks up a retry the previous process scheduled', async () => {
    const store = new MemoryRelayStore();
    store.put({
      burnHash: BURN, state: 'failed', nonce: NONCE, message: MESSAGE, attestation: ATTESTATION,
      failure: 'Base Sepolia could not be reached', failureCode: 'rpc', retryable: true,
      retryAt: t + 5_000, attempts: 1, retryingSince: t, createdAt: t, updatedAt: t,
    });
    const { relay, chain } = setup([complete], {}, store);
    expect(relay.resume()).toBe(0);
    expect(relay.retryDue()).toBe(0);
    t += 5_000;
    expect(relay.retryDue()).toBe(1);
    await relay.idle();
    expect(chain.sends).toHaveLength(1);
    expect(relay.status(BURN).kind).toBe('arrived');
  });

  test('the retry sweep runs on a timer and can be stopped', async () => {
    jest.useFakeTimers();
    try {
      const { relay } = setup();
      const spy = jest.spyOn(relay, 'retryDue');
      const stop = relay.startRetrySweep(1_000);
      jest.advanceTimersByTime(3_000);
      expect(spy).toHaveBeenCalledTimes(3);
      stop();
      jest.advanceTimersByTime(3_000);
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });
});

const OTHER_CALLER = '0x9999999999999999999999999999999999999999';
const pad32 = (addr: string) => `0x${'0'.repeat(24)}${addr.slice(2).toLowerCase()}`;
const TRANSMITTER = '0xe737e5cebeeba77efe34d4aa090756590b1ce275';
function indexerLog(overrides: Partial<{ address: string; topics: string[]; transactionHash: string }> = {}) {
  return {
    address: TRANSMITTER,
    topics: [MESSAGE_RECEIVED_TOPIC, pad32(OTHER_CALLER), NONCE, `0x${'0'.repeat(60)}07d0`],
    transactionHash: OTHER_TX,
    blockNumber: '0x2fc5068',
    ...overrides,
  };
}
const indexerOk = (logs: unknown[]) => () => irisResponse(200, { status: logs.length ? '1' : '0', message: logs.length ? 'OK' : 'No logs found', result: logs });

describe('mint hash: RPC first, then the indexer', () => {
  function spentElsewhere(settings: Partial<RelaySettings> = { mintIndexerUrl: INDEXER }) {
    const ctx = setup([complete], settings);
    ctx.chain.used.set(NONCE, { txHash: OTHER_TX, caller: OTHER_CALLER });
    ctx.chain.findMint = async () => undefined;
    return ctx;
  }

  test('finds through the indexer a mint older than the RPC window', async () => {
    const { relay, indexer, store } = spentElsewhere();
    indexer.reply = indexerOk([indexerLog()]);
    relay.request(BURN);
    await relay.idle();
    expect(relay.status(BURN)).toMatchObject({
      kind: 'arrived',
      mintHash: OTHER_TX,
      explorerUrl: `https://sepolia.basescan.org/tx/${OTHER_TX}`,
      mintedBy: 'other',
    });
    expect(store.get(BURN)?.retryAt).toBeUndefined();
    expect(indexer.calls).toHaveLength(1);
  });

  test('recognises a mint of its own found by the indexer', async () => {
    const { relay, indexer } = spentElsewhere();
    indexer.reply = indexerOk([indexerLog({ topics: [MESSAGE_RECEIVED_TOPIC, pad32(RELAY_ADDRESS), NONCE] })]);
    relay.request(BURN);
    await relay.idle();
    expect(relay.status(BURN)).toMatchObject({ kind: 'arrived', mintHash: OTHER_TX, mintedBy: 'relay' });
  });

  test('does not ask the indexer when the RPC finds the mint', async () => {
    const { relay, chain, indexer } = setup([complete], { mintIndexerUrl: INDEXER });
    chain.used.set(NONCE, { txHash: OTHER_TX, caller: OTHER_CALLER });
    relay.request(BURN);
    await relay.idle();
    expect(relay.status(BURN)).toMatchObject({ mintHash: OTHER_TX });
    expect(indexer.calls).toHaveLength(0);
  });

  test('asks the indexer when the RPC search throws', async () => {
    const { relay, chain, indexer } = spentElsewhere();
    chain.findMint = async () => {
      throw new Error('rpc down');
    };
    indexer.reply = indexerOk([indexerLog()]);
    relay.request(BURN);
    await relay.idle();
    expect(relay.status(BURN)).toMatchObject({ kind: 'arrived', mintHash: OTHER_TX });
  });

  test.each([
    ['another contract', { address: '0x' + '12'.repeat(20) }],
    ['another event', { topics: [`0x${'aa'.repeat(32)}`, pad32(OTHER_CALLER), NONCE] }],
    ['another nonce', { topics: [MESSAGE_RECEIVED_TOPIC, pad32(OTHER_CALLER), `0x${'77'.repeat(32)}`] }],
    ['a malformed transaction hash', { transactionHash: '0x1234' }],
  ])('ignores an indexer log from %s', async (_label, override) => {
    const { relay, indexer } = spentElsewhere();
    indexer.reply = indexerOk([indexerLog(override as Partial<{ address: string; topics: string[]; transactionHash: string }>)]);
    relay.request(BURN);
    await relay.idle();
    expect(relay.status(BURN)).toMatchObject({ kind: 'arrived', mintHash: null });
  });

  test('with both sources failing it reports arrived with a null hash and fills it in on a later search', async () => {
    const { relay, indexer, store } = spentElsewhere();
    indexer.reply = () => irisResponse(502, {});
    relay.request(BURN);
    await relay.idle();
    expect(relay.status(BURN)).toMatchObject({ kind: 'arrived', mintHash: null, mintedBy: 'other' });
    expect(store.get(BURN)?.retryAt).toBe(t + RETRY_INITIAL_MS);

    // Not due: a poll does not search again.
    relay.status(BURN);
    await relay.idle();
    expect(indexer.calls).toHaveLength(1);

    // Due: the next poll searches again, and the indexer is back.
    indexer.reply = indexerOk([indexerLog()]);
    t += RETRY_INITIAL_MS;
    relay.status(BURN);
    await relay.idle();
    expect(relay.status(BURN)).toMatchObject({ kind: 'arrived', mintHash: OTHER_TX, mintedBy: 'other' });
    expect(store.get(BURN)?.retryAt).toBeUndefined();
  });

  test('stops searching for the hash after a bounded number of attempts', async () => {
    const { relay, indexer, store } = spentElsewhere();
    indexer.reply = () => irisResponse(503, {});
    relay.request(BURN);
    await relay.idle();
    let searches = 0;
    while (store.get(BURN)?.retryAt !== undefined) {
      t = store.get(BURN)!.retryAt!;
      expect(relay.retryDue()).toBe(1);
      await relay.idle();
      searches += 1;
    }
    expect(searches).toBe(MINT_LOOKUP_ATTEMPTS);
    expect(indexer.calls).toHaveLength(MINT_LOOKUP_ATTEMPTS + 1);
    expect(relay.status(BURN)).toMatchObject({ kind: 'arrived', mintHash: null });
  });

  test('without an indexer configured only the RPC is searched', async () => {
    const { relay, indexer } = spentElsewhere({});
    relay.request(BURN);
    await relay.idle();
    expect(relay.status(BURN)).toMatchObject({ kind: 'arrived', mintHash: null });
    expect(indexer.calls).toHaveLength(0);
  });
});

describe('findMintOnIndexer', () => {
  const fetchOf = (reply: () => Response, urls: string[] = []) =>
    (async (url: string) => {
      urls.push(url);
      return reply();
    }) as unknown as typeof fetch;

  test('MESSAGE_RECEIVED_TOPIC is the selector of the MessageTransmitterV2 event', () => {
    expect(MESSAGE_RECEIVED_TOPIC).toBe(toEventSelector('MessageReceived(address,uint32,bytes32,bytes32,uint32,bytes)'));
  });

  test('queries the logs of MessageTransmitterV2 by event and nonce over the whole chain', async () => {
    const urls: string[] = [];
    const found = await findMintOnIndexer(`${INDEXER}/`, NONCE.toUpperCase().replace('0X', '0x'), fetchOf(indexerOk([indexerLog()]), urls));
    expect(found).toEqual({ txHash: OTHER_TX, caller: OTHER_CALLER });
    const url = new URL(urls[0]);
    expect(`${url.origin}${url.pathname}`).toBe(INDEXER);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      module: 'logs',
      action: 'getLogs',
      address: TRANSMITTER,
      fromBlock: '0',
      toBlock: 'latest',
      topic0: MESSAGE_RECEIVED_TOPIC,
      topic2: NONCE,
      topic0_2_opr: 'and',
    });
  });

  test('skips logs that do not match and returns the first that does', async () => {
    const found = await findMintOnIndexer(
      INDEXER,
      NONCE,
      fetchOf(indexerOk([indexerLog({ address: '0x' + '12'.repeat(20) }), indexerLog({ transactionHash: MINT_TX })])),
    );
    expect(found?.txHash).toBe(MINT_TX);
  });

  test('answers undefined for "No logs found"', async () => {
    expect(await findMintOnIndexer(INDEXER, NONCE, fetchOf(indexerOk([])))).toBeUndefined();
  });

  test('throws IndexerError when the indexer cannot answer', async () => {
    await expect(findMintOnIndexer(INDEXER, NONCE, fetchOf(() => irisResponse(429, {})))).rejects.toThrow(IndexerError);
    await expect(
      findMintOnIndexer(INDEXER, NONCE, fetchOf(() => irisResponse(200, { status: '0', message: 'NOTOK', result: 'Max rate limit reached' }))),
    ).rejects.toThrow(/Max rate limit|NOTOK/);
    await expect(findMintOnIndexer(INDEXER, NONCE, fetchOf(() => new Response('<html>', { status: 200 })))).rejects.toThrow(IndexerError);
    const offline = (async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    }) as unknown as typeof fetch;
    await expect(findMintOnIndexer(INDEXER, NONCE, offline)).rejects.toThrow(/timed out/);
    await expect(findMintOnIndexer(INDEXER, 'nope', fetchOf(indexerOk([])))).rejects.toThrow(IndexerError);
  });

  test('passes an abort signal so a slow indexer is cut off', async () => {
    let signal: AbortSignal | undefined;
    const spy = (async (_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return indexerOk([])();
    }) as unknown as typeof fetch;
    await findMintOnIndexer(INDEXER, NONCE, spy, 50);
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

function appFor(relay: CctpRelay | undefined, rateLimit = 100) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/cctp', createCctpRouter({ relay, disabledReason: 'no relay key is configured', rateLimit, rateWindowMs: 60_000, now: () => t }));
  return app;
}

describe('/cctp/relay routes', () => {
  test('without a key: GET reports disabled, POST and the transfer GET answer 503', async () => {
    const app = appFor(undefined);
    const status = await request(app).get('/cctp/relay');
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ enabled: false, network: 'base-sepolia', reason: 'no relay key is configured' });
    const post = await request(app).post('/cctp/relay').send({ burnHash: BURN });
    expect(post.status).toBe(503);
    expect(post.body.error).toBe('cctp_relay_disabled');
    expect((await request(app).get(`/cctp/relay/${BURN}`)).status).toBe(503);
  });

  test('POST answers 202 with the status, then GET reports the mint', async () => {
    const { relay } = setup();
    const app = appFor(relay);
    const post = await request(app).post('/cctp/relay').send({ burnHash: BURN });
    expect(post.status).toBe(202);
    expect(post.body).toMatchObject({ burnHash: BURN, kind: 'sent' });
    await relay.idle();
    const get = await request(app).get(`/cctp/relay/${BURN}`);
    expect(get.status).toBe(200);
    expect(get.body).toMatchObject({ kind: 'arrived', mintHash: MINT_TX });
    // A settled transfer answers 200 to a repeated POST, and nothing is sent again.
    const again = await request(app).post('/cctp/relay').send({ burnHash: BURN });
    expect(again.status).toBe(200);
    expect(again.body.kind).toBe('arrived');
  });

  test('400 for a malformed hash, 404 for a burn the relay was never asked about', async () => {
    const { relay } = setup();
    const app = appFor(relay);
    const bad = await request(app).post('/cctp/relay').send({ burnHash: 'abc' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_burn_hash');
    expect((await request(app).post('/cctp/relay').send({})).status).toBe(400);
    const missing = await request(app).get(`/cctp/relay/${'0'.repeat(64)}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('not_found');
  });

  test('503 relay_busy with Retry-After beyond the in-flight limit', async () => {
    const { relay } = setup([pending], { maxOpen: 1 });
    const app = appFor(stall(relay));
    await request(app).post('/cctp/relay').send({ burnHash: BURN });
    const busy = await request(app).post('/cctp/relay').send({ burnHash: 'f'.repeat(64) });
    expect(busy.status).toBe(503);
    expect(busy.body).toMatchObject({ error: 'relay_busy', retryAfterSeconds: 30 });
    expect(busy.headers['retry-after']).toBe('30');
  });

  test('rate-limits POST per client IP', async () => {
    const { relay } = setup([pending]);
    const app = appFor(stall(relay), 2);
    const hash = (n: number) => String(n).padStart(64, 'a');
    expect((await request(app).post('/cctp/relay').set('X-Forwarded-For', '1.1.1.1').send({ burnHash: hash(1) })).status).toBe(202);
    expect((await request(app).post('/cctp/relay').set('X-Forwarded-For', '1.1.1.1').send({ burnHash: hash(2) })).status).toBe(202);
    const limited = await request(app).post('/cctp/relay').set('X-Forwarded-For', '1.1.1.1').send({ burnHash: hash(3) });
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe('rate_limited');
    // Another client is unaffected, and reads are not limited.
    expect((await request(app).post('/cctp/relay').set('X-Forwarded-For', '2.2.2.2').send({ burnHash: hash(3) })).status).toBe(202);
    expect((await request(app).get(`/cctp/relay/${hash(1)}`).set('X-Forwarded-For', '1.1.1.1')).status).toBe(200);
  });

  test('a transient failure reads as in progress with retrying, reason and the next attempt; a final one as failed', async () => {
    const { relay, chain } = setup();
    chain.sendError = new SendError('insufficient_funds', 'insufficient funds for gas');
    const app = appFor(relay);
    await request(app).post('/cctp/relay').send({ burnHash: BURN });
    await relay.idle();
    const get = await request(app).get(`/cctp/relay/${BURN}`);
    expect(get.status).toBe(200);
    expect(get.body).toEqual({
      burnHash: BURN,
      kind: 'confirmed',
      retrying: true,
      reason: 'the relay is out of Base Sepolia gas; it retries once the account is refilled',
      nextRetryAt: new Date(t + RETRY_INITIAL_MS).toISOString(),
      recipient: RECIPIENT,
      amount: '10000000',
      feeExecuted: '0',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    // Still in progress, so a repeated POST answers 202, not 200.
    expect((await request(app).post('/cctp/relay').send({ burnHash: BURN })).status).toBe(202);

    const refused = setup([() => complete(patch(MESSAGE, 8, '00000003'))]);
    const app2 = appFor(refused.relay);
    await request(app2).post('/cctp/relay').send({ burnHash: BURN });
    await refused.relay.idle();
    const final = await request(app2).get(`/cctp/relay/${BURN}`);
    expect(final.body.kind).toBe('failed');
    expect(final.body.retrying).toBeUndefined();
    expect(final.body.nextRetryAt).toBeUndefined();
  });

  test('GET /cctp/relay shows the relay address and balance', async () => {
    const { relay } = setup();
    const res = await request(appFor(relay)).get('/cctp/relay');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: true, address: RELAY_ADDRESS, balanceWei: '100000000000000000', lowBalance: false });
  });
});
