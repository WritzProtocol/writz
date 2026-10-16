import { describe, expect, test } from "bun:test";
import { healthStatus } from "@/lib/status/derive";
import { badgeOf } from "./parts";

describe("badgeOf", () => {
  test.each([
    [16_000n, "Healthy", "positive"],
    [15_000n, "Healthy", "positive"],
    [14_999n, "Below borrow limit", "info"],
    [13_000n, "Below borrow limit", "info"],
    [12_999n, "Close to liquidation", "warning"],
    [12_000n, "Close to liquidation", "warning"],
    [11_999n, "Can be liquidated now", "danger"],
  ] as const)("ratio %p bp reads %p", (bp, label, tone) => {
    expect(badgeOf(healthStatus(bp))).toEqual({ label, tone });
  });
});
