import { describe, expect, it } from "bun:test";
import { isTransientSimulationError, simulateWithRetry } from "./submit";
import { spvProofUrl } from "./deposit";
import { config } from "@/config";

describe("isTransientSimulationError", () => {
  it("retries state lag and throttling", () => {
    expect(isTransientSimulationError("HostError: Error(Contract, #5)")).toBe(true);
    expect(isTransientSimulationError("TRY_AGAIN_LATER")).toBe(true);
    expect(isTransientSimulationError("txBadSeq")).toBe(true);
  });

  it("fails fast on an unfunded account and on permanent contract errors", () => {
    expect(isTransientSimulationError("Account not found: GABC")).toBe(false);
    expect(isTransientSimulationError("HostError: Error(Contract, #15)")).toBe(false);
  });
});

describe("simulateWithRetry", () => {
  it("throws an unfunded account on the first attempt", async () => {
    let calls = 0;
    const e = await simulateWithRetry(async () => {
      calls++;
      throw new Error("Account not found: GABC");
    }, 8, 1, 1).catch((err: unknown) => err);
    expect((e as Error).message).toContain("Account not found");
    expect(calls).toBe(1);
  });

  it("retries a RootMismatch until it clears", async () => {
    let calls = 0;
    const out = await simulateWithRetry(async () => {
      if (++calls < 3) throw new Error("HostError: Error(Contract, #5)");
      return "ok";
    }, 8, 1, 1);
    expect(out).toBe("ok");
    expect(calls).toBe(3);
  });
});

describe("spvProofUrl", () => {
  it("asks the relayer for the confirmation count this app requires", () => {
    expect(spvProofUrl("https://relayer.example", "ab".repeat(32))).toBe(
      `https://relayer.example/spv-proof/${"ab".repeat(32)}?confirmations=${config.bitcoin.minConfirmations}`,
    );
  });
});
