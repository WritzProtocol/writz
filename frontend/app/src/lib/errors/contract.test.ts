import { describe, expect, it } from "bun:test";
import { CommitmentTreeError } from "@/lib/contracts/generated";
import { BitcoinSpvError, resolveContractError } from "./contract";

const TREE = "CDQCTFO3FK3M47QS47O2A4WLNPSQAQBSXBFPJ6RZEHFO5D7RY34FSBBP";
const SPV = "CB2BD6QCSZVNZN5NLI7C5NF356WXVJDSXT6LVAQFWHHS4SZ4NCKKNIVA";
const IDS = { commitmentTree: TREE, bitcoinSpv: SPV };

// Captured from a testnet simulation of withdraw_supply over the caller's balance.
const WITHDRAW_OVER_BALANCE = `Transaction simulation failed: "HostError: Error(Contract, #15)

Event log (newest first):
   0: [Diagnostic Event] contract:${TREE}, topics:[error, Error(Contract, #15)], data:"escalating Ok(ScErrorType::Contract) frame-exit to Err"
   1: [Diagnostic Event] topics:[fn_call, ${TREE}, withdraw_supply], data:[GAIAVCKZFTTIZZZJQIWYGIX73WQLKBLCJZKW6M4HSE7INYTQMQ5ABJFB, 1]
"`;

const SPV_THROUGH_DEPOSIT = `HostError: Error(Contract, #2)

Event log (newest first):
   0: [Diagnostic Event] contract:${TREE}, topics:[error, Error(Contract, #2)], data:"escalating error to panic"
   1: [Diagnostic Event] contract:${SPV}, topics:[error, Error(Contract, #2)], data:"escalating Ok(ScErrorType::Contract) frame-exit to Err"
   2: [Diagnostic Event] contract:${TREE}, topics:[fn_call, ${SPV}, verify_tx], data:[]
   3: [Diagnostic Event] topics:[fn_call, ${TREE}, deposit], data:[]`;

describe("resolveContractError", () => {
  it("maps a bare commitment-tree code to its deployed variant", () => {
    expect(resolveContractError(WITHDRAW_OVER_BALANCE, IDS)).toEqual({
      contract: "commitment-tree",
      code: 15,
      variant: "WithdrawExceedsBalance",
    });
  });

  it("uses the generated table for every commitment-tree code", () => {
    for (const [code, { message }] of Object.entries(CommitmentTreeError)) {
      expect(resolveContractError(`HostError: Error(Contract, #${code})`, IDS)?.variant).toBe(message);
    }
  });

  it("attributes a failure escalated from bitcoin-spv to the contract that raised it", () => {
    expect(resolveContractError(SPV_THROUGH_DEPOSIT, IDS)).toEqual({
      contract: "bitcoin-spv",
      code: 2,
      variant: "InsufficientConfirmations",
    });
    expect(BitcoinSpvError[2].message).toBe("InsufficientConfirmations");
  });

  it("leaves a code the deployed table doesn't know without a variant", () => {
    expect(resolveContractError("HostError: Error(Contract, #99)", IDS)).toEqual({
      contract: "commitment-tree",
      code: 99,
      variant: undefined,
    });
  });

  it("does not guess when the failing contract is one the app has no table for", () => {
    const other = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
    const msg = `HostError: Error(Contract, #10)\n   0: [Diagnostic Event] contract:${other}, topics:[error, Error(Contract, #10)], data:""`;
    expect(resolveContractError(msg, IDS)).toBeNull();
  });

  it("returns null for anything that isn't a contract failure", () => {
    expect(resolveContractError("Account not found: GABC", IDS)).toBeNull();
    expect(resolveContractError("RootMismatch", IDS)).toBeNull();
  });
});
