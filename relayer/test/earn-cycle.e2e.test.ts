/**
 * End-to-end happy path for the Earn product (#112): a real deposit into the
 * live testnet DeFindex vault, a real balance read that reflects it, and a real
 * withdrawal that takes it back out.
 *
 * This is the one suite in the repo that *submits* transactions. Everything
 * else stops at the XDR - defindex.integration.test.ts proves the relayer
 * builds a well-formed envelope, but a well-formed envelope that the network
 * rejects still passes that test. Here the transaction is signed, submitted to
 * Soroban RPC, polled to SUCCESS, and then checked against the position the
 * vault actually reports afterwards.
 *
 * It walks the same three-party split the browser does (see
 * frontend/src/lib/flows/earn.ts), with a test keypair standing in for the
 * connected wallet:
 *   1. the relayer builds the unsigned transaction (it holds the API key),
 *   2. the signer signs it - never the relayer, which stays non-custodial,
 *   3. this test submits to Soroban RPC and waits for the ledger.
 *
 * Configuration (see relayer/.env.example):
 *   DEFINDEX_API_KEY, DEFINDEX_VAULT_ID  - as for every other DeFindex route
 *   EARN_E2E_SIGNER_SECRET               - testnet S... key, funded with XLM
 *                                          and with a balance of the vault's
 *                                          underlying asset
 *   EARN_E2E_AMOUNT_STROOPS              - optional, defaults to 0.1 USDC
 *   EARN_E2E_REQUIRED                    - see below
 *
 * Unconfigured, every test warns once and returns early rather than failing,
 * matching defindex.integration.test.ts - a jest `.skip` would break
 * scripts/update-test-counts.mjs's passed===total invariant. That keeps
 * `bun run test` green anywhere, at the cost of making a silent no-op the
 * default: set EARN_E2E_REQUIRED=1 to turn missing configuration into a loud
 * failure instead, so a run that was meant to exercise the cycle cannot pass
 * by quietly doing nothing.
 */

import { describe, expect, test } from "bun:test";
import express from "express";
import request from "supertest";
import { Keypair, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import { defindexRouter } from "../src/routes/defindex.js";
import { config } from "../src/config.js";

/** Two Soroban submissions, each polled to finality, plus five API reads. */
const CYCLE_TIMEOUT_MS = 180_000;

/** 0.1 USDC. Small on purpose - this spends a real testnet balance on every run. */
const DEFAULT_AMOUNT_STROOPS = "1000000";

const signerSecret = process.env["EARN_E2E_SIGNER_SECRET"];
const amountStroops = process.env["EARN_E2E_AMOUNT_STROOPS"] ?? DEFAULT_AMOUNT_STROOPS;
const required = process.env["EARN_E2E_REQUIRED"] === "1";

/** Everything this suite needs, and which piece is absent when it isn't there. */
function missingConfig(): string[] {
  const missing: string[] = [];
  if (!config.defindexApiKey) missing.push("DEFINDEX_API_KEY");
  if (!config.defindexVaultId) missing.push("DEFINDEX_VAULT_ID");
  if (!signerSecret) missing.push("EARN_E2E_SIGNER_SECRET");
  return missing;
}

let warned = false;

/**
 * Returns true when the caller should return early. Under EARN_E2E_REQUIRED
 * it throws instead, so a CI job that meant to run this cannot pass by
 * silently doing nothing.
 */
function skipUnlessConfigured(): boolean {
  const missing = missingConfig();
  if (missing.length === 0) return false;

  const detail = `not set: ${missing.join(", ")} (see relayer/.env.example)`;
  if (required) {
    throw new Error(
      `EARN_E2E_REQUIRED=1 but the Earn e2e cycle cannot run - ${detail}`,
    );
  }
  if (!warned) {
    console.warn(`[earn-cycle.e2e.test] skipping live testnet cycle - ${detail}`);
    warned = true;
  }
  return true;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/defindex", defindexRouter);
  return app;
}

const app = buildApp();

/**
 * Signs `xdr` with the test keypair and submits it, returning the hash once
 * the ledger reports SUCCESS.
 *
 * Deliberately mirrors `signAndSubmit` in frontend/src/lib/flows/earn.ts,
 * including its 30-attempt poll: Soroban closes a ledger about every 5
 * seconds, and the SDK's 5-attempt default expires before a perfectly good
 * transaction has had a chance to land.
 */
async function signAndSubmit(xdr: string, keypair: Keypair, label: string): Promise<string> {
  const server = new rpc.Server(config.stellarRpcUrl, {
    allowHttp: config.stellarRpcUrl.startsWith("http://"),
  });

  const tx = TransactionBuilder.fromXDR(xdr, config.networkPassphrase);
  tx.sign(keypair);

  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") {
    throw new Error(`${label}: network rejected the transaction: ${JSON.stringify(sent.errorResult)}`);
  }
  if (sent.status === "TRY_AGAIN_LATER") {
    throw new Error(`${label}: submission throttled (TRY_AGAIN_LATER)`);
  }

  const final = await server.pollTransaction(sent.hash, {
    attempts: 30,
    sleepStrategy: rpc.BasicSleepStrategy,
  });

  if (final.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    // Distinct from a failure: the transaction is signed, submitted, and may
    // still land. Reporting it as failed would be a lie.
    throw new Error(`${label}: still not found after polling - hash ${sent.hash}`);
  }
  if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`${label}: failed on-chain (${final.status}): ${String(final.resultXdr)}`);
  }
  return sent.hash;
}

