import { describe, expect, it } from "bun:test";
import type { ChainPosition } from "@/lib/contracts/writzLend";
import { requireOpenPosition } from "./borrow";

const chain = (over: Partial<ChainPosition> = {}): ChainPosition => ({
  txid: "ab".repeat(32),
  status: "active",
  depositor: "GOWNER",
  collateralSats: 5_000_000n,
  debtStroops: 0n,
  storedDebtStroops: 0n,
  timelockHeight: 300_000,
  userPubkey: "02" + "11".repeat(32),
  scriptPubKey: "",
  ledger: 1,
  ...over,
});

describe("requireOpenPosition", () => {
  it("returns an active position this wallet deposited", async () => {
    expect(await requireOpenPosition("ab".repeat(32), "GOWNER", async () => chain())).toEqual(chain());
  });

  it("names what the contract would refuse", async () => {
    await expect(requireOpenPosition("x", "GOWNER", async () => null)).rejects.toThrow("PositionNotFound");
    await expect(requireOpenPosition("x", "GOWNER", async () => chain({ depositor: "GOTHER" }))).rejects.toThrow("Unauthorized");
    await expect(requireOpenPosition("x", "GOWNER", async () => chain({ status: "liquidated" }))).rejects.toThrow("PositionNotActive");
  });
});
