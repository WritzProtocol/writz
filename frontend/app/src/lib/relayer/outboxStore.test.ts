import { describe, expect, test } from "bun:test";
import { createIndexedDbOutboxStore, createMemoryOutboxStore, entryId, outboxOwner, type OutboxEntry } from "./outboxStore";

const C = "ab".repeat(32);

const entry = (over: Partial<OutboxEntry> = {}): OutboxEntry =>
  ({
    id: entryId("update-leaf", C),
    kind: "update-leaf",
    commitment: C,
    payload: { leafIndex: 3, newCommitment: C },
    createdAt: 1,
    attempts: 0,
    nextAttemptAt: 0,
    state: "ready",
    ...over,
  }) as OutboxEntry;

describe("outbox store", () => {
  test("keys entries by network and address", () => {
    expect(outboxOwner("testnet", "GABC")).toBe("testnet:GABC");
    expect(outboxOwner("testnet", "GABC")).not.toBe(outboxOwner("mainnet", "GABC"));
  });

  test("keeps each owner's entries apart", async () => {
    const s = createMemoryOutboxStore();
    await s.put("testnet:GA", entry());
    expect(await s.list("testnet:GA")).toHaveLength(1);
    expect(await s.list("testnet:GB")).toHaveLength(0);
    expect(await s.list("mainnet:GA")).toHaveLength(0);
  });

  test("put replaces an entry with the same id, remove deletes it", async () => {
    const s = createMemoryOutboxStore();
    await s.put("o", entry());
    await s.put("o", entry({ attempts: 4 }));
    expect((await s.list("o")).map((e) => e.attempts)).toEqual([4]);
    await s.remove("o", entry().id);
    expect(await s.list("o")).toEqual([]);
  });

  test("hands out copies, so a caller cannot change what is stored", async () => {
    const s = createMemoryOutboxStore();
    await s.put("o", entry());
    const [read] = await s.list("o");
    read.attempts = 99;
    expect((await s.list("o"))[0].attempts).toBe(0);
  });

  test("returns no IndexedDB store where IndexedDB does not exist", () => {
    expect(createIndexedDbOutboxStore(undefined)).toBeNull();
  });
});
