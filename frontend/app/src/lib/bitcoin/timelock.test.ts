import { describe, expect, it } from "bun:test";
import * as bitcoin from "bitcoinjs-lib";
import { deriveP2WSH } from "./address";
import {
  chooseDepositTimelock,
  findDepositOutput,
  MAX_TIMELOCK_MARGIN,
  TIMELOCK_STEP,
} from "./timelock";

const PROTOCOL = "02" + "11".repeat(32);
const USER = "03" + "22".repeat(32);
const OTHER_USER = "02" + "44".repeat(32);

/** A one-input transaction paying `value` to each scriptPubKey in `outputs`. */
function rawTx(outputs: Array<{ script: Buffer; value: number }>): string {
  const tx = new bitcoin.Transaction();
  tx.addInput(Buffer.alloc(32, 0xaa), 0);
  for (const o of outputs) tx.addOutput(o.script, o.value);
  return tx.toHex();
}

describe("chooseDepositTimelock", () => {
  it("lands inside the contract's window even if confirmation takes weeks", () => {
    const tip = 900_123;
    const t = chooseDepositTimelock(tip);
    expect(t % TIMELOCK_STEP).toBe(0);
    // Confirmed immediately, or ~10 weeks later: still 1,008..=105,000 above.
    for (const confirmed of [tip, tip + 10_080]) {
      expect(t - confirmed).toBeGreaterThanOrEqual(1_008);
      expect(t - confirmed).toBeLessThanOrEqual(MAX_TIMELOCK_MARGIN);
    }
  });
});

describe("findDepositOutput", () => {
  const tip = 900_123;
  const timelock = chooseDepositTimelock(tip - 5_000);
  const mine = deriveP2WSH(PROTOCOL, USER, timelock).scriptPubKey;
  const theirs = deriveP2WSH(PROTOCOL, OTHER_USER, timelock).scriptPubKey;
  const change = Buffer.concat([Buffer.from([0x00, 0x14]), Buffer.alloc(20, 0x55)]);

  it("recovers the timelock, vout and value without a hint", () => {
    const hex = rawTx([
      { script: change, value: 5_000 },
      { script: mine, value: 250_000 },
    ]);
    expect(
      findDepositOutput({ rawTxHex: hex, protocolPubkeyHex: PROTOCOL, userPubkeyHex: USER, tipHeight: tip }),
    ).toEqual({ timelockHeight: timelock, vout: 1, valueSats: 250_000n });
  });

  it("uses a hint that is not on the step grid", () => {
    const odd = 950_321;
    const script = deriveP2WSH(PROTOCOL, USER, odd).scriptPubKey;
    const hex = rawTx([{ script, value: 100_000 }]);
    expect(
      findDepositOutput({
        rawTxHex: hex, protocolPubkeyHex: PROTOCOL, userPubkeyHex: USER, tipHeight: tip, hintTimelock: odd,
      }),
    ).toEqual({ timelockHeight: odd, vout: 0, valueSats: 100_000n });
  });

  it("does not match an output locked to someone else's key", () => {
    const hex = rawTx([{ script: theirs, value: 250_000 }]);
    expect(
      findDepositOutput({ rawTxHex: hex, protocolPubkeyHex: PROTOCOL, userPubkeyHex: USER, tipHeight: tip }),
    ).toBeNull();
  });
});
