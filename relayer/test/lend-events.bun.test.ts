import { describe, expect, mock, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { Address, Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { decodeLendEvent, decodeRawXdr, type RawLendEvent } from "../src/lend-events/decode";
import { runLendEventsCycle, type LendEventsCycleDeps } from "../src/lend-events/poller";
import { openLendEventStore } from "../src/lend-events/store";

const CONTRACT = "CCONTRACT";
const DEPLOY_LEDGER = 5_516_974;
const TXID = Buffer.alloc(32, 0xab);
const SUPPLIER = Keypair.random().publicKey();
const cursorN = (n: number) => `00193273${String(n).padStart(11, "0")}-0000000000`;
const dbFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lend-events-")), "lend-events.db");
const fresh = () => openLendEventStore(dbFile());

const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });
const map = (fields: Record<string, xdr.ScVal>) =>
  xdr.ScVal.scvMap(
    Object.entries(fields).map(([k, val]) => new xdr.ScMapEntry({ key: sym(k), val })),
  );

const repayFull = (n: number): RawLendEvent => ({
  id: `event-${String(n).padStart(4, "0")}`,
  ledger: 100 + n,
  txHash: `hash${n}`,
  topic: [sym("repay_full"), xdr.ScVal.scvBytes(TXID)],
  value: map({ repayer: new Address(SUPPLIER).toScVal(), p2wsh_script_pubkey: xdr.ScVal.scvBytes(Buffer.from("0020", "hex")) }),
});
const supply = (n: number): RawLendEvent => ({
  id: `event-${String(n).padStart(4, "0")}`,
  ledger: 100 + n,
  txHash: `hash${n}`,
  topic: [sym("supply"), new Address(SUPPLIER).toScVal()],
  value: map({ usdc_amount: i128(5_000_000_000_000_000_000_000n), scaled_amount: i128(7n) }),
});
const paused = (n: number): RawLendEvent => ({
  id: `event-${String(n).padStart(4, "0")}`,
  ledger: 100 + n,
  txHash: `hash${n}`,
  topic: [sym("paused_set"), new Address(SUPPLIER).toScVal()],
  value: map({ paused: xdr.ScVal.scvBool(true) }),
});

const pages = (...list: { events: unknown[]; cursor: string }[]) => {
  let i = 0;
  return {
    getEvents: mock(async () => list[Math.min(i++, list.length - 1)]!),
  };
};
const cycle = (
  store: ReturnType<typeof fresh>,
  server: LendEventsCycleDeps["server"],
  deployLedger: number | undefined = DEPLOY_LEDGER,
) =>
  runLendEventsCycle({
    server,
    contractId: CONTRACT,
    store,
    deployLedger,
    decodeEvent: decodeLendEvent as LendEventsCycleDeps["decodeEvent"],
  });

describe("decodeLendEvent", () => {
  test("a position event keeps the txid as its subject", () => {
    const row = decodeLendEvent(repayFull(1), CONTRACT)!;
    expect(row).toMatchObject({ name: "repay_full", subject: TXID.toString("hex"), ledger: 101 });
    expect(JSON.parse(row.data)).toMatchObject({ repayer: SUPPLIER, p2wsh_script_pubkey: "0020" });
  });

  test("a supply event keeps the supplier, and large amounts lose nothing", () => {
    const row = decodeLendEvent(supply(1), CONTRACT)!;
    expect(row.subject).toBe(SUPPLIER);
    expect(JSON.parse(row.data).usdc_amount).toBe("5000000000000000000000");
  });

  test("administrative events are not archived", () => {
    expect(decodeLendEvent(paused(1), CONTRACT)).toBeNull();
  });

  test("an archived event with no subject throws instead of being skipped", () => {
    expect(() => decodeLendEvent({ ...repayFull(1), topic: [sym("repay_full")] }, CONTRACT)).toThrow("no subject");
  });

  test("raw_xdr decodes back to the stored columns", () => {
    for (const event of [repayFull(1), supply(2)]) {
      const row = decodeLendEvent(event, CONTRACT)!;
      expect(decodeRawXdr(row.rawXdr)).toEqual({ name: row.name, subject: row.subject, data: row.data });
    }
  });
});

