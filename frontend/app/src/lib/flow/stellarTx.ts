import { contract, rpc, TransactionBuilder, xdr, type Transaction } from "@stellar/stellar-sdk";
import { config } from "@/config";
import { asRejection } from "@/lib/wallet/rejection";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";
import type { Emit } from "./engine";
import type { TxStatus } from "./pendingTx";

export class TxTimedOutError extends Error {
  constructor(readonly hash: string) {
    super("ConfirmationTimedOut");
    this.name = "TxTimedOutError";
  }
}

/**
 * Leaves only the inclusion fee on `tx.built`, so `sign()` adds the resource
 * fee once. In @stellar/stellar-sdk 16, `AssembledTransaction.sign()` rebuilds
 * the transaction with `fee: built.fee`, which already includes the simulated
 * resource fee, and the builder then adds the resource fee again. The bid
 * becomes inclusion + 2 x resource fee: the account needs twice the XLM, and
 * past ~214.7 XLM of resource fee the total no longer fits the uint32 fee
 * field, so `sign()` throws before the wallet is asked. A writz-lend deposit
 * declared ~352 XLM on testnet on 2026-10-25. Upstream fixed this in 17.3.0
 * (stellar/js-stellar-sdk#1808); remove this when the app moves to it.
 *
 * `sign()` takes the resource fee from the simulation, not from `built`, so the
 * Soroban data is dropped here too, which also makes a second call a no-op.
 */
export function bidInclusionFeeOnly<T>(tx: contract.AssembledTransaction<T>): void {
  const built = tx.built;
  if (!built) return;
  const envelope = xdr.TransactionEnvelope.fromXDR(built.toXDR(), "base64");
  if (envelope.switch() !== xdr.EnvelopeType.envelopeTypeTx()) return;
  const inner = envelope.v1().tx();
  if (inner.ext().switch() !== 1) return;
  const resourceFee = inner.ext().sorobanData().resourceFee().toBigInt();
  const inclusionFee = BigInt(inner.fee()) - resourceFee;
  if (inclusionFee <= 0n) return;
  inner.fee(Number(inclusionFee));
  inner.ext(new xdr.TransactionExt(0));
  tx.built = TransactionBuilder.fromXDR(envelope, built.networkPassphrase) as Transaction;
}

/**
 * Signs, records the hash through `onSigned` before anything reaches the
 * network, then submits and waits. A rejection becomes `SignatureRejectedError`,
 * a confirmation timeout becomes `TxTimedOutError` with the hash kept, and a
 * transaction that was refused or failed on chain calls `onDropped`.
 */
export async function signAndSubmit<T>(
  tx: contract.AssembledTransaction<T>,
  opts: {
    signTransaction: SignTransaction;
    emit?: Emit;
    onSigned?: (hash: string) => void;
    onDropped?: (hash: string) => void;
  },
): Promise<{ hash: string; sent: contract.SentTransaction<T> }> {
  const { signTransaction, emit, onSigned, onDropped } = opts;
  emit?.({ type: "awaiting_signature", wallet: "stellar" });
  try {
    bidInclusionFeeOnly(tx);
    await tx.sign({ signTransaction });
  } catch (e) {
    const rejected = asRejection(e, "stellar");
    if (rejected) {
      emit?.({ type: "signature_cancelled", walletName: rejected.walletName });
      throw rejected;
    }
    throw e;
  }
  const hash = tx.signed!.hash().toString("hex");
  onSigned?.(hash);
  emit?.({ type: "submitted", hash });
  try {
    const sent = await tx.send();
    if (sent.getTransactionResponse?.status === rpc.Api.GetTransactionStatus.FAILED) {
      onDropped?.(hash);
      throw new Error(`Transaction failed on-chain: ${hash}`);
    }
    return { hash, sent };
  } catch (e) {
    if (e instanceof contract.SentTransaction.Errors.TransactionStillPending) {
      throw new TxTimedOutError(hash);
    }
    if (e instanceof contract.SentTransaction.Errors.SendFailed) onDropped?.(hash);
    throw e;
  }
}

/** `getTransaction` status for a hash. */
export async function getTxStatus(hash: string): Promise<TxStatus> {
  const server = new rpc.Server(config.rpcUrl, { allowHttp: config.rpcUrl.startsWith("http://") });
  const res = await server.getTransaction(hash);
  if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) return "SUCCESS";
  if (res.status === rpc.Api.GetTransactionStatus.FAILED) return "FAILED";
  return "NOT_FOUND";
}
