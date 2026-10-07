import { describe, expect, it } from "bun:test";
import { simulateWithRetry } from "./submit";

describe("simulateWithRetry", () => {
  it("returns the first successful result without retrying", async () => {
    let calls = 0;
    const result = await simulateWithRetry(async () => {
      calls++;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries a transient RootMismatch (#5) until it succeeds", async () => {
    let calls = 0;
    const result = await simulateWithRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error("HostError: Error(Contract, #5)");
        return "ok";
      },
      5,
      1,
      1,
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("does not retry a permanent error (InvalidZkProof #4)", async () => {
    let calls = 0;
    await expect(
      simulateWithRetry(
        async () => {
          calls++;
          throw new Error("HostError: Error(Contract, #4)");
        },
        5,
        1,
        1,
      ),
    ).rejects.toThrow("#4");
    expect(calls).toBe(1);
  });

  it("does not retry NullifierAlreadySpent (#6), the error a released leaf now hits", async () => {
    let calls = 0;
    await expect(
      simulateWithRetry(
        async () => {
          calls++;
          throw new Error("HostError: Error(Contract, #6)");
        },
        5,
        1,
        1,
      ),
    ).rejects.toThrow("#6");
    expect(calls).toBe(1);
  });

  it("gives up after the attempts are exhausted and surfaces the last error", async () => {
    let calls = 0;
    await expect(
      simulateWithRetry(
        async () => {
          calls++;
          throw new Error("txBadSeq");
        },
        3,
        1,
        1,
      ),
    ).rejects.toThrow("txBadSeq");
    expect(calls).toBe(3);
  });
});
