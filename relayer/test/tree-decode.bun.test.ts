import { describe, expect, it } from "bun:test";
import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { decodeTreeEvent } from "../src/tree-watcher/decode";

const b32 = (n: bigint) => Buffer.from(n.toString(16).padStart(64, "0"), "hex");
const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const bytes = (b: Buffer) => xdr.ScVal.scvBytes(b);
const map = (o: Record<string, xdr.ScVal>) =>
  xdr.ScVal.scvMap(Object.keys(o).sort().map((k) => new xdr.ScMapEntry({ key: sym(k), val: o[k]! })));

describe("decodeTreeEvent", () => {
  it("reads insert_leaf as an insert at its leaf index", () => {
    const d = decodeTreeEvent({
      topic: [sym("insert_leaf"), bytes(b32(7n))],
      value: map({ commitment: bytes(b32(22n)), leaf_index: nativeToScVal(3, { type: "u32" }) }),
    });
    expect(d.event).toEqual({ kind: "insert", commitment: 22n, leafIndex: 3, newRoot: 7n });
  });

  it("reads borrow and repay as leaf updates, with their note", () => {
    for (const name of ["borrow", "repay"]) {
      const d = decodeTreeEvent({
        topic: [sym(name), bytes(b32(9n))],
        value: map({ new_commitment: bytes(b32(44n)), enc_note: bytes(Buffer.from("beef", "hex")) }),
      });
      expect(d.event).toEqual({ kind: "update", newCommitment: 44n, newRoot: 9n });
      expect(d.encNote).toBe("beef");
    }
  });

  it("reads a borrow's keeper note (#212)", () => {
    const d = decodeTreeEvent({
      topic: [sym("borrow"), bytes(b32(9n))],
      value: map({
        new_commitment: bytes(b32(44n)),
        enc_note: bytes(Buffer.alloc(0)),
        keeper_note: xdr.ScVal.scvVec([1n, 2n, 3n, 4n, 5n].map((n) => bytes(b32(n)))),
      }),
    });
    expect(d.keeperNote).toEqual([1n, 2n, 3n, 4n, 5n]);
    expect(d.encNote).toBeUndefined();
  });

  it("ignores other events", () => {
    expect(decodeTreeEvent({ topic: [sym("deposit"), bytes(b32(1n))], value: map({}) }).event).toBeUndefined();
  });
});
