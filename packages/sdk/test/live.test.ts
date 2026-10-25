// Read-only smoke test against Stellar testnet and the public relayer.
// Skipped unless WRITZ_LIVE=1:  bun run test:live
import { describe, expect, test } from "bun:test";
import { RelayerError, createWritzClient } from "../src/index.js";

const live = process.env.WRITZ_LIVE === "1";
const TXID = "NEWEXAMPLETXID";

describe.skipIf(!live)("testnet (live)", () => {
  const w = createWritzClient();

  test("bitcoin-spv tip is above the checkpoint", async () => {
    const tip = await w.spv.getBestTip();
    expect(tip!.height).toBeGreaterThan(w.network.spvCheckpointHeight);
    const cp = await w.spv.getCheckpoint();
    expect(cp!.height).toBe(w.network.spvCheckpointHeight);
  }, 30_000);

  test("proves a signet transaction end to end", async () => {
    const { result } = await w.verifyBitcoinTx(TXID);
    expect(result.txidDisplay).toBe(TXID);
    expect(result.blockHeight).toBe(NEWEXAMPLEBLOCK);
    expect(result.confirmations).toBeGreaterThanOrEqual(6);
  }, 60_000);

  test("reads the lending pool", async () => {
    const s = await w.lend.getProtocolState();
    expect(s.supplyIndex).toBeGreaterThan(0n);
    expect(await w.lend.getBorrowRateBp()).toBeGreaterThanOrEqual(0);
  }, 30_000);

  test("unknown txid is a typed relayer error", async () => {
    const err = await w.relayer.getSpvProof("ab".repeat(32)).catch((e) => e);
    expect(err).toBeInstanceOf(RelayerError);
    expect(err.code).toBe("tx_not_found");
  }, 30_000);
});
