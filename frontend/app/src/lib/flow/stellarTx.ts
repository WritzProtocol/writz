import { contract, rpc } from "@stellar/stellar-sdk";
import { config } from "@/config";
import { isUserRejection, SIGNATURE_REJECTED } from "@/lib/flows/earn";
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
 * Signs, records the hash through `onSigned` before anything reaches the
 * network, then submits and waits. A rejection becomes `SignatureRejected`,
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
    await tx.sign({ signTransaction });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (isUserRejection(message)) {
      emit?.({ type: "signature_cancelled" });
      throw new Error(SIGNATURE_REJECTED);
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
