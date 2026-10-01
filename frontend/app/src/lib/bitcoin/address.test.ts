import { describe, expect, test } from "bun:test";
import { isAddressForNetwork } from "./address";

describe("isAddressForNetwork (non-mainnet build)", () => {
  test("accepts a testnet address", () => {
    expect(isAddressForNetwork("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx")).toBe(true);
  });

  test("rejects a mainnet address and garbage", () => {
    expect(isAddressForNetwork("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).toBe(false);
    expect(isAddressForNetwork("not-an-address")).toBe(false);
    expect(isAddressForNetwork("")).toBe(false);
  });
});
