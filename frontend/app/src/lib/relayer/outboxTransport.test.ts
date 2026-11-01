import { describe, expect, test } from "bun:test";
import type { OutboxEntry } from "./outboxStore";
import { isAppliedOnChain, sendToRelayer } from "./outboxTransport";

const C = "ef".repeat(32);
const RELAYER = "https://relayer.test";

const base = { commitment: C, createdAt: 0, attempts: 0, nextAttemptAt: 0, state: "ready" as const };
const insert: OutboxEntry = {
  ...base,
  id: `insert-commitment:${C}`,
  kind: "insert-commitment",
  payload: { commitment: C, authTxXdr: "AAAA", encNote: "aa" },
};
const update: OutboxEntry = {
  ...base,
  id: `update-leaf:${C}`,
  kind: "update-leaf",
  payload: { leafIndex: 7, newCommitment: C },
};

function fakeFetch(status: number, body: unknown = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  };
  return { fn, calls };
}

describe("sendToRelayer", () => {
  test("posts the payload to the endpoint named by the entry", async () => {
    const f = fakeFetch(200);
    expect(await sendToRelayer(insert, RELAYER, f.fn)).toEqual({ kind: "accepted" });
    expect(f.calls[0].url).toBe(`${RELAYER}/insert-commitment`);
    expect(f.calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual(insert.payload);

    await sendToRelayer(update, RELAYER, f.fn);
    expect(f.calls[1].url).toBe(`${RELAYER}/update-leaf`);
  });

  test("maps 409 to behind and any other error to failed, with the relayer's message", async () => {
    expect(await sendToRelayer(update, RELAYER, fakeFetch(409, { error: "out of sync" }).fn)).toEqual({
      kind: "behind",
      error: "409 out of sync",
    });
    expect(await sendToRelayer(update, RELAYER, fakeFetch(503).fn)).toEqual({ kind: "failed", error: "503" });
    expect(await sendToRelayer(insert, RELAYER, fakeFetch(403, { error: "bad auth" }).fn)).toEqual({
      kind: "failed",
      error: "403 bad auth",
    });
  });

  test("a network error or a missing relayer URL is a failure, not a throw", async () => {
    const down = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect(await sendToRelayer(update, RELAYER, down)).toEqual({ kind: "failed", error: "unreachable: ECONNREFUSED" });
    expect((await sendToRelayer(update, "", fakeFetch(200).fn)).kind).toBe("failed");
  });
});

describe("isAppliedOnChain", () => {
  test("an insert is applied once its commitment is no longer pending", async () => {
    const reads = (pending: boolean) => ({ isCommitmentPending: async () => pending, relayerUrl: RELAYER });
    expect(await isAppliedOnChain(insert, reads(true))).toBe(false);
    expect(await isAppliedOnChain(insert, reads(false))).toBe(true);
  });

  test("an update is applied once the relayer's chain-checked tree holds the new leaf", async () => {
    const ok = fakeFetch(200);
    const reads = { isCommitmentPending: async () => true, relayerUrl: RELAYER, fetchFn: ok.fn };
    expect(await isAppliedOnChain(update, reads)).toBe(true);
    expect(ok.calls[0].url).toBe(`${RELAYER}/merkle-path?commitment=${C}&leafIndex=7`);

    for (const status of [404, 409, 503]) {
      expect(await isAppliedOnChain(update, { ...reads, fetchFn: fakeFetch(status).fn })).toBe(false);
    }
  });
});
