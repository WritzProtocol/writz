import { describe, expect, test } from "bun:test";
import {
  STELLAR_TX_TTL_MS,
  createPendingDepositStore,
  planResume,
  type DepositChainView,
  type PendingDeposit,
} from "./pendingDeposit";
import { createJsonStore } from "./storage";
import { memoryStorage } from "./testStorage";

const NOW = 1_800_000_000_000;

const base: PendingDeposit = {
  btcTxid: "ab".repeat(32),
  sats: "5000000",
  vout: 1,
  p2wsh: "tb1qlock",
  btcPubkey: "02" + "11".repeat(32),
  timelockHeight: 3_000_000,
  stellarAddress: "GOWNER",
  positionIndex: 2,
  step: "confirming",
  createdAt: NOW - 60_000,
  updatedAt: NOW - 60_000,
};
const pd = (over: Partial<PendingDeposit>): PendingDeposit => ({ ...base, ...over });
const chain = (over: Partial<DepositChainView> = {}): DepositChainView => ({
  depositorForTxid: null,
  stellarTx: null,
  ...over,
});

describe("planResume", () => {
  test("BTC sent but output not located yet: look it up on Bitcoin", () => {
    expect(planResume(pd({ vout: undefined, step: "sent" }), chain(), NOW)).toEqual({
      action: "locate_output",
    });
  });

  test("output known, nothing on Stellar: keep waiting for confirmations", () => {
    expect(planResume(pd({}), chain(), NOW)).toEqual({ action: "wait_confirmations" });
    expect(planResume(pd({ step: "ready" }), chain(), NOW)).toEqual({ action: "wait_confirmations" });
  });

  test("already deposited on Stellar by this wallet: finalize locally, never deposit again", () => {
    const s = pd({ step: "submitted", stellarTxHash: "h" });
    expect(planResume(s, chain({ depositorForTxid: "GOWNER" }), NOW)).toEqual({ action: "finalize" });
    expect(planResume(pd({ step: "ready" }), chain({ depositorForTxid: "GOWNER" }), NOW)).toEqual({ action: "finalize" });
  });

  test("the txid is registered on Stellar by another account", () => {
    expect(planResume(pd({}), chain({ depositorForTxid: "GOTHER" }), NOW)).toEqual({
      action: "conflict",
      depositor: "GOTHER",
    });
  });

  test("a submitted Stellar deposit that may still land is waited for, not resubmitted", () => {
    const s = pd({ step: "submitted", stellarTxHash: "h", stellarSubmittedAt: NOW - 30_000 });
    expect(planResume(s, chain({ stellarTx: "NOT_FOUND" }), NOW)).toEqual({
      action: "await_stellar",
      hash: "h",
    });
    // Landed but the RPC view has not caught up with the position yet.
    expect(planResume(s, chain({ stellarTx: "SUCCESS" }), NOW + STELLAR_TX_TTL_MS * 2)).toEqual({
      action: "await_stellar",
      hash: "h",
    });
  });

  test("a Stellar deposit that failed or expired goes back to waiting, ready to sign again", () => {
    const s = pd({ step: "submitted", stellarTxHash: "h", stellarSubmittedAt: NOW - 30_000 });
    expect(planResume(s, chain({ stellarTx: "FAILED" }), NOW)).toEqual({ action: "wait_confirmations" });
    expect(planResume(s, chain({ stellarTx: "NOT_FOUND" }), NOW + STELLAR_TX_TTL_MS)).toEqual({
      action: "wait_confirmations",
    });
  });
});

describe("pending deposit store", () => {
  test("persists per Stellar address and survives a reload", () => {
    const storage = memoryStorage();
    const make = () =>
      createPendingDepositStore(createJsonStore<PendingDeposit>("writz.pendingDeposit.", () => storage));

    const tab = make();
    tab.save(pd({ step: "sent", vout: undefined }), NOW);
    expect(storage.data.has("writz.pendingDeposit.GOWNER")).toBe(true);

    const reloaded = make();
    expect(reloaded.load("GOWNER")?.step).toBe("sent");
    expect(reloaded.load("GOTHER")).toBeNull();

    const updated = reloaded.update("GOWNER", { vout: 0, sats: "4999000", step: "confirming" }, NOW + 1);
    expect(updated).toMatchObject({ vout: 0, sats: "4999000", step: "confirming", updatedAt: NOW + 1 });

    reloaded.clear("GOWNER");
    expect(make().load("GOWNER")).toBeNull();
    expect(reloaded.update("GOWNER", { step: "ready" })).toBeNull();
  });

  test("snapshot keeps a stable reference until storage changes", () => {
    const storage = memoryStorage();
    const store = createPendingDepositStore(
      createJsonStore<PendingDeposit>("writz.pendingDeposit.", () => storage),
    );
    store.save(pd({}), NOW);
    const a = store.snapshot("GOWNER");
    expect(store.snapshot("GOWNER")).toBe(a);
    store.update("GOWNER", { confirmations: 1 }, NOW + 1);
    expect(store.snapshot("GOWNER")).not.toBe(a);
  });
});
