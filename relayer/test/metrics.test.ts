/**
 * Route integration tests - uses a standalone Express app built from the
 * router so there's no port conflict with index.ts.
 *
 * event-store.ts opens its sqlite file at import time and is a module-level
 * singleton, so each test gets a fresh temp file + `jest.resetModules()`
 * before re-`require()`-ing everything (router, config, event-store, the
 * mocked DeFindex client) - mirrors test/vault-watcher.test.ts's
 * "runVaultPollCycle" isolation, extended to also cover the mocked client,
 * since `jest.mock`'s factory re-runs on every fresh require and produces
 * new `jest.fn()` instances each time.
 */
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";

jest.mock("../src/defindex/client.js", () => ({
  defindexSdk: { getVaultInfo: jest.fn() },
  defindexNetwork: "testnet",
}));

const VAULT_ID = "CBMHGL7GGGHODEDDJ5H2LKJEFHJWBRSQUKOXMC4FKOFDZK5HBKW6PI2S";

function vaultInfo(totalAmount: string) {
  return { totalManagedFunds: [{ total_amount: totalAmount }] };
}

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "metrics-test-"));
  process.env.VAULT_EVENTS_SQLITE_PATH = path.join(dir, "vault-events.db");
  jest.resetModules();
});

function load() {
  const { metricsRouter } = require("../src/routes/metrics.js");
  const { config } = require("../src/config.js");
  const { defindexSdk } = require("../src/defindex/client.js");
  const { insertVaultEvent } = require("../src/vault-watcher/event-store.js");
  config.defindexVaultId = VAULT_ID;
  const app = express();
  app.use("/metrics", metricsRouter);
  return { app, config, mockGetVaultInfo: defindexSdk.getVaultInfo as jest.Mock, insertVaultEvent };
}

describe("GET /metrics/tvl", () => {
  test("500 when DEFINDEX_VAULT_ID is not configured, and the SDK is never called", async () => {
    const { app, config, mockGetVaultInfo } = load();
    config.defindexVaultId = "";

    const res = await request(app).get("/metrics/tvl");

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("DEFINDEX_VAULT_ID not configured");
    expect(mockGetVaultInfo).not.toHaveBeenCalled();
  });

  test("200 with TVL and unique depositors derived from indexed events, plus the on-chain figure", async () => {
    const { app, mockGetVaultInfo, insertVaultEvent } = load();
    insertVaultEvent({
      cursor: "c1",
      kind: "deposit",
      depositor: "GDEPOSITOR1",
      amountStroops: "200000000",
      ledger: 100,
      txHash: "aa".repeat(32),
      ledgerCloseTime: 1_700_000_000,
    });
    mockGetVaultInfo.mockResolvedValue(vaultInfo("200000000"));

    const res = await request(app).get("/metrics/tvl");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      tvlStroops: "200000000",
      onChainTvlStroops: "200000000",
      uniqueDepositors: 1,
    });
    expect(mockGetVaultInfo).toHaveBeenCalledWith(VAULT_ID, "testnet");
  });

  test("502 with the ContractError variant name when the SDK rejects", async () => {
    const { app, mockGetVaultInfo } = load();
    mockGetVaultInfo.mockRejectedValue({
      error: "ContractError",
      message: "contract call failed",
      networkDetails: { stellarErrorCode: "100" },
    });

    const res = await request(app).get("/metrics/tvl");

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "NotInitialized" });
  });

  test("a large divergence between events and on-chain state is logged, not a request failure", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { app, mockGetVaultInfo, insertVaultEvent } = load();
    insertVaultEvent({
      cursor: "c2",
      kind: "deposit",
      depositor: "GDEPOSITOR2",
      amountStroops: "100000000",
      ledger: 100,
      txHash: "bb".repeat(32),
      ledgerCloseTime: 1_700_000_000,
    });
    // On-chain says 10x the events-derived figure - far beyond what yield
    // could plausibly explain.
    mockGetVaultInfo.mockResolvedValue(vaultInfo("1000000000"));

    const res = await request(app).get("/metrics/tvl");

    expect(res.status).toBe(200);
    expect(res.body.tvlStroops).toBe("100000000");
    expect(res.body.onChainTvlStroops).toBe("1000000000");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("TVL divergence"));
    warnSpy.mockRestore();
  });

  test("a small divergence explainable by yield is not logged", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { app, mockGetVaultInfo, insertVaultEvent } = load();
    insertVaultEvent({
      cursor: "c3",
      kind: "deposit",
      depositor: "GDEPOSITOR3",
      amountStroops: "100000000",
      ledger: 100,
      txHash: "cc".repeat(32),
      ledgerCloseTime: 1_700_000_000,
    });
    // 5% above the events-derived figure - a plausible yield accrual.
    mockGetVaultInfo.mockResolvedValue(vaultInfo("105000000"));

    const res = await request(app).get("/metrics/tvl");

    expect(res.status).toBe(200);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
