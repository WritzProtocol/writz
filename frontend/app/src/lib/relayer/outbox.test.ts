import { describe, expect, test } from "bun:test";
import {
  backoffMs,
  enqueue,
  isStuck,
  markReady,
  MAX_BACKOFF_MS,
  NOTICE_AFTER_FAILURES,
  processOutbox,
  RETRY_BASE_MS,
  trackRelayerCall,
  type OutboxDeps,
  type OutboxInput,
  type SendOutcome,
} from "./outbox";
import { createMemoryOutboxStore, type OutboxEntry, type OutboxStore } from "./outboxStore";

const OWNER = "testnet:GOWNER";
const C = "cd".repeat(32);
const NOW = 1_800_000_000_000;

const insert = { kind: "insert-commitment" as const, payload: { commitment: C, authTxXdr: "AAAA", encNote: "ee" } };
const update = { kind: "update-leaf" as const, payload: { leafIndex: 2, newCommitment: C } };

/** Deps over `store` whose relayer answers from `replies` in order (then `accepted`). */
function deps(store: OutboxStore, replies: SendOutcome[] = [], applied = false, clock = { now: NOW }) {
  const sent: OutboxEntry[] = [];
  const d: OutboxDeps = {
    store,
    now: () => clock.now,
    send: async (e) => {
      sent.push(e);
      return replies.shift() ?? { kind: "accepted" };
    },
    isApplied: async () => applied,
  };
  return { d, sent, clock };
}

async function ready(store: OutboxStore, input: OutboxInput = update) {
  const e = await enqueue(store, OWNER, input, NOW);
  await markReady(store, OWNER, e.id, NOW);
  return e;
}

describe("backoff", () => {
  test("doubles from 30 s and stops at 5 minutes", () => {
    expect(backoffMs(1)).toBe(RETRY_BASE_MS);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(4)).toBe(240_000);
    expect(backoffMs(5)).toBe(MAX_BACKOFF_MS);
    expect(backoffMs(12)).toBe(MAX_BACKOFF_MS);
  });
});

