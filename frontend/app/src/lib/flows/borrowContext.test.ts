import { describe, expect, it } from "bun:test";
import { minTimelockFor, TIMELOCK_SLACK_BLOCKS } from "./borrowContext";

describe("minTimelockFor", () => {
  it("is the tip plus the contract's margin plus a cushion for the trailing SPV tip", () => {
    expect(minTimelockFor(900_000, 4_320)).toBe(900_000 + 4_320 + TIMELOCK_SLACK_BLOCKS);
  });

  it("lets a fresh deposit's year-long timelock borrow", () => {
    // The app locks deposits ~52,560 blocks out (lib/bitcoin/timelock).
    expect(900_000 + 52_560).toBeGreaterThan(minTimelockFor(900_000, 4_320));
  });
});
