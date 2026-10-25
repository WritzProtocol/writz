/**
 * The deposit submission check behind GET /deposit-status?stellarTx=: the
 * envelope must be a writz-lend `deposit` for the requested txid, and a
 * failure is decoded to the most specific reason the chain records. Envelopes
 * are built with the real SDK from a throwaway in-memory account and never
 * signed or sent.
 */
import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { Account, Keypair, Networks, Operation, StrKey, TransactionBuilder, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import {
  checkDepositSubmission,
  depositTxidOfEnvelope,
  failureReason,
  type TransactionLookup,
} from "../src/lend/deposit-submission";

// The writz-lend testnet deployment; only its address encoding matters here.
const LEND = "CCMSOCBVX2S645MQFFXJRHVHRWH2NY62KLOJXNDYFOJRYHIC47EO6ZZK";
// Any other contract address.
const OTHER = StrKey.encodeContract(Buffer.alloc(32, 7));

const RAW_TX = Buffer.from("0200000001" + "ab".repeat(60), "hex");
const sha256d = (b: Buffer) => createHash("sha256").update(createHash("sha256").update(b).digest()).digest();
const TXID_INTERNAL = sha256d(RAW_TX).toString("hex");
const HASH = "cd".repeat(32);

function depositArgs(rawTx: Buffer): xdr.ScVal[] {
  return [
    nativeToScVal(Keypair.random().publicKey(), { type: "address" }),
    xdr.ScVal.scvBytes(Buffer.alloc(32, 1)),
    xdr.ScVal.scvVec([]),
    xdr.ScVal.scvU32(3),
    xdr.ScVal.scvBytes(rawTx),
    xdr.ScVal.scvBytes(Buffer.alloc(34, 2)),
    xdr.ScVal.scvU32(330_000),
    xdr.ScVal.scvBytes(Buffer.alloc(33, 3)),
    xdr.ScVal.scvBytes(Buffer.alloc(65, 4)),
  ];
}

function invoke(contract: string, fn: string, args: xdr.ScVal[]) {
  return new TransactionBuilder(new Account(Keypair.random().publicKey(), "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.invokeContractFunction({ contract, function: fn, args }))
    .setTimeout(300)
    .build();
}

const depositEnvelope = (rawTx = RAW_TX, contract = LEND) => invoke(contract, "deposit", depositArgs(rawTx)).toEnvelope();

const opResult = (inner: xdr.InvokeHostFunctionResult) =>
  xdr.OperationResult.opInner(xdr.OperationResultTr.invokeHostFunction(inner));

function txResult(result: xdr.TransactionResultResult): xdr.TransactionResult {
  return new xdr.TransactionResult({ feeCharged: xdr.Int64.fromString("100"), result, ext: new xdr.TransactionResultExt(0) });
}

const TRAPPED = txResult(xdr.TransactionResultResult.txFailed([opResult(xdr.InvokeHostFunctionResult.invokeHostFunctionTrapped())]));

function diagnostic(contract: string | null, error: xdr.ScError): xdr.DiagnosticEvent {
  return new xdr.DiagnosticEvent({
    inSuccessfulContractCall: false,
    event: new xdr.ContractEvent({
      ext: new xdr.ExtensionPoint(0),
      contractId: contract ? (StrKey.decodeContract(contract) as unknown as xdr.Hash) : null,
      type: xdr.ContractEventType.diagnostic(),
      body: new xdr.ContractEventBody(
        0,
        new xdr.ContractEventV0({ topics: [xdr.ScVal.scvSymbol("error"), xdr.ScVal.scvError(error)], data: xdr.ScVal.scvVoid() }),
      ),
    }),
  });
}

const server = (answer: TransactionLookup) => ({ getTransaction: async (h: string) => (expect(h).toBe(HASH), answer) });

describe("depositTxidOfEnvelope", () => {
  it("is the double SHA-256 of raw_tx, as bitcoin-spv derives the txid", () => {
    expect(depositTxidOfEnvelope(depositEnvelope(), LEND)).toBe(TXID_INTERNAL);
  });

  it("reads through a fee bump to the transaction the user signed", () => {
    const inner = invoke(LEND, "deposit", depositArgs(RAW_TX));
    const bump = TransactionBuilder.buildFeeBumpTransaction(Keypair.random(), "200", inner, Networks.TESTNET);
    expect(depositTxidOfEnvelope(bump.toEnvelope(), LEND)).toBe(TXID_INTERNAL);
  });

  it("is undefined for another contract, another function, or a call without raw_tx bytes", () => {
    expect(depositTxidOfEnvelope(depositEnvelope(RAW_TX, OTHER), LEND)).toBeUndefined();
    expect(depositTxidOfEnvelope(invoke(LEND, "borrow", depositArgs(RAW_TX)).toEnvelope(), LEND)).toBeUndefined();
    expect(depositTxidOfEnvelope(invoke(LEND, "deposit", depositArgs(RAW_TX).slice(0, 4)).toEnvelope(), LEND)).toBeUndefined();
    const args = depositArgs(RAW_TX);
    args[4] = xdr.ScVal.scvU32(1);
    expect(depositTxidOfEnvelope(invoke(LEND, "deposit", args).toEnvelope(), LEND)).toBeUndefined();
  });

  it("is undefined for a transaction that invokes no contract", () => {
    const noContract = new TransactionBuilder(new Account(Keypair.random().publicKey(), "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.bumpSequence({ bumpTo: "2" }))
      .setTimeout(300)
      .build();
    expect(depositTxidOfEnvelope(noContract.toEnvelope(), LEND)).toBeUndefined();
  });
});

describe("failureReason", () => {
  it("names the WritzLendError writz-lend returned", () => {
    const events = [diagnostic(OTHER, xdr.ScError.sceContract(3221)), diagnostic(LEND, xdr.ScError.sceContract(21))];
    expect(failureReason(TRAPPED, events, LEND)).toEqual({ reason: "ScriptPubKeyMismatch", errorCode: 21 });
  });

  it("falls back to another contract's error code, in Soroban's notation", () => {
    expect(failureReason(TRAPPED, [diagnostic(OTHER, xdr.ScError.sceContract(3221))], LEND)).toEqual({
      reason: "Error(Contract, #3221)",
      errorCode: 3221,
    });
  });

  it("an unknown code from writz-lend is reported by number, not given a name", () => {
    expect(failureReason(TRAPPED, [diagnostic(LEND, xdr.ScError.sceContract(999))], LEND)).toEqual({
      reason: "Error(Contract, #999)",
      errorCode: 999,
    });
  });

  it("then to a host error such as an exceeded budget", () => {
    const events = [diagnostic(null, xdr.ScError.sceBudget(xdr.ScErrorCode.scecExceededLimit()))];
    expect(failureReason(TRAPPED, events, LEND)).toEqual({ reason: "Error(Budget, ExceededLimit)", errorCode: null });
  });

  it("then to the operation result code", () => {
    expect(failureReason(TRAPPED, [], LEND)).toEqual({ reason: "invokeHostFunctionTrapped", errorCode: null });
  });

  it("then to the transaction result code, through a fee bump", () => {
    const inner = new xdr.InnerTransactionResult({
      feeCharged: xdr.Int64.fromString("100"),
      result: xdr.InnerTransactionResultResult.txBadAuth(),
      ext: new xdr.InnerTransactionResultExt(0),
    });
    const bumped = txResult(
      xdr.TransactionResultResult.txFeeBumpInnerFailed(new xdr.InnerTransactionResultPair({ transactionHash: Buffer.alloc(32), result: inner })),
    );
    expect(failureReason(bumped, [], LEND)).toEqual({ reason: "txBadAuth", errorCode: null });
  });
});

describe("checkDepositSubmission", () => {
  const found = (status: "SUCCESS" | "FAILED", envelope = depositEnvelope()): TransactionLookup => ({
    status,
    ledger: 5_383_080,
    createdAt: 1_792_938_987,
    envelopeXdr: envelope,
    resultXdr: TRAPPED,
    diagnosticEventsXdr: [diagnostic(LEND, xdr.ScError.sceContract(25))],
  });

  it("not_found when the RPC does not hold the hash", async () => {
    expect(await checkDepositSubmission(server({ status: "NOT_FOUND" }), LEND, TXID_INTERNAL, HASH)).toEqual({ status: "not_found" });
  });

  it("success with the ledger and its close time", async () => {
    expect(await checkDepositSubmission(server(found("SUCCESS")), LEND, TXID_INTERNAL.toUpperCase(), HASH)).toEqual({
      status: "success",
      ledger: 5_383_080,
      closedAt: "2026-10-25T14:36:27Z",
    });
  });

  it("failed with the decoded reason", async () => {
    expect(await checkDepositSubmission(server(found("FAILED")), LEND, TXID_INTERNAL, HASH)).toEqual({
      status: "failed",
      ledger: 5_383_080,
      closedAt: "2026-10-25T14:36:27Z",
      reason: "InvalidKeyProof",
      errorCode: 25,
    });
  });

  it("mismatch for a deposit of another Bitcoin transaction, successful or failed", async () => {
    const other = depositEnvelope(Buffer.from("ff".repeat(80), "hex"));
    for (const status of ["SUCCESS", "FAILED"] as const) {
      expect(await checkDepositSubmission(server(found(status, other)), LEND, TXID_INTERNAL, HASH)).toEqual({ status: "mismatch" });
    }
  });

  it("mismatch for a deposit into another contract, or any other call", async () => {
    expect(await checkDepositSubmission(server(found("SUCCESS", depositEnvelope(RAW_TX, OTHER))), LEND, TXID_INTERNAL, HASH)).toEqual({
      status: "mismatch",
    });
    const borrow = invoke(LEND, "borrow", depositArgs(RAW_TX)).toEnvelope();
    expect(await checkDepositSubmission(server(found("SUCCESS", borrow)), LEND, TXID_INTERNAL, HASH)).toEqual({ status: "mismatch" });
  });

  it("an unknown RPC status is an error, never a stage", async () => {
    const odd = { getTransaction: async () => ({ status: "PENDING" }) };
    await expect(checkDepositSubmission(odd, LEND, TXID_INTERNAL, HASH)).rejects.toThrow("unknown transaction status");
  });
});
