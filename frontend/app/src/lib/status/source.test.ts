import { describe, expect, mock, test } from "bun:test";
import type { ChainPosition } from "@/lib/contracts/writzLend";
import type { PendingDeposit } from "@/lib/flow/pendingDeposit";
import type { Position } from "@/lib/position/types";
import { readStatusInputs, type StatusSource } from "./source";
import { createStatusStore } from "./store";

const NOW = 1_800_000_000_000;
const PARAMS = { minConfirmations: 1, now: NOW };
const TXID = "ab".repeat(32);

const position: Position = {
  id: TXID,
  owner: "GOWNER",
  txid: TXID,
  collateralSats: "5000000",
  debtStroops: "15000000000",
  index: 0,
  status: "active",
  createdAt: NOW - 86_400_000,
  btcPubkey: "02" + "11".repeat(32),
  timelockHeight: 300_000,
  vout: 0,
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

const chainPosition = (over: Partial<ChainPosition> = {}): ChainPosition => ({
  txid: TXID,
  status: "active",
  depositor: "GOWNER",
  collateralSats: 5_000_000n,
  debtStroops: 15_000_000_000n,
  storedDebtStroops: 15_000_000_000n,
  timelockHeight: 300_000,
  userPubkey: "02" + "11".repeat(32),
  scriptPubKey: "0020" + "00".repeat(32),
  ledger: 1_000,
  ...over,
});

const fail = () => Promise.reject(new Error("down"));

function fakeSource(over: Partial<StatusSource> = {}, relayer: Partial<StatusSource["relayer"]> = {}): StatusSource {
  return {
    getPosition: mock(async () => chainPosition()),
    hasReleasePsbt: mock(async () => false),
    getOraclePrice: mock(async () => 600_000_000_000n),
    getBtcTipHeight: mock(async () => 260_000),
    getBtcTx: mock(async () => ({ seen: true as const, blockHeight: 259_999 })),
    getOutspend: mock(async () => ({ spent: false as const })),
    ...over,
    relayer: {
      confirmations: mock(async () => ({ confirmations: 2, minConfirmations: 1 })),
      liquidation: mock(async () => ({ found: false as const, complete: true })),
      ...relayer,
    },
  };
}

describe("readStatusInputs", () => {
  test("an open loan reads its position, price, tip and outspend, not deposit reads", async () => {
    const source = fakeSource();
    const inputs = await readStatusInputs({ position, pendingDeposit: null }, source, PARAMS);
    expect(inputs.chain).toEqual({
      position: chainPosition(),
      oraclePriceStroops: 600_000_000_000n,
      btcTipHeight: 260_000,
      lockOutspend: { spent: false },
    });
    expect(inputs.relayer).toEqual({});
    expect(source.getPosition).toHaveBeenCalledWith(TXID);
    expect(source.getOutspend).toHaveBeenCalledWith(TXID, 0);
    expect(source.getBtcTx).not.toHaveBeenCalled();
    expect(source.hasReleasePsbt).not.toHaveBeenCalled();
    expect(source.relayer.liquidation).not.toHaveBeenCalled();
  });

  test("the liquidation lookup runs only once the chain says liquidated", async () => {
    const source = fakeSource({ getPosition: mock(async () => chainPosition({ status: "liquidated", debtStroops: 0n })) });
    const inputs = await readStatusInputs({ position, pendingDeposit: null }, source, PARAMS);
    expect(source.relayer.liquidation).toHaveBeenCalledWith(TXID, position.createdAt);
    expect(inputs.relayer?.liquidation).toEqual({ found: false, complete: true });
    expect(source.getOraclePrice).not.toHaveBeenCalled();
  });

  test("a closed loan asks whether the relayer has co-signed its release", async () => {
    const source = fakeSource({
      getPosition: mock(async () => chainPosition({ status: "closed", debtStroops: 0n })),
      hasReleasePsbt: mock(async () => true),
    });
    const inputs = await readStatusInputs({ position, pendingDeposit: null }, source, PARAMS);
    expect(inputs.chain.releasePsbtReady).toBe(true);
  });

  test("no debt on chain skips the price read, whatever this device last saw", async () => {
    const source = fakeSource({ getPosition: mock(async () => chainPosition({ debtStroops: 0n })) });
    await readStatusInputs({ position, pendingDeposit: null }, source, PARAMS);
    expect(source.getOraclePrice).not.toHaveBeenCalled();
  });

  test("failed reads stay undefined instead of turning into a default", async () => {
    const source = fakeSource({ getPosition: fail, getOraclePrice: fail, getBtcTipHeight: fail, getOutspend: fail });
    const inputs = await readStatusInputs({ position, pendingDeposit: null }, source, PARAMS);
    expect(inputs.chain).toEqual({});
    expect(inputs.relayer).toEqual({});
  });

  test("a pending deposit reads Bitcoin, the position and the relayer count", async () => {
    const source = fakeSource({ getPosition: mock(async () => null) });
    const inputs = await readStatusInputs({ position: null, pendingDeposit: pd }, source, PARAMS);
    expect(inputs.chain).toEqual({
      depositTx: { seen: true, blockHeight: 259_999 },
      btcTipHeight: 260_000,
      position: null,
    });
    expect(inputs.relayer).toEqual({ confirmations: 2, minConfirmations: 1 });
    expect(source.getOutspend).not.toHaveBeenCalled();
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
      getPosition: mock(async () => {
        const call = ++calls;
        if (call === 1) await gate;
        return chainPosition(call === 1 ? {} : { status: "liquidated", debtStroops: 0n });
      }),
    });
    const store = createStatusStore(source, { minConfirmations: 1, now: () => NOW });
    const slow = store.refresh("k", { position, pendingDeposit: null });
    await store.refresh("k", { position, pendingDeposit: null });
    release();
    await slow;
    expect(store.get("k").status.kind).toBe("liquidated");
  });
});
