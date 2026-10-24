import { describe, expect, test } from "bun:test";
import { RelayerClient, RelayerError, testnet, type FetchLike } from "../src/index.js";

interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function fakeFetch(replies: Reply[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const r = replies.shift();
    if (!r) throw new Error("no more replies");
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), {
      status: r.status,
      headers: r.headers,
    });
  };
  return { fetch, calls };
}

const sleeps: number[] = [];
const sleep = async (ms: number) => {
  sleeps.push(ms);
};

const PROOF = {
  txid: "1fef7b54a1819ae8cc719dec45ff5122880526fb9b8f89b303bbc260ccb718b1",
  rawTxNoWitness: "02",
  blockHash: "9e".repeat(32),
  txIndex: 1,
  merkleProof: [],
  headers: [],
  blockHeight: 327600,
  confirmations: 6,
  sorobanArgs: { block_hash: "9e".repeat(32), merkle_proof: [], tx_index: 1, raw_tx: "02", min_confirmations: 6 },
};

describe("RelayerClient.getSpvProof", () => {
  test("uses the preset relayer and the confirmations query", async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: PROOF }]);
    const r = new RelayerClient({ network: testnet, fetch });
    const proof = await r.getSpvProof(PROOF.txid.toUpperCase(), { confirmations: 3 });
    expect(proof.sorobanArgs.tx_index).toBe(1);
    expect(calls[0]!.url).toBe(`${testnet.relayerUrl}/spv-proof/${PROOF.txid}?confirmations=3`);
  });

  test("retries light_client_behind after retryAfterSeconds", async () => {
    sleeps.length = 0;
    const { fetch, calls } = fakeFetch([
      { status: 409, body: { error: "light_client_behind", message: "behind", retryAfterSeconds: 60 }, headers: { "retry-after": "60" } },
      { status: 200, body: PROOF },
    ]);
    const r = new RelayerClient({ network: testnet, fetch, sleep });
    await r.getSpvProof(PROOF.txid);
    expect(calls.length).toBe(2);
    expect(sleeps).toEqual([60_000]);
  });

  test("falls back to the Retry-After header for 429", async () => {
    sleeps.length = 0;
    const { fetch } = fakeFetch([
      { status: 429, body: { error: "rate_limited" }, headers: { "retry-after": "7" } },
      { status: 200, body: PROOF },
    ]);
    await new RelayerClient({ network: testnet, fetch, sleep }).getSpvProof(PROOF.txid);
    expect(sleeps).toEqual([7_000]);
  });

  test("throws a typed error once retries are exhausted", async () => {
    sleeps.length = 0;
    const busy = { status: 503, body: { error: "upstream_unavailable", message: "down", retryAfterSeconds: 10 } };
    const { fetch, calls } = fakeFetch([busy, busy, busy]);
    const err = await new RelayerClient({ network: testnet, fetch, sleep, maxRetries: 2 })
      .getSpvProof(PROOF.txid)
      .catch((e) => e);
    expect(err).toBeInstanceOf(RelayerError);
    expect(err.code).toBe("upstream_unavailable");
    expect(err.status).toBe(503);
    expect(err.retryAfterSeconds).toBe(10);
    expect(err.retryable).toBe(true);
    expect(calls.length).toBe(3);
  });

  test("does not retry errors without a retry hint", async () => {
    for (const body of [
      { error: "tx_not_found", message: "unknown" },
      { error: "insufficient_confirmations", requested: 6, available: 2 },
      { error: "invalid_txid" },
    ]) {
      const { fetch, calls } = fakeFetch([{ status: body.error === "invalid_txid" ? 400 : 404, body }]);
      const err = await new RelayerClient({ network: testnet, fetch, sleep }).getSpvProof("ab").catch((e) => e);
      expect(err.code).toBe(body.error);
      expect(err.retryable).toBe(false);
      expect(calls.length).toBe(1);
    }
  });

  test("does not wait longer than maxRetryWaitSeconds", async () => {
    const { fetch, calls } = fakeFetch([{ status: 429, body: { error: "rate_limited", retryAfterSeconds: 600 } }]);
    const err = await new RelayerClient({ network: testnet, fetch, sleep }).getSpvProof(PROOF.txid).catch((e) => e);
    expect(err.code).toBe("rate_limited");
    expect(calls.length).toBe(1);
  });

  test("maxRetries 0 turns retries off", async () => {
    const { fetch, calls } = fakeFetch([{ status: 409, body: { error: "light_client_behind", retryAfterSeconds: 1 } }]);
    await new RelayerClient({ network: testnet, fetch, sleep }).getSpvProof(PROOF.txid, { maxRetries: 0 }).catch(() => {});
    expect(calls.length).toBe(1);
  });

  test("reports a network failure as network_error", async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    const err = await new RelayerClient({ network: testnet, fetch }).getSpvProof(PROOF.txid).catch((e) => e);
    expect(err).toBeInstanceOf(RelayerError);
    expect(err.code).toBe("network_error");
  });
});

describe("RelayerClient Earn routes", () => {
  test("reads APY and position", async () => {
    const { fetch, calls } = fakeFetch([
      { status: 200, body: { apy: 0.0731 } },
      { status: 200, body: { dfTokens: "12500000", underlyingStroops: "12734512" } },
    ]);
    const r = new RelayerClient({ relayerUrl: "https://relayer.example/", fetch });
    expect(await r.getEarnApy()).toBe(0.0731);
    expect(await r.getEarnPosition("GABC")).toEqual({ dfTokens: 12500000n, underlyingStroops: 12734512n });
    expect(calls[1]!.url).toBe("https://relayer.example/defindex/position?address=GABC");
  });

  test("builds deposit and withdraw with string stroop amounts", async () => {
    const { fetch, calls } = fakeFetch([
      { status: 200, body: { xdr: "AAAA" } },
      { status: 200, body: { xdr: "BBBB" } },
    ]);
    const r = new RelayerClient({ network: testnet, fetch });
    expect(await r.buildEarnDeposit("GABC", 10_000_000n)).toBe("AAAA");
    expect(await r.buildEarnWithdraw("GABC", 5n)).toBe("BBBB");
    expect(calls[0]!.url.endsWith("/defindex/deposit")).toBe(true);
    expect(calls[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ caller: "GABC", amountStroops: "10000000" });
    expect(calls[1]!.url.endsWith("/defindex/withdraw")).toBe(true);
  });

  test("passes the route's error message through", async () => {
    const { fetch } = fakeFetch([{ status: 502, body: { error: "DeFindex API unavailable" } }]);
    const err = await new RelayerClient({ network: testnet, fetch }).getEarnApy().catch((e) => e);
    expect(err.status).toBe(502);
    expect(err.code).toBe("http_error");
    expect(err.message).toContain("DeFindex API unavailable");
  });

  test("rejects a non-positive amount before any request", async () => {
    const { fetch, calls } = fakeFetch([]);
    await expect(new RelayerClient({ network: testnet, fetch }).buildEarnDeposit("GABC", 0n)).rejects.toThrow(RangeError);
    expect(calls.length).toBe(0);
  });
});
