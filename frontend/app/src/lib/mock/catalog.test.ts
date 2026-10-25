import { describe, expect, test } from "bun:test";
import { scenarioCatalog } from "./catalog";
import { mockEnabled } from "./gate";
import { SCENARIOS } from "./scenarios";

describe("dev scenarios index", () => {
  test("exists only while the mock harness is on, never on mainnet", () => {
    expect(scenarioCatalog(mockEnabled(undefined, "testnet"))).toBeNull();
    expect(scenarioCatalog(mockEnabled("1", "mainnet"))).toBeNull();
    expect(scenarioCatalog(mockEnabled("1", "testnet"))).not.toBeNull();
  });

  test("lists every scenario once, grouped, each linking to its route", () => {
    const groups = scenarioCatalog(true)!;
    expect(groups.map((g) => g.label)).toEqual([
      "Global",
      "Home",
      "Guided first loan",
      "Borrow",
      "Loan",
      "Earn",
      "Lend",
      "Protocol",
      "Reclaim",
      "Transactions",
      "Loan status",
    ]);
    const entries = groups.flatMap((g) => g.entries);
    expect(entries.map((e) => e.id).sort()).toEqual(SCENARIOS.map((s) => s.id).sort());
    expect(entries.find((e) => e.id === "B15")?.href).toBe("/borrow/new?scenario=B15");
    expect(entries.find((e) => e.id === "L24")?.href).toBe("/loans/7?scenario=L24");
  });
});
