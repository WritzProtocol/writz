import { beforeEach, describe, expect, test } from "bun:test";
import { config } from "@/config";
import { memoryStorage } from "@/lib/flow/testStorage";
import { listPositions, positionsSnapshot, savePosition, storageKey } from "./store";
import type { Position } from "./types";

const OWNER = "GOWNER";
const TXID = "ab".repeat(32);

const position = (txid = TXID): Position => ({
  id: txid,
  owner: OWNER,
  txid,
  collateralSats: "5000",
  debtStroops: "0",
  index: 0,
  status: "active",
  createdAt: 1,
});

let storage: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  storage = memoryStorage();
  Object.assign(globalThis, { window: globalThis, localStorage: storage });
});

describe("position store", () => {
  test("keys positions by lending contract and owner", () => {
    savePosition(position());
    expect([...storage.data.keys()]).toEqual([storageKey(config.contracts.writzLend, OWNER)]);
  });

  test("loans saved under another contract are not listed", () => {
    storage.setItem(storageKey("COLDCONTRACT", OWNER), JSON.stringify([position()]));
    expect(listPositions(OWNER)).toEqual([]);
    expect(positionsSnapshot(OWNER)).toEqual([]);
  });

  test("loans saved before keys named a contract are not listed", () => {
    storage.setItem(`writz.positions.${OWNER}`, JSON.stringify([position()]));
    expect(listPositions(OWNER)).toEqual([]);
  });
});
