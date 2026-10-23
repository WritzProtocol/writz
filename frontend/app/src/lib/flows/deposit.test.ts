import { describe, expect, it } from "bun:test";
import { depositArgs } from "./deposit";

describe("depositArgs", () => {
  it("maps the relayer's SPV bundle and the lock onto writz-lend.deposit", () => {
    const scriptPubKey = Buffer.from("0020" + "aa".repeat(32), "hex");
    const keySig = Buffer.alloc(65, 0x1f);
    const args = depositArgs({
      pd: { stellarAddress: "GDEPOSITOR", btcPubkey: "02" + "11".repeat(32) },
      bundle: {
        sorobanArgs: {
          block_hash: "bb".repeat(32),
          merkle_proof: ["cc".repeat(32), "dd".repeat(32)],
          tx_index: 3,
          raw_tx: "0200000001",
          min_confirmations: 1,
        },
      },
      scriptPubKey,
      timelockHeight: 312_000,
      keySig,
    });
    expect(args).toEqual({
      depositor: "GDEPOSITOR",
      block_hash: Buffer.from("bb".repeat(32), "hex"),
      merkle_proof: [Buffer.from("cc".repeat(32), "hex"), Buffer.from("dd".repeat(32), "hex")],
      tx_index: 3,
      raw_tx: Buffer.from("0200000001", "hex"),
      p2wsh_script_pubkey: scriptPubKey,
      timelock_height: 312_000,
      user_pubkey: Buffer.from("02" + "11".repeat(32), "hex"),
      key_sig: keySig,
    });
  });
});
