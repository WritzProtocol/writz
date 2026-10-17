import { describe, expect, mock, test } from "bun:test";
import { xdr } from "@stellar/stellar-sdk";
import { clientRelayerSource, esploraReads, type LiquidationEventsServer } from "./client";

const res = (status: number, body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

const routes = (table: Record<string, Response>) =>
  mock(async (url: string) => table[url] ?? res(500, { error: "unexpected" }));

describe("esploraReads", () => {
  const API = "https://esplora.test/api";

  test("tip height parses the plain-text body", async () => {
    expect(await esploraReads(API, routes({ [`${API}/blocks/tip/height`]: res(200, "260001") })).getBtcTipHeight()).toBe(
      260_001,
    );
  });

  test("an unknown txid is unseen; mempool has no block height", async () => {
    const reads = esploraReads(
      API,
      routes({
        [`${API}/tx/aa/status`]: res(404, "Transaction not found"),
        [`${API}/tx/bb/status`]: res(200, { confirmed: false }),
        [`${API}/tx/cc/status`]: res(200, { confirmed: true, block_height: 259_990 }),
      }),
    );
    expect(await reads.getBtcTx("aa")).toEqual({ seen: false });
    expect(await reads.getBtcTx("bb")).toEqual({ seen: true, blockHeight: null });
    expect(await reads.getBtcTx("cc")).toEqual({ seen: true, blockHeight: 259_990 });
  });

  test("outspend reports the spending tx and whether it confirmed", async () => {
    const reads = esploraReads(
      API,
      routes({
        [`${API}/tx/aa/outspend/0`]: res(200, { spent: false }),
        [`${API}/tx/bb/outspend/1`]: res(200, { spent: true, txid: "ff", status: { confirmed: true } }),
      }),
    );
    expect(await reads.getOutspend("aa", 0)).toEqual({ spent: false });
    expect(await reads.getOutspend("bb", 1)).toEqual({ spent: true, txid: "ff", confirmed: true });
  });

  test("a server error rejects rather than reading as unspent", async () => {
    const reads = esploraReads(API, routes({}));
    await expect(reads.getOutspend("aa", 0)).rejects.toThrow();
    await expect(reads.getBtcTx("aa")).rejects.toThrow();
  });
});

describe("clientRelayerSource", () => {
  const RELAYER = "https://relayer.test";

  const server = (over: Partial<LiquidationEventsServer> = {}): LiquidationEventsServer => ({
    getHealth: async () => ({ oldestLedger: 100 }),
    getEvents: async () => ({ events: [], oldestLedgerCloseTime: "1700000000" }),
    ...over,
  });

  const source = (get = routes({}), srv = server()) =>
    clientRelayerSource({ relayerUrl: RELAYER, get, server: () => srv, contractId: () => "CTREE" });

  test("confirmations come from the SPV-proof endpoint: 404 is 0, 409 carries n and m", async () => {
    const get = routes({
      [`${RELAYER}/spv-proof/aa`]: res(404, { error: "unconfirmed" }),
      [`${RELAYER}/spv-proof/bb`]: res(409, { available: 2, requested: 6 }),
      [`${RELAYER}/spv-proof/cc`]: res(200, { confirmations: 7 }),
    });
    expect(await source(get).confirmations("aa")).toEqual({ confirmations: 0 });
    expect(await source(get).confirmations("bb")).toEqual({ confirmations: 2, minConfirmations: 6 });
    expect(await source(get).confirmations("cc")).toEqual({ confirmations: 7 });
  });

  test("catching up maps a merkle-path 409", async () => {
    const get = routes({
      [`${RELAYER}/merkle-path?commitment=aa&leafIndex=3`]: res(409, { error: "out of sync" }),
      [`${RELAYER}/merkle-path?commitment=bb&leafIndex=4`]: res(200, { root: "1" }),
    });
    expect(await source(get).catchingUp("aa", 3)).toBe(true);
    expect(await source(get).catchingUp("bb", 4)).toBe(false);
  });

  test("liquidation found in RPC events returns its tx hash, filtered by topic", async () => {
    const getEvents = mock(async () => ({ events: [{ txHash: "e1" }], oldestLedgerCloseTime: "1700000000" }));
    const nullifier = "0a".repeat(32);
    expect(await source(undefined, server({ getEvents })).liquidation(nullifier, 0)).toEqual({
      found: true,
      txHash: "e1",
    });
    const [request] = getEvents.mock.calls[0] as unknown as [Parameters<LiquidationEventsServer["getEvents"]>[0]];
    expect(request.startLedger).toBe(100);
    expect(request.filters[0].topics).toEqual([
      [
        xdr.ScVal.scvSymbol("liquidate").toXDR("base64"),
        xdr.ScVal.scvBytes(Buffer.from(nullifier, "hex")).toXDR("base64"),
      ],
    ]);
  });

  test("no event is only complete when the RPC window reaches the position's creation", async () => {
    const oldest = 1_700_000_000_000;
    expect(await source().liquidation("aa", oldest + 1)).toEqual({ found: false, complete: true });
    expect(await source().liquidation("aa", oldest - 1)).toEqual({ found: false, complete: false });
  });

  test("an unconfigured relayer rejects instead of answering", async () => {
    const s = clientRelayerSource({ relayerUrl: "", get: routes({}), server: () => server(), contractId: () => "C" });
    await expect(s.confirmations("aa")).rejects.toThrow("NEXT_PUBLIC_RELAYER_URL");
  });
});