describe("runLendEventsCycle", () => {
  test("an empty archive starts from the deployment ledger", async () => {
    const server = pages({ events: [], cursor: cursorN(1) });
    await cycle(fresh(), server);
    expect(server.getEvents.mock.calls[0]).toEqual([expect.objectContaining({ startLedger: DEPLOY_LEDGER })] as never);
  });

  test("an empty archive with no deployment ledger refuses to start", async () => {
    const store = fresh();
    const server = pages({ events: [], cursor: cursorN(1) });
    await expect(
      runLendEventsCycle({
        server,
        contractId: CONTRACT,
        store,
        deployLedger: undefined,
        decodeEvent: decodeLendEvent as LendEventsCycleDeps["decodeEvent"],
      }),
    ).rejects.toThrow("WRITZ_LEND_DEPLOY_LEDGER");
    expect(server.getEvents).not.toHaveBeenCalled();
  });

  test("reads every page in order, then stops on an empty page", async () => {
    const store = fresh();
    const server = pages(
      { events: [repayFull(1), paused(2)], cursor: cursorN(1) },
      { events: [supply(3)], cursor: cursorN(2) },
      { events: [], cursor: cursorN(3) },
    );
    await cycle(store, server);
    expect(store.list(CONTRACT).map((r) => r.name)).toEqual(["repay_full", "supply"]);
    expect(store.readCursor()).toBe(cursorN(3));
    expect(store.lastLedger(CONTRACT)).toBe(103);
    expect(server.getEvents).toHaveBeenCalledTimes(3);
  });

  test("a duplicate event keeps one row", async () => {
    const store = fresh();
    await cycle(store, pages({ events: [repayFull(1), repayFull(1)], cursor: cursorN(1) }, { events: [], cursor: cursorN(2) }));
    expect(store.list(CONTRACT)).toHaveLength(1);
  });

  test("a malformed event stops the page with nothing written", async () => {
    const store = fresh();
    store.commit([], cursorN(5));
    const bad = { ...supply(2), topic: [sym("supply")] };
    await expect(cycle(store, pages({ events: [repayFull(1), bad], cursor: cursorN(6) }))).rejects.toThrow("no subject");
    expect(store.list(CONTRACT)).toEqual([]);
    expect(store.readCursor()).toBe(cursorN(5));
  });

  test("a failure between two pages keeps the first and resumes after it", async () => {
    const file = dbFile();
    const store = openLendEventStore(file);
    let call = 0;
    const server = {
      getEvents: mock(async () => {
        if (++call === 1) return { events: [repayFull(1)], cursor: cursorN(1) };
        throw new Error("startLedger must be within the ledger range");
      }),
    };
    await expect(cycle(store, server)).rejects.toThrow("ledger range");
    const reopened = openLendEventStore(file);
    expect(reopened.readCursor()).toBe(cursorN(1));
    const next = pages({ events: [supply(2)], cursor: cursorN(2) }, { events: [], cursor: cursorN(3) });
    await cycle(reopened, next);
    expect(next.getEvents.mock.calls[0]).toEqual([expect.objectContaining({ cursor: cursorN(1) })] as never);
    expect(reopened.list(CONTRACT).map((r) => r.id)).toEqual(["event-0001", "event-0002"]);
  });

  test("a bad cursor from the RPC writes no rows", async () => {
    const store = fresh();
    await expect(cycle(store, pages({ events: [repayFull(1)], cursor: "nope" }))).rejects.toThrow("Invalid");
    expect(store.list(CONTRACT)).toEqual([]);
  });

  test("each contract keeps its own rows", async () => {
    const store = fresh();
    await cycle(store, pages({ events: [repayFull(1)], cursor: cursorN(1) }, { events: [], cursor: cursorN(2) }));
    expect(store.list("COTHER")).toEqual([]);
    expect(store.lastLedger("COTHER")).toBeNull();
  });
});
