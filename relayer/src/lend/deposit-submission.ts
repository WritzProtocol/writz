/**
 * Reads a `writz-lend` `deposit` submission from Stellar for
 * GET /deposit-status?stellarTx=.
 *
 * The user's wallet signs and submits the `deposit` call, so the relayer never
 * sees it go out; the app passes back the hash the network returned. That hash
 * is only a claim until the transaction is read: before it is trusted, its
 * envelope must invoke `deposit` on this deployment of `writz-lend` for this
 * Bitcoin txid. The contract derives the txid as the double SHA-256 of the
 * `raw_tx` argument (witness stripped, see bitcoin-spv's `verify_transaction`),
 * so the same hash of that argument is what binds the two.
 *
 * Deliberately does not statically import `@stellar/stellar-sdk` at module
 * scope (see `../repay-watcher/poller.ts` for why).
 */
import { createHash } from "node:crypto";
import type { xdr } from "@stellar/stellar-sdk";
import { WRITZ_LEND_ERRORS } from "./writz-lend-errors.js";

/** Position of `raw_tx` in `writz-lend` `deposit(depositor, block_hash, merkle_proof, tx_index, raw_tx, ...)`. */
const RAW_TX_ARG = 4;

/** The subset of a Stellar RPC `getTransaction` answer read here, so tests can pass plain mocks. */
export type TransactionLookup =
  | { status: "NOT_FOUND" }
  | {
      status: "SUCCESS" | "FAILED";
      ledger: number;
      /** Close time of `ledger`, in Unix seconds. */
      createdAt: number | string;
      envelopeXdr: xdr.TransactionEnvelope;
      resultXdr: xdr.TransactionResult;
      diagnosticEventsXdr?: xdr.DiagnosticEvent[];
    };

/** The subset of `rpc.Server` the submission read needs. */
export interface TransactionLookupServer {
  getTransaction(hash: string): Promise<TransactionLookup | { status: string }>;
}

export type SubmissionCheck =
  /** The RPC does not hold the hash: still in flight, dropped, or never sent. Nothing can be checked. */
  | { status: "not_found" }
  /** The transaction exists but is not a `writz-lend` `deposit` for this txid. */
  | { status: "mismatch" }
  | { status: "success"; ledger: number; closedAt: string }
  | { status: "failed"; ledger: number; closedAt: string; reason: string; errorCode: number | null };

function sdk(): typeof import("@stellar/stellar-sdk") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
}

const sha256d = (data: Buffer): Buffer =>
  createHash("sha256").update(createHash("sha256").update(data).digest()).digest();

/** The operations of a plain or fee-bumped envelope; a fee bump wraps the transaction the user signed. */
function operations(envelope: xdr.TransactionEnvelope): xdr.Operation[] {
  switch (envelope.switch().name) {
    case "envelopeTypeTx":
      return envelope.v1().tx().operations();
    case "envelopeTypeTxFeeBump":
      return envelope.feeBump().tx().innerTx().v1().tx().operations();
    default:
      // A v0 envelope predates Soroban and cannot invoke a contract.
      return [];
  }
}

/**
 * The Bitcoin txid (internal byte order) a transaction deposits into
 * `contractId`, or undefined when it does not invoke that contract's `deposit`.
 */
export function depositTxidOfEnvelope(envelope: xdr.TransactionEnvelope, contractId: string): string | undefined {
  const { Address } = sdk();
  for (const op of operations(envelope)) {
    if (op.body().switch().name !== "invokeHostFunction") continue;
    const fn = op.body().invokeHostFunctionOp().hostFunction();
    if (fn.switch().name !== "hostFunctionTypeInvokeContract") continue;
    const call = fn.invokeContract();
    if (Address.fromScAddress(call.contractAddress()).toString() !== contractId) continue;
    if (call.functionName().toString() !== "deposit") continue;
    const rawTx = call.args()[RAW_TX_ARG];
    if (!rawTx || rawTx.switch().name !== "scvBytes") continue;
    return sha256d(Buffer.from(rawTx.bytes())).toString("hex");
  }
  return undefined;
}

