import type { contract } from "@stellar/stellar-sdk";
import { config } from "@/config";
import { getPosition, removePosition, savePosition, type Position } from "@/lib/position";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";
import type { Emit } from "@/lib/flow/engine";
import {
  activity,
  reconcilePendingTxs,
  retryLeafUpdates,
  type LeafOutcome,
  type LeafUpdate,
  type PendingTx,
} from "@/lib/flow/pendingTx";
import { getTxStatus, signAndSubmit, TxTimedOutError } from "@/lib/flow/stellarTx";

export async function postLeafUpdate(u: Pick<LeafUpdate, "leafIndex" | "newCommitment" | "encNote">): Promise<LeafOutcome> {
  const relayerUrl = config.services.relayerUrl;
  if (!relayerUrl) return "unreachable";
  const res = await fetch(`${relayerUrl}/update-leaf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      leafIndex: u.leafIndex,
      newCommitment: u.newCommitment,
      encNote: u.encNote,
    }),
  }).catch(() => null);
  if (!res) return "unreachable";
  if (res.ok) return "accepted";
  return res.status >= 400 && res.status < 500 ? "rejected" : "unreachable";
}

function replacePosition(removeId: string, save: Position) {
  removePosition(save.owner, removeId);
  savePosition(save);
}

/** Retries every `/update-leaf` this device still owes the relayer. */
export function syncLeafUpdates(owner: string): Promise<void> {
  return retryLeafUpdates(owner, { store: activity, post: postLeafUpdate });
}

/** Applies confirmed transactions left over from a closed tab and drops the ones that never landed. */
export function reconcileActivity(owner: string): Promise<void> {
  return reconcilePendingTxs(owner, {
    store: activity,
    getStatus: getTxStatus,
    hasPosition: (id) => getPosition(owner, id) !== undefined,
    replacePosition,
  });
}

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
 * Submits a borrow or repay: records the pending transaction (with the
 * position change and leaf update it implies) before submit, applies it once
 * confirmed, then syncs the relayer leaf store. A failed sync stays queued and
 * is retried on the next load instead of failing a transaction that landed.
 */
export async function submitPositionTx<T>(params: {
  kind: "borrow" | "repay";
  tx: contract.AssembledTransaction<T>;
  position: Position;
  updated: Position;
  leafUpdate?: PendingTx["leafUpdate"];
  signTransaction: SignTransaction;
  emit?: Emit;
}): Promise<{ hash: string; syncPending: boolean }> {
  const { kind, tx, position, updated, leafUpdate, signTransaction, emit } = params;
  const owner = position.owner;
  let hash: string;
  try {
    ({ hash } = await signAndSubmit(tx, {
      signTransaction,
      emit,
      onSigned: (h) =>
        activity.addTx(owner, {
          hash: h,
          kind,
          createdAt: Date.now(),
          positionUpdate: { removeId: position.id, save: updated },
          leafUpdate,
        }),
      onDropped: (h) => activity.removeTx(owner, h),
    }));
  } catch (e) {
    if (e instanceof TxTimedOutError) emit?.({ type: "timed_out", hash: e.hash });
    throw e;
  }

  replacePosition(position.id, updated);
  activity.removeTx(owner, hash);

  let syncPending = false;
  if (leafUpdate) {
    emit?.({ type: "post_processing", step: "update_leaf" });
    activity.enqueueLeaf(owner, leafUpdate);
    for (let attempt = 0; attempt < 3; attempt++) {
      // The relayer checks the update against its own RPC view, which can lag a ledger behind ours.
      if (attempt > 0) await new Promise((r) => setTimeout(r, 3_000));
      await syncLeafUpdates(owner);
      syncPending = activity.leafUpdates(owner).some((u) => u.leafIndex === leafUpdate.leafIndex);
      if (!syncPending) break;
    }
  }
  emit?.({ type: "settled", hash, syncPending });
  return { hash, syncPending };
}
