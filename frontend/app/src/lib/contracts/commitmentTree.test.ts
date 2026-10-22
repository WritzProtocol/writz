import { describe, expect, it } from "bun:test";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { lookupDepositTxid, type DepositEventsServer } from "./commitmentTree";

const COMMITMENT_HEX = "ab".repeat(32);
const OTHER_COMMITMENT_HEX = "cd".repeat(32);
const REAL_TXID = Buffer.alloc(32, 0x11);

function fakeServer(events: { topic: unknown[]; value: unknown }[]): DepositEventsServer {
  return {
    getLatestLedger: async () => ({ sequence: 1_000_000 }),
    getEvents: async () => ({ events }),
  };
}

function depositEvent(commitmentHex: string, txid: Buffer, depositor = "GDEPOSITORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX") {
  return {
    topic: [
      nativeToScVal("deposit", { type: "symbol" }),
      nativeToScVal(Buffer.from(commitmentHex, "hex"), { type: "bytes" }),
    ],
    value: nativeToScVal({ depositor, txid, nullifier: Buffer.alloc(32), enc_note: Buffer.alloc(0) }),
  };
}

describe("lookupDepositTxid", () => {
  it("returns the real deposit txid for a matching DepositEvent", async () => {
    const server = fakeServer([depositEvent(COMMITMENT_HEX, REAL_TXID)]);
    const result = await lookupDepositTxid(COMMITMENT_HEX, server, "CTEST");
    expect(result).toEqual(REAL_TXID);
  });

  it("does not match a DIFFERENT commitment's deposit event", async () => {
    const server = fakeServer([depositEvent(OTHER_COMMITMENT_HEX, REAL_TXID)]);
    const result = await lookupDepositTxid(COMMITMENT_HEX, server, "CTEST");
    expect(result).toBeUndefined();
  });

  it("returns undefined when no events exist at all", async () => {
    const server = fakeServer([]);
    const result = await lookupDepositTxid(COMMITMENT_HEX, server, "CTEST");
    expect(result).toBeUndefined();
  });

  it("ignores non-deposit events (e.g. borrow/repay) with unrelated topic shapes", async () => {
    const server = fakeServer([
      {
        topic: [nativeToScVal("borrow", { type: "symbol" })],
        value: nativeToScVal({ borrower: "GX", usdc_amount: 1 }),
      },
      depositEvent(COMMITMENT_HEX, REAL_TXID),
    ]);
    const result = await lookupDepositTxid(COMMITMENT_HEX, server, "CTEST");
    expect(result).toEqual(REAL_TXID);
  });
});