/** `sceBudget` / `scecExceededLimit` to `Budget` / `ExceededLimit`, as Soroban prints them. */
const hostName = (name: string, prefix: string): string =>
  name.startsWith(prefix) ? name.slice(prefix.length) : name;

/**
 * Why a transaction failed, as specific as the chain allows: the
 * `WritzLendError` name when writz-lend returned the error, otherwise the
 * first contract or host error in the diagnostic events, otherwise the
 * operation or transaction result code.
 */
export function failureReason(
  result: xdr.TransactionResult,
  diagnosticEvents: xdr.DiagnosticEvent[],
  contractId: string,
): { reason: string; errorCode: number | null } {
  const { StrKey } = sdk();
  let anyContract: { reason: string; errorCode: number } | undefined;
  let anyHost: string | undefined;
  for (const diagnostic of diagnosticEvents) {
    const event = diagnostic.event();
    const emitter = event.contractId();
    const fromLend = emitter ? StrKey.encodeContract(Buffer.from(emitter as unknown as Uint8Array)) === contractId : false;
    for (const topic of event.body().v0().topics()) {
      if (topic.switch().name !== "scvError") continue;
      const error = topic.error();
      const type = error.switch().name;
      if (type === "sceContract") {
        const code = error.contractCode();
        const name = WRITZ_LEND_ERRORS[code];
        if (fromLend && name) return { reason: name, errorCode: code };
        anyContract ??= { reason: `Error(Contract, #${code})`, errorCode: code };
      } else {
        anyHost ??= `Error(${hostName(type, "sce")}, ${hostName(error.code().name, "scec")})`;
      }
    }
  }
  if (anyContract) return anyContract;
  if (anyHost) return { reason: anyHost, errorCode: null };
  return { reason: resultCode(result), errorCode: null };
}

/** The operation result code when the transaction got that far, else the transaction result code. */
function resultCode(result: xdr.TransactionResult): string {
  let inner: xdr.TransactionResult | xdr.InnerTransactionResult = result;
  const outer = result.result().switch().name;
  if (outer === "txFeeBumpInnerFailed" || outer === "txFeeBumpInnerSuccess") {
    inner = result.result().innerResultPair().result();
  }
  const code = inner.result().switch().name;
  if (code !== "txFailed") return code;
  const op = inner.result().results()[0];
  if (op?.switch().name !== "opInner") return op?.switch().name ?? code;
  const tr = op.tr();
  return tr.switch().name === "invokeHostFunction" ? tr.invokeHostFunctionResult().switch().name : tr.switch().name;
}

/** Unix seconds to the ISO form the RPC uses for `ledgerClosedAt` (no fraction). */
function isoSeconds(unixSeconds: number | string): string {
  return new Date(Number(unixSeconds) * 1000).toISOString().replace(".000Z", "Z");
}

/** Reads `hash` from Stellar RPC and checks it against the deposit it is claimed for. */
export async function checkDepositSubmission(
  server: TransactionLookupServer,
  contractId: string,
  txidInternal: string,
  hash: string,
): Promise<SubmissionCheck> {
  const tx = (await server.getTransaction(hash)) as TransactionLookup | { status: string };
  if (tx.status === "NOT_FOUND") return { status: "not_found" };
  if (tx.status !== "SUCCESS" && tx.status !== "FAILED") {
    throw new Error(`Stellar RPC returned an unknown transaction status ${tx.status}`);
  }
  const found = tx as Extract<TransactionLookup, { status: "SUCCESS" | "FAILED" }>;
  if (depositTxidOfEnvelope(found.envelopeXdr, contractId) !== txidInternal.toLowerCase()) {
    return { status: "mismatch" };
  }
  const closedAt = isoSeconds(found.createdAt);
  if (found.status === "SUCCESS") return { status: "success", ledger: found.ledger, closedAt };
  return {
    status: "failed",
    ledger: found.ledger,
    closedAt,
    ...failureReason(found.resultXdr, found.diagnosticEventsXdr ?? [], contractId),
  };
}
