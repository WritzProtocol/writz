import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { getScenario } from "@/lib/mock/scenarios";
import { toExactFieldValue } from "@/lib/loan/model";
import { LendView } from "./LendView";
import { useMockLend } from "./useMockLend";
import { balanceDecimals, formatApr, lendSides } from "./model";

const NOW = 1_800_000_000_000;
const STROOP = 10_000_000n;

function Probe({ id }: { id: string }) {
  return <LendView m={useMockLend(getScenario(id)!.build(NOW))} />;
}

const render = (id: string) => renderToStaticMarkup(<Probe id={id} />);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("formatApr", () => {
  test("two decimals, rounded down, and a floor for tiny rates", () => {
    expect(formatApr(0)).toBe("0.00%");
    expect(formatApr(0.0228)).toBe("2.28%");
    expect(formatApr(0.019999)).toBe("1.99%");
    expect(formatApr(0.0001)).toBe("0.01%");
    expect(formatApr(0.00006)).toBe("under 0.01%");
  });
});

describe("balanceDecimals", () => {
  const pool = (totalBorrowed: bigint) => ({
    kind: "ok" as const,
    value: { totalSupplied: 100n * STROOP, totalBorrowed, available: 100n * STROOP - totalBorrowed, borrowRateBp: 0n },
  });
  test("every stroop while anything is borrowed, cents otherwise", () => {
    expect(balanceDecimals(pool(1n))).toBe(7);
    expect(balanceDecimals(pool(0n))).toBe(2);
    expect(balanceDecimals({ kind: "checking" })).toBe(2);
  });
});

describe("Max on Withdraw", () => {
  test("fills the field with the exact balance, not the cents", () => {
    const balance = 2_500n * STROOP + 412_337n;
    const sides = lendSides(
      { kind: "ok", value: 0n },
      { kind: "ok", value: balance },
      { kind: "ok", value: { totalSupplied: 10_000n * STROOP, totalBorrowed: 0n, available: 10_000n * STROOP, borrowRateBp: 0n } },
    );
    expect(sides.out.max).toBe(balance);
    expect(sides.out.maxField!(balance)).toBe("2,500.0412337");
    expect(toExactFieldValue(50n * STROOP)).toBe("50.00");
    expect(toExactFieldValue(50n * STROOP + 5_000_000n)).toBe("50.50");
  });
});

describe("LendView", () => {
  test("rate above 0: the supply rate and the balance to the stroop", () => {
    const t = text(render("N7"));
    expect(t).toContain("Your balance");
    expect(t).toContain("2,500.0412337 USDC");
    expect(t).toMatch(/Supply rate \d+\.\d\d% APR/);
    expect(t).not.toContain("You supplied");
  });

  test("rate 0: 0.00% and the balance in cents", () => {
    const t = text(render("N20"));
    expect(t).toContain("Supply rate 0.00%");
    expect(t).toContain("2,500.00 USDC");
  });

  test("a rate too small for two decimals reads under 0.01%", () => {
    expect(text(render("N21"))).toContain("Supply rate under 0.01%");
  });

  test("a read failure keeps the last good values and says when they were read", () => {
    const t = text(render("N18"));
    expect(t).toContain("Last updated");
    expect(t).toContain("2,500.0412337 USDC");
    expect(t).toMatch(/Supply rate \d+\.\d\d%/);
  });

  test("disconnected: the rate is shown next to the pool", () => {
    expect(text(render("N1"))).toMatch(/Supply rate \d+\.\d\d%/);
  });
});
