import { describe, expect, test } from "bun:test";
import { reclaimWindow } from "./model";

describe("reclaimWindow", () => {
  test("counts the blocks left before the timelock", () => {
    expect(reclaimWindow(300_000, 299_990)).toEqual({ kind: "future", blocksLeft: 10 });
  });

  test("the timelock block itself is already reclaimable", () => {
    expect(reclaimWindow(300_000, 300_000)).toEqual({ kind: "reached" });
  });

  test("an unknown tip says so instead of guessing", () => {
    expect(reclaimWindow(300_000, null)).toEqual({ kind: "unknown" });
  });
});
