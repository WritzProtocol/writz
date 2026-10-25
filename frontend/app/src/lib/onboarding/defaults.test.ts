import { describe, expect, test } from "bun:test";
import { repayShortfallStroops, satsToBtcInput, suggestBorrowStroops, suggestDepositSats } from "./defaults";

describe("suggestDepositSats", () => {
  test("the faucet payout leaves 19,000 sats to lock", () => {
    expect(suggestDepositSats(20_000n, 5_000n)).toBe(19_000n);
  });
  test("rounds down and keeps the fee reserve", () => {
    expect(suggestDepositSats(18_765n, 5_000n)).toBe(17_000n);
    expect(suggestDepositSats(6_000n, 5_000n)).toBe(5_000n);
  });
  test("null below the contract minimum", () => {
    expect(suggestDepositSats(5_999n, 5_000n)).toBeNull();
    expect(suggestDepositSats(0n, 5_000n)).toBeNull();
  });
});

describe("suggestBorrowStroops", () => {
  test("a quarter of the safe maximum, in whole cents", () => {
    // 13.9861234 USDC max -> 3.4965308 -> 3.49
    expect(suggestBorrowStroops(139_861_234n)).toBe(34_900_000n);
  });
  test("null when it rounds to nothing", () => {
    expect(suggestBorrowStroops(300_000n)).toBeNull();
    expect(suggestBorrowStroops(0n)).toBeNull();
  });
});

test("satsToBtcInput", () => {
  expect(satsToBtcInput(19_000n)).toBe("0.00019");
  expect(satsToBtcInput(100_000_000n)).toBe("1");
  expect(satsToBtcInput(150_000_001n)).toBe("1.50000001");
});

describe("repayShortfallStroops", () => {
  test("covers interest to the next cent", () => {
    expect(repayShortfallStroops(35_000_024n, 35_000_000n)).toBe(100_000n);
    expect(repayShortfallStroops(35_150_000n, 35_000_000n)).toBe(200_000n);
  });
  test("nothing when the wallet covers the debt", () => {
    expect(repayShortfallStroops(35_000_000n, 35_000_000n)).toBe(0n);
    expect(repayShortfallStroops(1n, 2n)).toBe(0n);
  });
});
