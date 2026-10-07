import { describe, expect, it } from "bun:test";
import { createHash } from "crypto";
import { Transaction } from "@stellar/stellar-sdk";
import { buildInsertAuthTx, txidParts } from "./deposit";

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();
const sha256d = (b: Buffer) => sha256(sha256(b));

describe("txidParts", () => {
  it("splits the double-SHA256 of the raw transaction into two 128-bit halves", async () => {
    const raw = Buffer.from("0100000001deadbeef", "hex");
    const digest = sha256d(raw);
    const { lo, hi } = await txidParts(raw.toString("hex"));
    expect(BigInt(hi)).toBe(BigInt("0x" + digest.subarray(0, 16).toString("hex")));
    expect(BigInt(lo)).toBe(BigInt("0x" + digest.subarray(16, 32).toString("hex")));
  });

  it("gives different halves for different transactions", async () => {
    const a = await txidParts("00");
    const b = await txidParts("01");
    expect(a).not.toEqual(b);
  });
});

describe("buildInsertAuthTx", () => {
  const depositor = "GBZ36IZMIQHXQ467FCUGGIG4L7ZD4JY7EQ5THUT44PFYMWVA374DAVTV";
  const commitmentHex = "ab".repeat(32);

  it("builds one manageData op naming the commitment and signs it with the wallet", async () => {
    let signedInput = "";
    const signTransaction = async (xdr: string) => {
      signedInput = xdr;
      return { signedTxXdr: xdr, signerAddress: depositor };
    };

    const xdr = await buildInsertAuthTx(depositor, commitmentHex, signTransaction as never);
    expect(xdr).toBe(signedInput);

    const tx = new Transaction(xdr, "Test SDF Network ; September 2015");
    expect(tx.source).toBe(depositor);
    expect(tx.operations).toHaveLength(1);
    const op = tx.operations[0];
    expect(op.type).toBe("manageData");
    expect((op as { name: string }).name).toBe("writz-insert-commitment");
    expect(Buffer.from((op as { value: Buffer }).value).toString("hex")).toBe(commitmentHex);
  });
});
