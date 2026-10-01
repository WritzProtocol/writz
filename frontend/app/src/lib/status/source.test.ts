import { describe, expect, mock, test } from "bun:test";
import type { PendingDeposit } from "@/lib/flow/pendingDeposit";
import type { Position } from "@/lib/position/types";
import { readStatusInputs, toHex32, type StatusSource } from "./source";
import { createStatusStore } from "./store";

const NOW = 1_800_000_000_000;
const PARAMS = { minConfirmations: 1, now: NOW };
const TXID = "ab".repeat(32);

const position: Position = {
  id: "11",
  owner: "GOWNER",
  txid: TXID,
  collateralSats: "5000000",
  debtStroops: "15000000000",
  index: 0,
  version: 1,
  commitment: "11",
  nullifier: "22",
  status: "active",
  createdAt: NOW - 86_400_000,
  btcPubkey: "02" + "11".repeat(32),
  timelockHeight: 300_000,
  vout: 0,
  leafIndex: 3,
};

const pd: PendingDeposit = {
  btcTxid: TXID,
  sats: "5000000",
  vout: 0,
  p2wsh: "tb1qlock",
  btcPubkey: "02" + "11".repeat(32),
  timelockHeight: 300_000,
  stellarAddress: "GOWNER",
  positionIndex: 0,
  step: "confirming",
  createdAt: NOW - 60_000,
  updatedAt: NOW - 60_000,
};

const fail = () => Promise.reject(new Error("down"));

function fakeSource(over: Partial<StatusSource> = {}, relayer: Partial<StatusSource["relayer"]> = {}): StatusSource {
  return {
    getCommitmentForTxid: mock(async () => null),
    isCommitmentPending: mock(async () => false),
    isNullifierSpent: mock(async () => false),
    getOraclePrice: mock(async () => 600_000_000_000n),
    getBtcTipHeight: mock(async () => 260_000),
    getBtcTx: mock(async () => ({ seen: true as const, blockHeight: 259_999 })),
    getOutspend: mock(async () => ({ spent: false as const })),
    ...over,
    relayer: {
      confirmations: mock(async () => ({ confirmations: 2, minConfirmations: 1 })),
      liquidation: mock(async () => ({ found: false as const, complete: true })),
      catchingUp: mock(async () => false),
      ...relayer,
    },
  };
}

describe("readStatusInputs", () => {
  test("an open loan reads nullifier, price, tip, outspend and catching-up, not deposit reads", async () => {
    const source = fakeSource();
    const inputs = await readStatusInputs({ position, pendingDeposit: null }, source, PARAMS);
    expect(inputs.chain).toEqual({
      nullifierSpent: false,
      oraclePriceStroops: 600_000_000_000n,
      btcTipHeight: 260_000,
      lockOutspend: { spent: false },
    });
    expect(inputs.relayer).toEqual({ catchingUp: false });
    expect(source.isNullifierSpent).toHaveBeenCalledWith(toHex32("22"));
    expect(source.relayer.catchingUp).toHaveBeenCalledWith(toHex32("11"), 3);
    expect(source.getBtcTx).not.toHaveBeenCalled();
    expect(source.relayer.liquidation).not.toHaveBeenCalled();
  });

  test("the liquidation lookup runs only once the nullifier is spent", async () => {
    const source = fakeSource({ isNullifierSpent: mock(async () => true) });
    const inputs = await readStatusInputs({ position, pendingDeposit: null }, source, PARAMS);
    expect(source.relayer.liquidation).toHaveBeenCalledWith(toHex32("22"), position.createdAt);
    expect(inputs.relayer?.liquidation).toEqual({ found: false, complete: true });
  });

  test("debt 0 skips the price read", async () => {
    const source = fakeSource();
    await readStatusInputs({ position: { ...position, debtStroops: "0" }, pendingDeposit: null }, source, PARAMS);
    expect(source.getOraclePrice).not.toHaveBeenCalled();
  });

  test("failed reads stay undefined instead of turning into a default", async () => {
    const source = fakeSource(
      { isNullifierSpent: fail, getOraclePrice: fail, getBtcTipHeight: fail, getOutspend: fail },
      { catchingUp: fail },
    );
    const inputs = await readStatusInputs({ position, pendingDeposit: null }, source, PARAMS);
    expect(inputs.chain).toEqual({});
    expect(inputs.relayer).toEqual({});
  });

  test("a pending deposit reads Bitcoin, the commitment and the relayer count", async () => {
    const source = fakeSource({ getCommitmentForTxid: mock(async () => "0f".repeat(32)) });
    const inputs = await readStatusInputs({ position: null, pendingDeposit: pd }, source, PARAMS);
    expect(inputs.chain).toEqual({
      depositTx: { seen: true, blockHeight: 259_999 },
      btcTipHeight: 260_000,
      commitmentForTxid: "0f".repeat(32),
      commitmentPending: false,
    });
    expect(inputs.relayer).toEqual({ confirmations: 2, minConfirmations: 1 });
    expect(source.isCommitmentPending).toHaveBeenCalledWith("0f".repeat(32));
    expect(source.isNullifierSpent).not.toHaveBeenCalled();
  });
});

describe("createStatusStore", () => {
  test("starts as checking and notifies once derived", async () => {
    const store = createStatusStore(fakeSource(), { minConfirmations: 1, now: () => NOW });
    expect(store.get("k").status.kind).toBe("checking");
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.get("k").status.kind));
    await store.refresh("k", { position, pendingDeposit: null });
    expect(seen).toEqual(["active"]);
  });

  test("a slow earlier refresh never overwrites a newer one", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const source = fakeSource({
      isNullifierSpent: mock(async () => {
        const call = ++calls;
        if (call === 1) await gate;
        return call !== 1;
      }),
    });
    const store = createStatusStore(source, { minConfirmations: 1, now: () => NOW });
    const slow = store.refresh("k", { position, pendingDeposit: null });
    await store.refresh("k", { position, pendingDeposit: null });
    release();
    await slow;
    expect(store.get("k").status.kind).toBe("changed_elsewhere");
  });
});
