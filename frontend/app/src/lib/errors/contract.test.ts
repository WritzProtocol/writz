import { describe, expect, it } from "bun:test";
import { WritzLendError } from "@/lib/contracts/writzLendGenerated";
import { BitcoinSpvError, resolveContractError } from "./contract";

const SPV = "CB2BD6QCSZVNZN5NLI7C5NF356WXVJDSXT6LVAQFWHHS4SZ4NCKKNIVA";
const LEND = "CCMSOCBVX2S645MQFFXJRHVHRWH2NY62KLOJXNDYFOJRYHIC47EO6ZZK";
const IDS = { writzLend: LEND, bitcoinSpv: SPV };

const SPV_THROUGH_DEPOSIT = `HostError: Error(Contract, #2)

Event log (newest first):
   0: [Diagnostic Event] contract:${LEND}, topics:[error, Error(Contract, #2)], data:"escalating error to panic"
   1: [Diagnostic Event] contract:${SPV}, topics:[error, Error(Contract, #2)], data:"escalating Ok(ScErrorType::Contract) frame-exit to Err"
   2: [Diagnostic Event] contract:${LEND}, topics:[fn_call, ${SPV}, verify_tx], data:[]
   3: [Diagnostic Event] topics:[fn_call, ${LEND}, deposit], data:[]`;

describe("resolveContractError", () => {
  it("reads a bare code with the table of the contract the flow calls", () => {
    for (const [code, { message }] of Object.entries(WritzLendError)) {
      expect(resolveContractError(`HostError: Error(Contract, #${code})`, IDS)?.variant).toBe(message);
    }
  });

  it("attributes a writz-lend failure from its event log", () => {
    const msg = `HostError: Error(Contract, #10)\n   0: [Diagnostic Event] contract:${LEND}, topics:[error, Error(Contract, #10)], data:""`;
    expect(resolveContractError(msg, IDS)).toEqual({
      contract: "writz-lend",
      code: 10,
      variant: "ExceedsCollateralRatio",
    });
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
      contract: "writz-lend",
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
