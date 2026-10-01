import { describe, expect, test } from "bun:test";
import { releaseBlocker } from "./release";

const PUBKEY = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const position = { btcPubkey: PUBKEY, timelockHeight: 300_000, txid: "ab".repeat(32) };
const onNetwork = (a: string) => a.startsWith("tb1");

describe("releaseBlocker", () => {
  test("needs the deposit's Bitcoin details", () => {
    expect(releaseBlocker({ ...position, btcPubkey: undefined }, { address: "tb1q", pubkey: PUBKEY }, onNetwork)).toBe(
      "missing_details",
    );
  });

  test("needs a connected wallet", () => {
    expect(releaseBlocker(position, { address: null, pubkey: null }, onNetwork)).toBe("no_wallet");
  });

  test("the connected key must be the deposit's", () => {
    expect(releaseBlocker(position, { address: "tb1q", pubkey: "02" + "33".repeat(32) }, onNetwork)).toBe("wrong_account");
    expect(releaseBlocker(position, { address: "tb1q", pubkey: PUBKEY.toUpperCase() }, onNetwork)).toBeNull();
  });

  test("the destination must be on the configured network", () => {
    expect(releaseBlocker(position, { address: "bc1q", pubkey: PUBKEY }, onNetwork)).toBe("wrong_network");
  });
});