describe("relayer outbox", () => {
  test("an entry survives a reload: a new outbox over the same store still sends it", async () => {
    const store = createMemoryOutboxStore();
    await ready(store, insert);
    // A reload: nothing but the store carries over.
    const { d, sent } = deps(store);
    const run = await processOutbox(OWNER, d);
    expect(sent.map((e) => e.kind)).toEqual(["insert-commitment"]);
    expect(sent[0].payload).toEqual(insert.payload);
    expect(run.done).toHaveLength(1);
    expect(await store.list(OWNER)).toEqual([]);
  });

  test("never sends an entry whose transaction is not confirmed yet", async () => {
    const store = createMemoryOutboxStore();
    await enqueue(store, OWNER, update, NOW);
    const { d, sent } = deps(store);
    await processOutbox(OWNER, d, { force: true });
    expect(sent).toEqual([]);
    expect((await store.list(OWNER))[0].state).toBe("pending");
  });

  test("a relayer 5xx is retried with backoff, then removed once accepted", async () => {
    const store = createMemoryOutboxStore();
    await ready(store);
    const { d, sent, clock } = deps(store, [
      { kind: "failed", error: "503" },
      { kind: "failed", error: "502" },
    ]);

    await processOutbox(OWNER, d);
    let [e] = await store.list(OWNER);
    expect(e.attempts).toBe(1);
    expect(e.lastError).toBe("503");
    expect(e.nextAttemptAt).toBe(NOW + RETRY_BASE_MS);

    // Not due yet: nothing is sent.
    clock.now = NOW + RETRY_BASE_MS - 1;
    await processOutbox(OWNER, d);
    expect(sent).toHaveLength(1);

    clock.now = NOW + RETRY_BASE_MS;
    await processOutbox(OWNER, d);
    [e] = await store.list(OWNER);
    expect(e.attempts).toBe(2);
    expect(e.nextAttemptAt).toBe(clock.now + 60_000);

    clock.now += 60_000;
    await processOutbox(OWNER, d);
    expect(sent).toHaveLength(3);
    expect(await store.list(OWNER)).toEqual([]);
  });

  test("a 409 (store behind the chain) is retried after the watcher catches up", async () => {
    const store = createMemoryOutboxStore();
    await ready(store);
    const { d, sent, clock } = deps(store, [{ kind: "behind", error: "409 leaf store behind" }]);
    await processOutbox(OWNER, d);
    expect((await store.list(OWNER))[0].lastError).toBe("409 leaf store behind");
    clock.now += RETRY_BASE_MS;
    await processOutbox(OWNER, d);
    expect(sent).toHaveLength(2);
    expect(await store.list(OWNER)).toEqual([]);
  });

  test("an entry is removed without sending once the chain shows it applied", async () => {
    const store = createMemoryOutboxStore();
    await ready(store, insert);
    const { d, sent } = deps(store, [], true);
    const run = await processOutbox(OWNER, d);
    expect(sent).toEqual([]);
    expect(run.done).toEqual([`insert-commitment:${C}`]);
    expect(await store.list(OWNER)).toEqual([]);
  });

  test(`after ${NOTICE_AFTER_FAILURES} failures the entry is kept and flagged, and a manual retry ignores the backoff`, async () => {
    const store = createMemoryOutboxStore();
    await ready(store);
    const failing = Array.from({ length: NOTICE_AFTER_FAILURES }, () => ({ kind: "failed" as const, error: "down" }));
    const { d, sent, clock } = deps(store, failing);
    for (let i = 0; i < NOTICE_AFTER_FAILURES; i++) {
      await processOutbox(OWNER, d);
      clock.now += MAX_BACKOFF_MS;
    }
    const [e] = await store.list(OWNER);
    expect(e.attempts).toBe(NOTICE_AFTER_FAILURES);
    expect(isStuck(e)).toBe(true);

    clock.now = e.nextAttemptAt - 1;
    await processOutbox(OWNER, d, { force: true });
    expect(sent).toHaveLength(NOTICE_AFTER_FAILURES + 1);
    expect(await store.list(OWNER)).toEqual([]);
  });

  test("a thrown send counts as a failure instead of losing the entry", async () => {
    const store = createMemoryOutboxStore();
    await ready(store);
    const { d } = deps(store);
    d.send = async () => {
      throw new Error("network down");
    };
    await processOutbox(OWNER, d);
    const [e] = await store.list(OWNER);
    expect(e.attempts).toBe(1);
    expect(e.lastError).toContain("network down");
  });
});

describe("trackRelayerCall", () => {
  test("writes the entry before submit, then sends it once the transaction is confirmed", async () => {
    const store = createMemoryOutboxStore();
    const { d, sent } = deps(store);
    let seenBeforeSubmit: OutboxEntry[] = [];
    const result = await trackRelayerCall({
      owner: OWNER,
      input: update,
      deps: d,
      submit: async () => {
        seenBeforeSubmit = await store.list(OWNER);
        return "tx-hash";
      },
    });
    expect(result).toBe("tx-hash");
    expect(seenBeforeSubmit.map((e) => e.state)).toEqual(["pending"]);
    expect(sent).toHaveLength(1);
    expect(await store.list(OWNER)).toEqual([]);
  });

  test("a relayer failure does not fail the flow: the entry stays queued", async () => {
    const store = createMemoryOutboxStore();
    const { d } = deps(store, [{ kind: "failed", error: "502" }]);
    await expect(trackRelayerCall({ owner: OWNER, input: update, deps: d, submit: async () => 1 })).resolves.toBe(1);
    expect((await store.list(OWNER))[0]).toMatchObject({ state: "ready", attempts: 1 });
  });

  test("a transaction that does not land leaves nothing queued", async () => {
    const store = createMemoryOutboxStore();
    const { d, sent } = deps(store);
    await expect(
      trackRelayerCall({
        owner: OWNER,
        input: insert,
        deps: d,
        submit: async () => {
          throw new Error("tx failed");
        },
      }),
    ).rejects.toThrow("tx failed");
    expect(sent).toEqual([]);
    expect(await store.list(OWNER)).toEqual([]);
  });
});
