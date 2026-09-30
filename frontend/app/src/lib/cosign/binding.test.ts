import { describe, expect, it } from "bun:test";
import { verifyReleaseBinding, type ReleaseBindingInput } from "./binding";

const COMMITMENT_HEX = "ab".repeat(32);
const OTHER_COMMITMENT_HEX = "cd".repeat(32);
const ROOT_HEX = "ef".repeat(32);
const COMMITMENT_DECIMAL = BigInt("0x" + COMMITMENT_HEX).toString();
const ROOT_DECIMAL = BigInt("0x" + ROOT_HEX).toString();
const REAL_TXID = Buffer.alloc(32, 0x11);
const OTHER_TXID = Buffer.alloc(32, 0x22);

function validInput(): ReleaseBindingInput {
  return {
    publicSignals: [COMMITMENT_DECIMAL, ROOT_DECIMAL],
    commitmentHex: COMMITMENT_HEX,
    onChainRootHex: ROOT_HEX,
    depositTxid: REAL_TXID,
    psbtInputHash: Buffer.from(REAL_TXID),
  };
}

describe("verifyReleaseBinding", () => {
  it("accepts a fully consistent binding", () => {
    expect(verifyReleaseBinding(validInput())).toEqual({ ok: true });
  });

  it("GHSA-6jmp-wf3x-3vxh PoC: a valid zero-debt proof about a DIFFERENT position is rejected", () => {
    // Attacker holds a real, valid zero-debt proof about their own
    // debt-free position (OTHER_COMMITMENT_HEX), but claims it releases a
    // different, still-indebted position (COMMITMENT_HEX).
    const input = validInput();
    input.publicSignals = [BigInt("0x" + OTHER_COMMITMENT_HEX).toString(), ROOT_DECIMAL];
    const result = verifyReleaseBinding(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/different position/);
  });

  it("GHSA-9j8g-prh5-jhhj PoC: a correctly-bound proof paired with a PSBT spending a DIFFERENT UTXO is rejected", () => {
    // The proof genuinely matches the claimed commitment and the claimed
    // commitment genuinely has a real deposit behind it - but the PSBT in
    // this request spends a different transaction's output entirely.
    const input = validInput();
    input.psbtInputHash = Buffer.from(OTHER_TXID);
    const result = verifyReleaseBinding(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/does not spend the Bitcoin transaction/);
  });

  it("rejects when no on-chain DepositEvent was found for the commitment", () => {
    const input = validInput();
    input.depositTxid = undefined;
    const result = verifyReleaseBinding(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/No on-chain DepositEvent/);
  });

  it("rejects a stale proof whose merkle_root no longer matches the chain", () => {
    const input = validInput();
    input.publicSignals = [COMMITMENT_DECIMAL, BigInt("0x" + ROOT_HEX).toString() + "1"];
    const result = verifyReleaseBinding(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/merkle_root/);
  });

  it("rejects when the PSBT has no input to compare at all", () => {
    const input = validInput();
    input.psbtInputHash = undefined;
    const result = verifyReleaseBinding(input);
    expect(result.ok).toBe(false);
  });
});
