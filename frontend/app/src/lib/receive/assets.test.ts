import { describe, expect, test } from "bun:test";
import { debtLine, offeredSwapAssets, swapAsset } from "./assets";

describe("offeredSwapAssets", () => {
  test("the stablecoins come before XLM, and each is configured on testnet", () => {
    expect(offeredSwapAssets(["eurc", "pyusd", "usdt0", "xlm"]).map((a) => a.id)).toEqual(["eurc", "pyusd", "usdt0", "xlm"]);
  });

  test("follows the configured order and drops unknown or repeated ids", () => {
    expect(offeredSwapAssets(["usdt0", "dai", "xlm", "usdt0"]).map((a) => a.id)).toEqual(["usdt0", "xlm"]);
    expect(offeredSwapAssets([])).toEqual([]);
  });

  test("every stablecoin carries its classic asset for the trustline; XLM needs none", () => {
    for (const a of offeredSwapAssets(["eurc", "pyusd", "usdt0", "xlm"])) {
      if (a.id === "xlm") expect(a.classic).toBeNull();
      else expect(a.classic?.issuer).toMatch(/^G[A-Z2-7]{55}$/);
      expect(a.token).toMatch(/^C[A-Z2-7]{55}$/);
    }
  });

  test("the USDT0 test token never reads as the official USDT0", () => {
    expect(swapAsset("usdt0")?.network).toBe("Writz testnet token");
  });
});

describe("debtLine", () => {
  test("dollar stablecoins barely move the debt; EURC and XLM do", () => {
    expect(debtLine({ id: "pyusd", label: "PYUSD", usd: true })).toMatch(/barely moves/);
    expect(debtLine({ id: "eurc", label: "EURC", usd: false })).toMatch(/euro against the dollar/);
    expect(debtLine({ id: "xlm", label: "XLM", usd: false })).toMatch(/price of XLM/);
  });
});
