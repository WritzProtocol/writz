import { describe, expect, it, mock } from "bun:test";
import type { ChainPosition } from "@/lib/contracts/writzLend";
import type { Position } from "@/lib/position";

const repayCalls: bigint[] = [];
mock.module("@/lib/contracts/writzLend", () => ({
  internalTxid: (hex: string) => Buffer.from(hex, "hex").reverse(),
  readPosition: async () => null,
  writzLendClient: () => ({
    repay: async ({ usdc_amount }: { usdc_amount: bigint }) => {
      repayCalls.push(usdc_amount);
      return { amount: usdc_amount };
    },
  }),
}));
let ledger = 100;
mock.module("./positionTx", () => ({
  submitPositionTx: async () => ({ hash: `h${++ledger}`, ledger }),
}));
const { repay, repayPlan } = await import("./repay");

const TXID = "ab".repeat(32);
const position: Position = {
  id: TXID,
  owner: "GOWNER",
  txid: TXID,
  collateralSats: "5000000",
  debtStroops: "1000000000",
  index: 0,
  status: "active",
  createdAt: 0,
};
const chain = (over: Partial<ChainPosition>): ChainPosition => ({
  txid: TXID,
  status: "active",
  depositor: "GOWNER",
  collateralSats: 5_000_000n,
  debtStroops: 1_000_000_000n,
  storedDebtStroops: 1_000_000_000n,
  timelockHeight: 300_000,
  userPubkey: "02" + "11".repeat(32),
  scriptPubKey: "0020" + "22".repeat(32),
  ledger: 100,
  ...over,
});
const signTransaction = (async () => ({ signedTxXdr: "", signerAddress: "GOWNER" })) as never;

describe("repayPlan", () => {
  it("a partial repay sends what was asked", () => {
    expect(repayPlan(400n, 1_000n, 1_003n)).toEqual({ amount: 400n, full: false });
  });

  it("repaying what the page showed pays the debt with interest since then", () => {
    expect(repayPlan(1_000n, 1_000n, 1_003n)).toEqual({ amount: 1_003n, full: true });
    expect(repayPlan(2_000n, 1_000n, 1_003n)).toEqual({ amount: 1_003n, full: true });
  });
});

describe("repay", () => {
  it("clears the few stroops of interest a full repay leaves while it lands", async () => {
    repayCalls.length = 0;
    const reads = [
      chain({}),
      // After the first repay: 25 stroops of interest from the ledgers it took to land.
      chain({ debtStroops: 25n, storedDebtStroops: 25n, ledger: 101 }),
      chain({ status: "closed", debtStroops: 0n, storedDebtStroops: 0n, ledger: 102 }),
    ];
    const settled: string[] = [];
    const r = await repay({
      position,
      amountStroops: 1_000_000_000n,
      repayer: "GOWNER",
      signTransaction,
      emit: (e) => e.type === "settled" && settled.push(e.hash ?? ""),
      deps: { read: async () => reads.shift() ?? null, sleep: async () => {} },
    });
    expect(repayCalls).toEqual([1_000_000_000n, 25n]);
    expect(r.updated).toMatchObject({ status: "closed", debtStroops: "0" });
    expect(settled).toHaveLength(1);
  });

  it("a partial repay sends one transaction", async () => {
    repayCalls.length = 0;
    const r = await repay({
      position,
      amountStroops: 400_000_000n,
      repayer: "GOWNER",
      signTransaction,
      deps: { read: async () => chain({}), sleep: async () => {} },
    });
    expect(repayCalls).toEqual([400_000_000n]);
    expect(r.updated).toMatchObject({ status: "active", debtStroops: "600000000" });
  });

  it("refuses a loan the chain holds as closed or owned by another wallet", async () => {
    const deps = (c: ChainPosition) => ({ read: async () => c, sleep: async () => {} });
    const run = (c: ChainPosition) =>
      repay({ position, amountStroops: 1n, repayer: "GOWNER", signTransaction, deps: deps(c) });
    await expect(run(chain({ status: "closed" }))).rejects.toThrow("PositionNotActive");
    await expect(run(chain({ depositor: "GOTHER" }))).rejects.toThrow("Unauthorized");
  });
});
