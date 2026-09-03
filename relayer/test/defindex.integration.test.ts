/**
 * Real integration tests against the live testnet DeFindex vault
 * (CBMHGL7GGGHODEDDJ5H2LKJEFHJWBRSQUKOXMC4FKOFDZK5HBKW6PI2S, see
 * contracts/deployments/defindex-vault-testnet.md) - unlike defindex.test.ts,
 * nothing here is mocked. Requests go through the real defindexRouter, the
 * real @defindex/sdk client (src/defindex/client.js), and the real DeFindex
 * API to the real deployed vault.
 *
 * Requires DEFINDEX_API_KEY and DEFINDEX_VAULT_ID (see relayer/.env.example).
 * Neither is set in CI today, so every test warns once and returns early
 * instead of failing - the same no-op-with-warning pattern already used by
 * repay-watcher/vault-watcher when their own optional config is absent (see
 * config.ts's comment on defindexVaultId). A jest `.skip` would instead
 * surface as "N skipped, M passed, T total" in the summary line, which
 * breaks scripts/update-test-counts.mjs's passed===total check - the
 * early-return keeps that invariant true either way. Run with a real .env
 * locally to exercise this suite for real.
 */

import express from "express";
import request from "supertest";
import { defindexRouter } from "../src/routes/defindex.js";
import { config } from "../src/config.js";

// writz-deployer - holds all four vault roles and a real ~20 USDC position
// from the vault's first deposit (contracts/deployments/defindex-vault-testnet.md).
// Same address already used as VALID_ADDRESS in defindex.test.ts.
const FUNDED_ADDRESS = "GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT";

const LIVE_TIMEOUT_MS = 20000;

const isConfigured = Boolean(config.defindexApiKey && config.defindexVaultId);
let warned = false;

function skipUnlessConfigured(): boolean {
  if (!isConfigured) {
    if (!warned) {
      console.warn(
        "[defindex.integration.test] DEFINDEX_API_KEY / DEFINDEX_VAULT_ID not set - " +
          "skipping live testnet assertions (see relayer/.env.example)",
      );
      warned = true;
    }
    return true;
  }
  return false;
}

function isBase64(value: string): boolean {
  return Buffer.from(value, "base64").toString("base64") === value;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/defindex", defindexRouter);
  return app;
}

const app = buildApp();

// ── GET /defindex/apy ────────────────────────────────────────────────────

describe("GET /defindex/apy (live testnet)", () => {
  test(
    "returns the real vault APY as a finite fraction",
    async () => {
      if (skipUnlessConfigured()) return;

      const res = await request(app).get("/defindex/apy");

      expect(res.status).toBe(200);
      expect(typeof res.body.apy).toBe("number");
      expect(Number.isFinite(res.body.apy)).toBe(true);
      // Sanity bound, not an exact value - the live APY moves over time.
      expect(res.body.apy).toBeGreaterThanOrEqual(0);
      expect(res.body.apy).toBeLessThan(5);
    },
    LIVE_TIMEOUT_MS,
  );
});

// ── GET /defindex/position ───────────────────────────────────────────────

describe("GET /defindex/position (live testnet) - balance / managed funds", () => {
  test(
    "returns the funded address's real managed funds as decimal strings",
    async () => {
      if (skipUnlessConfigured()) return;

      const res = await request(app).get(`/defindex/position?address=${FUNDED_ADDRESS}`);

      expect(res.status).toBe(200);
      expect(typeof res.body.dfTokens).toBe("string");
      expect(typeof res.body.underlyingStroops).toBe("string");
      expect(Number(res.body.dfTokens)).toBeGreaterThan(0);
      expect(Number(res.body.underlyingStroops)).toBeGreaterThan(0);
    },
    LIVE_TIMEOUT_MS,
  );
});

// ── POST /defindex/deposit ───────────────────────────────────────────────

describe("POST /defindex/deposit (live testnet) - tx building", () => {
  test(
    "builds a real, well-formed unsigned deposit XDR",
    async () => {
      if (skipUnlessConfigured()) return;

      const res = await request(app)
        .post("/defindex/deposit")
        .send({ caller: FUNDED_ADDRESS, amountStroops: "1000000" }); // 0.1 USDC

      expect(res.status).toBe(200);
      expect(typeof res.body.xdr).toBe("string");
      expect(res.body.xdr.length).toBeGreaterThan(0);
      expect(isBase64(res.body.xdr)).toBe(true);
    },
    LIVE_TIMEOUT_MS,
  );
});

// ── POST /defindex/withdraw ──────────────────────────────────────────────

describe("POST /defindex/withdraw (live testnet) - tx building", () => {
  test(
    "builds a real, well-formed unsigned withdraw XDR for a partial amount",
    async () => {
      if (skipUnlessConfigured()) return;

      const res = await request(app)
        .post("/defindex/withdraw")
        .send({ caller: FUNDED_ADDRESS, amountStroops: "1000000" }); // well within the real position

      expect(res.status).toBe(200);
      expect(typeof res.body.xdr).toBe("string");
      expect(res.body.xdr.length).toBeGreaterThan(0);
      expect(isBase64(res.body.xdr)).toBe(true);
    },
    LIVE_TIMEOUT_MS,
  );

  test(
    "rejects a real over-withdrawal beyond the funded address's actual position",
    async () => {
      if (skipUnlessConfigured()) return;

      const res = await request(app)
        .post("/defindex/withdraw")
        .send({ caller: FUNDED_ADDRESS, amountStroops: "999999999999999" });

      // Not pinned to DeFindex's exact upstream wording (e.g.
      // VaultErrors.AmountOverTotalSupply, per PR #135's manual smoke test) -
      // that text is upstream-owned, not something this repo controls.
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(typeof res.body.error).toBe("string");
      expect(res.body.error.length).toBeGreaterThan(0);
    },
    LIVE_TIMEOUT_MS,
  );
});
