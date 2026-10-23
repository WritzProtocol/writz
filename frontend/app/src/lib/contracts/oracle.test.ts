import { describe, expect, it } from "bun:test";
import { MAX_PRICE_AGE_SECS, priceToStroops } from "./oracle";

const NOW = 1_800_000_000;

describe("priceToStroops", () => {
  it("converts Reflector's decimals to USDC stroops per BTC, as the contract does", () => {
    // Reflector reports 14 decimals: $81,243.30.
    expect(priceToStroops({ price: 8_124_330_000_000_000_000n, timestamp: BigInt(NOW) }, 14, NOW)).toBe(812_433_000_000n);
    expect(priceToStroops({ price: 81_243n, timestamp: BigInt(NOW) }, 0, NOW)).toBe(812_430_000_000n);
  });

  it("refuses a stale or empty price instead of using it", () => {
    expect(() => priceToStroops({ price: 1n, timestamp: BigInt(NOW - MAX_PRICE_AGE_SECS - 1) }, 0, NOW)).toThrow("OraclePriceStale");
    expect(() => priceToStroops({ price: 0n, timestamp: BigInt(NOW) }, 7, NOW)).toThrow("OraclePriceUnavailable");
  });
});
