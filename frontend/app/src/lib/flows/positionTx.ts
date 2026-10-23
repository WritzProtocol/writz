import type { contract } from "@stellar/stellar-sdk";
import { getPosition, removePosition, savePosition, type Position } from "@/lib/position";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";
import type { Emit } from "@/lib/flow/engine";
import { activity, reconcilePendingTxs, type PendingTx } from "@/lib/flow/pendingTx";
import { getTxStatus, signAndSubmit, TxTimedOutError } from "@/lib/flow/stellarTx";

function replacePosition(removeId: string, save: Position) {
  if (removeId !== save.id) removePosition(save.owner, removeId);
  savePosition(save);
}

/** Callers that overlap share one run, so two of them never post or write the same list. */
function singleFlight(run: (owner: string) => Promise<void>): (owner: string) => Promise<void> {
  const running = new Map<string, Promise<void>>();
  return (owner) => {
    const current = running.get(owner);
    if (current) return current;
    const next = run(owner).finally(() => running.delete(owner));
    running.set(owner, next);
    return next;
  };
}

/** Applies confirmed transactions left over from a closed tab and drops the ones that never landed. */
export const reconcileActivity = singleFlight((owner) =>
  reconcilePendingTxs(owner, {
    store: activity,
    getStatus: getTxStatus,
    hasPosition: (id) => getPosition(owner, id) !== undefined,
    replacePosition,
  }),
);

/** Submits a contract call with its hash recorded before submit and cleared once settled. */
export async function submitTrackedTx<T>(params: {
  kind: PendingTx["kind"];
  owner: string;
  tx: contract.AssembledTransaction<T>;
  signTransaction: SignTransaction;
  emit?: Emit;
}): Promise<{ hash: string }> {
  const { kind, owner, tx, signTransaction, emit } = params;
  try {
    const { hash } = await signAndSubmit(tx, {
      signTransaction,
      emit,
      onSigned: (h) => activity.addTx(owner, { hash: h, kind, createdAt: Date.now() }),
      onDropped: (h) => activity.removeTx(owner, h),
    });
    activity.removeTx(owner, hash);
    emit?.({ type: "settled", hash });
    return { hash };
  } catch (e) {
    if (e instanceof TxTimedOutError) emit?.({ type: "timed_out", hash: e.hash });
    throw e;
  }
}

/**
 * Submits a borrow or repay: records the pending transaction (with the local
 * position change it implies) before submit and applies it once confirmed,
 * so a reload mid-confirmation still lands the change.
 */
export async function submitPositionTx<T>(params: {
  kind: "borrow" | "repay";
  tx: contract.AssembledTransaction<T>;
  position: Position;
  updated: Position;
  signTransaction: SignTransaction;
  emit?: Emit;
  /** Leave the flow open for a follow-up transaction instead of settling it. */
  keepOpen?: boolean;
}): Promise<{ hash: string; ledger?: number }> {
  const { kind, tx, position, updated, signTransaction, emit } = params;
  const owner = position.owner;
  let hash: string;
  let ledger: number | undefined;
  try {
    let sent: Awaited<ReturnType<typeof signAndSubmit<T>>>["sent"];
    ({ hash, sent } = await signAndSubmit(tx, {
      signTransaction,
      emit,
      onSigned: (h) =>
        activity.addTx(owner, {
          hash: h,
          kind,
          createdAt: Date.now(),
          positionUpdate: { removeId: position.id, save: updated },
        }),
      onDropped: (h) => activity.removeTx(owner, h),
    }));
    const landed = sent.getTransactionResponse;
    ledger = landed && "ledger" in landed ? landed.ledger : undefined;
  } catch (e) {
    if (e instanceof TxTimedOutError) emit?.({ type: "timed_out", hash: e.hash });
    throw e;
  }

  replacePosition(position.id, updated);
  activity.removeTx(owner, hash);
  if (!params.keepOpen) emit?.({ type: "settled", hash });
  return { hash, ledger };
}
