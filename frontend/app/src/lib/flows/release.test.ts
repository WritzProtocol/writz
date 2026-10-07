import { describe, expect, it, mock } from "bun:test";

const calls: { method: string; args: unknown }[] = [];
let signed = false;

mock.module("@/lib/contracts/generated", () => ({
  Client: class {
    mark_released(args: unknown) {
      calls.push({ method: "mark_released", args });
      return Promise.resolve({
        signAndSend: async () => {
          signed = true;
          return { sendTransactionResponse: { hash: "abc123" } };
        },
      });
    }
  },
}));
const { markReleased } = await import("./release");

describe("markReleased", () => {
  it("submits the zero-debt proof and signals to mark_released and returns the tx hash", async () => {
    const proof = { pi_a: { bytes: Buffer.alloc(64) }, pi_b: { bytes: Buffer.alloc(128) }, pi_c: { bytes: Buffer.alloc(64) } };
    const publicSignals = [Buffer.alloc(32, 1), Buffer.alloc(32, 2), Buffer.alloc(32, 3)];

    const result = await markReleased({
      proof,
      publicSignals,
      sender: "GSENDER",
      contractId: "CTEST",
      signTransaction: (async () => ({ signedTxXdr: "", signerAddress: "GSENDER" })) as never,
    });

    expect(result.txHash).toBe("abc123");
    expect(signed).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("mark_released");
    expect(calls[0].args).toEqual({ zk_proof: proof, public_signals: publicSignals });
  });
});
