import { describe, expect, test } from "bun:test";
import { positionActions, positionStatusLabel } from "./actions";
import type { Position } from "./types";

const base: Position = {
  id: "1",
  owner: "GOWNER",
  txid: "ab".repeat(32),
  collateralSats: "5000000",
  debtStroops: "0",
  index: 0,
  version: 1,
  commitment: "1",
  nullifier: "2",
  status: "active",
  createdAt: 0,
  btcPubkey: "02" + "11".repeat(32),
  timelockHeight: 3_000_000,
  vout: 0,
};

const pos = (over: Partial<Position>): Position => ({ ...base, ...over });

describe("positionActions", () => {
  test("open loan with debt offers borrow and repay, not release", () => {
    expect(positionActions(pos({ debtStroops: "15000000000" }))).toEqual({
      borrow: true,
      repay: true,
      release: false,
      missingBtcDetails: false,
    });
  });

  test("open loan never borrowed offers borrow and release", () => {
    const a = positionActions(pos({}));
    expect(a.borrow).toBe(true);
    expect(a.repay).toBe(false);
    expect(a.release).toBe(true);
  });

  test("repaid loan offers release only", () => {
    expect(positionActions(pos({ status: "closed" }))).toEqual({
      borrow: false,
      repay: false,
      release: true,
      missingBtcDetails: false,
    });
  });

  test("liquidated and released loans are read-only, whatever the stale debt", () => {
    for (const status of ["liquidated", "released"] as const) {
      for (const debtStroops of ["0", "9500000000"]) {
        const a = positionActions(pos({ status, debtStroops }));
        expect(a).toEqual({ borrow: false, repay: false, release: false, missingBtcDetails: false });
      }
    }
  });

  test("debt 0 without Bitcoin details cannot release and says so", () => {
    const a = positionActions(pos({ status: "closed", btcPubkey: undefined }));
    expect(a.release).toBe(false);
    expect(a.missingBtcDetails).toBe(true);
  });

  test("demo loans never offer release", () => {
    const a = positionActions(pos({ status: "closed", demo: true, btcPubkey: undefined }));
    expect(a).toEqual({ borrow: false, repay: false, release: false, missingBtcDetails: false });
  });
});

describe("positionStatusLabel", () => {
  test("a repaid loan with BTC locked never reads as closed", () => {
    expect(positionStatusLabel(pos({ status: "closed" }))).toBe("Repaid, BTC still locked");
    expect(positionStatusLabel(pos({ status: "released" }))).toBe("BTC released");
    expect(positionStatusLabel(pos({ status: "liquidated" }))).toBe("Liquidated");
  });
});
