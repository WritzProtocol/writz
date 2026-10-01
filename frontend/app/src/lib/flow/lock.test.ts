import { describe, expect, test } from "bun:test";
import {
  TxBusyError,
  createLockRegistry,
  nextPositionIndex,
  txLockName,
  type ChannelLike,
  type LockEnv,
  type LockManagerLike,
} from "./lock";
import { memoryStorage } from "./testStorage";

/** One browser: a shared Web Locks table and BroadcastChannel bus, many tabs. */
function fakeBrowser() {
  const held = new Set<string>();
  const queues = new Map<string, (() => void)[]>();
  const locks: LockManagerLike = {
    async request(name, options, callback) {
      if (held.has(name)) {
        if (options.ifAvailable) return callback(null);
        await new Promise<void>((grant) => {
          const q = queues.get(name) ?? [];
          q.push(grant);
          queues.set(name, q);
        });
      }
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
        queues.get(name)?.shift()?.();
      }
    },
    async query() {
      return { held: [...held].map((name) => ({ name })) };
    },
  };
  const channels = new Set<ChannelLike>();
  const openChannel = () => {
    const ch: ChannelLike = {
      onmessage: null,
      postMessage(message) {
        for (const other of channels) if (other !== ch) other.onmessage?.({ data: message });
      },
      close: () => void channels.delete(ch),
    };
    channels.add(ch);
    return ch;
  };
  const storage = memoryStorage();
  const tab = () => createLockRegistry({ locks, openChannel, storage } satisfies LockEnv);
  return { tab, held, storage };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("withTxLock", () => {
  test("a second transaction for the same account is refused while one is in flight", async () => {
    const { tab } = fakeBrowser();
    const a = tab();
    const b = tab();
    let finish!: () => void;
    const first = a.withTxLock("GA", () => new Promise<void>((r) => (finish = r)));
    await tick();

    await expect(b.withTxLock("GA", async () => "never")).rejects.toBeInstanceOf(TxBusyError);
    await expect(a.withTxLock("GA", async () => "never")).rejects.toBeInstanceOf(TxBusyError);
    expect(await b.withTxLock("GB", async () => "other account")).toBe("other account");

    finish();
    await first;
    expect(await b.withTxLock("GA", async () => "after")).toBe("after");
  });

  test("other tabs see the lock as held elsewhere, then free again", async () => {
    const { tab } = fakeBrowser();
    const a = tab();
    const b = tab();
    let seen = 0;
    b.subscribeTxLock("GA", () => seen++);
    let finish!: () => void;
    const running = a.withTxLock("GA", () => new Promise<void>((r) => (finish = r)));
    await tick();

    expect(a.txLockState("GA")).toBe("here");
    expect(b.txLockState("GA")).toBe("elsewhere");
    expect(seen).toBeGreaterThan(0);

    finish();
    await running;
    expect(a.txLockState("GA")).toBe("free");
    expect(b.txLockState("GA")).toBe("free");
  });

  test("a tab opened mid-transaction learns about it from the lock table", async () => {
    const { tab, held } = fakeBrowser();
    held.add(txLockName("GA"));
    const late = tab();
    late.subscribeTxLock("GA", () => {});
    await tick();
    expect(late.txLockState("GA")).toBe("elsewhere");
  });

  test("releases the lock when the flow throws", async () => {
    const { tab } = fakeBrowser();
    const a = tab();
    await expect(a.withTxLock("GA", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(a.txLockState("GA")).toBe("free");
    expect(await a.withTxLock("GA", async () => 1)).toBe(1);
  });

  test("falls back to a per-tab lock without Web Locks", async () => {
    const reg = createLockRegistry({ locks: null, openChannel: null, storage: null });
    let finish!: () => void;
    const first = reg.withTxLock("GA", () => new Promise<void>((r) => (finish = r)));
    await tick();
    await expect(reg.withTxLock("GA", async () => 0)).rejects.toBeInstanceOf(TxBusyError);
    finish();
    await first;
    expect(await reg.withTxLock("GA", async () => 2)).toBe(2);
  });
});

describe("position index reservation", () => {
  test("next index is one past every index used or reserved", () => {
    expect(nextPositionIndex([])).toBe(0);
    expect(nextPositionIndex([0, 1, 2])).toBe(3);
    // Gaps (a merged recovery, a cancelled send) never cause reuse.
    expect(nextPositionIndex([0, 4])).toBe(5);
  });

  test("two tabs reserving at once get different indices", async () => {
    const { tab } = fakeBrowser();
    const [i, j] = await Promise.all([
      tab().reservePositionIndex("GA", [0, 1]),
      tab().reservePositionIndex("GA", [0, 1]),
    ]);
    expect(new Set([i, j])).toEqual(new Set([2, 3]));
  });

  test("a released reservation can be handed out again", async () => {
    const { tab, storage } = fakeBrowser();
    const a = tab();
    const i = await a.reservePositionIndex("GA", []);
    await a.releasePositionIndex("GA", i);
    expect(await a.reservePositionIndex("GA", [])).toBe(i);
    expect(JSON.parse(storage.data.get("writz.reservedIndices.GA")!)).toEqual([i]);
  });
});
