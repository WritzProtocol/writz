import { describe, expect, it } from "@jest/globals";
import { assertValidCursor, cursorForLedger, isValidCursor } from "../src/rpc-cursor";

describe("cursorForLedger", () => {
  it("builds the cursor that precedes a ledger's first event", () => {
    // Verified against Soroban testnet RPC: this cursor returns the events of
    // ledger 4575790 onward, where a hand-written "4575790-0" was rejected.
    expect(cursorForLedger(4575790)).toBe("0019652868403363840-0000000000");
  });

  it("produces cursors this module accepts", () => {
    for (const ledger of [1, 1000, 4575790, 4606448, 99999999]) {
      expect(isValidCursor(cursorForLedger(ledger))).toBe(true);
    }
  });

  it("stays exact past Number.MAX_SAFE_INTEGER", () => {
    // A ledger shifted 32 bits exceeds 2^53 well before any realistic
    // sequence, so the shift has to happen in BigInt or the low digits rot.
    const cursor = cursorForLedger(4606448);
    const toid = BigInt(cursor.split("-")[0]!);
    expect(toid >> 32n).toBe(4606448n);
  });

  it("refuses a sequence that is not a ledger", () => {
    expect(() => cursorForLedger(-1)).toThrow(/non-negative integer/);
    expect(() => cursorForLedger(1.5)).toThrow(/non-negative integer/);
  });
});

describe("isValidCursor", () => {
  it("accepts the shape Soroban RPC returns", () => {
    expect(isValidCursor("0019652872698339328-0000000000")).toBe(true);
    expect(isValidCursor("0019652868403388416-0000000001")).toBe(true);
  });

  it("rejects the shapes a person writes by hand", () => {
    // Every one of these is what someone reaches for when told to "rewind the
    // cursor to ledger N". The first is the one that actually stalled the
    // vault watcher in production.
    for (const bad of [
      "4575790-0",
      "4575790",
      "0019652868403363840",
      "0019652868403363840-0",
      "19652868403363840-0000000000",
      "0019652868403363840-00000000000",
      "",
      "latest",
    ]) {
      expect(isValidCursor(bad)).toBe(false);
    }
  });
});

describe("assertValidCursor", () => {
  it("names the offending value, the format, and how to build one", () => {
    let message = "";
    try {
      assertValidCursor("4575790-0");
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain('"4575790-0"');
    expect(message).toContain("19-digit TOID");
    expect(message).toContain("cursorForLedger");
  });

  it("passes a cursor it built itself", () => {
    expect(() => assertValidCursor(cursorForLedger(4575790))).not.toThrow();
  });
});