/** The signer's position, as the relayer reports it. */
async function readPosition(address: string): Promise<{ dfTokens: bigint; underlyingStroops: bigint }> {
  const res = await request(app).get(`/defindex/position?address=${address}`);
  expect(res.status).toBe(200);
  return {
    dfTokens: BigInt(res.body.dfTokens),
    underlyingStroops: BigInt(res.body.underlyingStroops),
  };
}

/** The vault APY, as the relayer reports it (a fraction: 0.0731 = 7.31%). */
async function readApy(): Promise<number> {
  const res = await request(app).get("/defindex/apy");
  expect(res.status).toBe(200);
  expect(typeof res.body.apy).toBe("number");
  expect(Number.isFinite(res.body.apy)).toBe(true);
  return res.body.apy;
}

describe("Earn happy path (live testnet): deposit -> balance/APY update -> withdraw", () => {
  test(
    "deposits, sees the position and APY reflect it, then withdraws",
    async () => {
      if (skipUnlessConfigured()) return;

      const keypair = Keypair.fromSecret(signerSecret as string);
      const address = keypair.publicKey();
      const deposit = BigInt(amountStroops);

      // ── 1. Baseline ────────────────────────────────────────────────────
      const apyBefore = await readApy();
      const before = await readPosition(address);
      console.log(
        `[earn-e2e] baseline: ${before.underlyingStroops} stroops, ` +
          `${before.dfTokens} dfTokens, APY ${(apyBefore * 100).toFixed(2)}%`,
      );

      // ── 2. Deposit ─────────────────────────────────────────────────────
      const depositRes = await request(app)
        .post("/defindex/deposit")
        .send({ caller: address, amountStroops: deposit.toString() });
      expect(depositRes.status).toBe(200);
      expect(typeof depositRes.body.xdr).toBe("string");

      const depositHash = await signAndSubmit(depositRes.body.xdr, keypair, "deposit");
      console.log(`[earn-e2e] deposit confirmed: ${depositHash}`);

      // ── 3. The balance reflects it ─────────────────────────────────────
      const afterDeposit = await readPosition(address);
      const gained = afterDeposit.underlyingStroops - before.underlyingStroops;
      console.log(`[earn-e2e] position after deposit: ${afterDeposit.underlyingStroops} stroops (+${gained})`);

      // The vault charges a fee and the share price moves with accrued yield,
      // so the position does not grow by exactly the deposit. What must be
      // true is that it grew, that it grew by something of the deposit's
      // order, and that shares were actually issued.
      expect(gained > 0n).toBe(true);
      expect(gained <= deposit).toBe(true);
      expect(gained * 100n >= deposit * 90n).toBe(true); // within 10%
      expect(afterDeposit.dfTokens > before.dfTokens).toBe(true);

      // APY stays readable and sane across the deposit. A 0.1 USDC position
      // cannot meaningfully move a vault's rate, so asserting a *change* here
      // would be asserting noise - that it still reads correctly is the real
      // claim, and it is the one the UI depends on.
      const apyAfter = await readApy();
      expect(apyAfter).toBeGreaterThanOrEqual(0);
      expect(apyAfter).toBeLessThan(5);

      // ── 4. Withdraw ────────────────────────────────────────────────────
      // 90% of what the deposit actually bought, not 100%: share-price
      // rounding can put the exact figure a stroop or two out of reach, and a
      // cycle test that fails on rounding tells nobody anything useful. The
      // claim being proven is that a real withdrawal lands and reduces the
      // position, which 90% proves as well as 100% would.
      const withdraw = (gained * 90n) / 100n;
      expect(withdraw > 0n).toBe(true);

      const withdrawRes = await request(app)
        .post("/defindex/withdraw")
        .send({ caller: address, amountStroops: withdraw.toString() });
      expect(withdrawRes.status).toBe(200);
      expect(typeof withdrawRes.body.xdr).toBe("string");

      const withdrawHash = await signAndSubmit(withdrawRes.body.xdr, keypair, "withdraw");
      console.log(`[earn-e2e] withdraw confirmed: ${withdrawHash}`);

      // ── 5. The balance reflects that too ───────────────────────────────
      const afterWithdraw = await readPosition(address);
      console.log(`[earn-e2e] position after withdraw: ${afterWithdraw.underlyingStroops} stroops`);

      expect(afterWithdraw.underlyingStroops < afterDeposit.underlyingStroops).toBe(true);
      expect(afterWithdraw.dfTokens < afterDeposit.dfTokens).toBe(true);
    },
    CYCLE_TIMEOUT_MS,
  );
});
