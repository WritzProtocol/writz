import type { Position } from "@/lib/position/types";
import { STELLAR_TX_TTL_MS } from "./pendingDeposit";
import { createJsonStore, type JsonStore } from "./storage";

/**
 * Stellar transactions written before submit and reconciled on load with
 * `getTransaction`, so a reload mid-confirmation never leaves local state
 * behind the chain.
 */
export type PendingTxKind =
  | "deposit"
  | "borrow"
  | "repay"
  | "supply"
  | "withdraw"
  | "earn_deposit"
  | "earn_withdraw";

export interface LeafUpdate {
  leafIndex: number;
  newCommitment: string;
  encNote: string;
  attempts: number;
  createdAt: number;
}

export interface PendingTx {
  hash: string;
  kind: PendingTxKind;
  createdAt: number;
  /** Local position change to apply once the transaction is confirmed. */
  positionUpdate?: { removeId: string; save: Position };
  /** Relayer `/update-leaf` payload to send once the transaction is confirmed. */
  leafUpdate?: Omit<LeafUpdate, "attempts" | "createdAt">;
}

export type TxStatus = "SUCCESS" | "FAILED" | "NOT_FOUND";

export function decideReconcile(
  tx: PendingTx,
  status: TxStatus,
  now: number,
): "apply" | "drop" | "keep" {
  if (status === "SUCCESS") return "apply";
  if (status === "FAILED") return "drop";
  return now - tx.createdAt > STELLAR_TX_TTL_MS ? "drop" : "keep";
}

/** Rejections from a relayer that validates against chain stop being worth retrying after a few loads. */
export const MAX_LEAF_REJECTIONS = 5;

export type LeafOutcome = "accepted" | "rejected" | "unreachable";

export function decideLeafRetry(update: LeafUpdate, outcome: LeafOutcome): "drop" | "keep" {
  if (outcome === "accepted") return "drop";
  if (outcome === "rejected" && update.attempts + 1 >= MAX_LEAF_REJECTIONS) return "drop";
  return "keep";
}

export function createActivityStore(
  txStore: JsonStore<PendingTx[]> = createJsonStore("writz.activity."),
  leafStore: JsonStore<LeafUpdate[]> = createJsonStore("writz.leafSync."),
) {
  const txs = (owner: string) => txStore.read(owner) ?? [];
  const leaves = (owner: string) => leafStore.read(owner) ?? [];

  return {
    pendingTxs: txs,
    leafUpdates: leaves,
    subscribe(cb: () => void): () => void {
      const a = txStore.subscribe(cb);
      const b = leafStore.subscribe(cb);
      return () => {
        a();
        b();
      };
    },
    leafSnapshot: (owner: string) => leafStore.snapshot(owner),
    addTx(owner: string, tx: PendingTx) {
      txStore.write(owner, [...txs(owner).filter((t) => t.hash !== tx.hash), tx]);
    },
    removeTx(owner: string, hash: string) {
      txStore.write(owner, txs(owner).filter((t) => t.hash !== hash));
    },
    enqueueLeaf(owner: string, update: Omit<LeafUpdate, "attempts" | "createdAt">, now = Date.now()) {
      const rest = leaves(owner).filter((u) => u.leafIndex !== update.leafIndex);
      leafStore.write(owner, [...rest, { ...update, attempts: 0, createdAt: now }]);
    },
    setLeaves(owner: string, list: LeafUpdate[]) {
      leafStore.write(owner, list);
    },
  };
}

export type ActivityStore = ReturnType<typeof createActivityStore>;

export const activity = createActivityStore();

/** Applies a confirmed transaction's local effects. Idempotent: a position already moved on is left alone. */
export function applyPendingTx(
  owner: string,
  tx: PendingTx,
  deps: {
    store: ActivityStore;
    hasPosition: (id: string) => boolean;
    replacePosition: (removeId: string, save: Position) => void;
  },
): void {
  const u = tx.positionUpdate;
  if (u && deps.hasPosition(u.removeId)) deps.replacePosition(u.removeId, u.save);
  if (tx.leafUpdate) deps.store.enqueueLeaf(owner, tx.leafUpdate);
}

export async function reconcilePendingTxs(
  owner: string,
  deps: {
    store: ActivityStore;
    getStatus: (hash: string) => Promise<TxStatus>;
    hasPosition: (id: string) => boolean;
    replacePosition: (removeId: string, save: Position) => void;
    now?: () => number;
  },
): Promise<void> {
  for (const tx of deps.store.pendingTxs(owner)) {
    let status: TxStatus;
    try {
      status = await deps.getStatus(tx.hash);
    } catch {
      continue;
    }
    const decision = decideReconcile(tx, status, (deps.now ?? Date.now)());
    if (decision === "keep") continue;
    if (decision === "apply") applyPendingTx(owner, tx, deps);
    deps.store.removeTx(owner, tx.hash);
  }
}

export async function retryLeafUpdates(
  owner: string,
  deps: { store: ActivityStore; post: (u: LeafUpdate) => Promise<LeafOutcome> },
): Promise<void> {
  const original = deps.store.leafUpdates(owner);
  const remaining: LeafUpdate[] = [];
  for (const update of original) {
    const outcome = await deps.post(update).catch((): LeafOutcome => "unreachable");
    if (decideLeafRetry(update, outcome) === "keep") {
      remaining.push(outcome === "rejected" ? { ...update, attempts: update.attempts + 1 } : update);
    }
  }
  const same = (a: LeafUpdate, b: LeafUpdate) =>
    a.leafIndex === b.leafIndex && a.newCommitment === b.newCommitment;
  const addedMeanwhile = deps.store
    .leafUpdates(owner)
    .filter((u) => !original.some((o) => same(o, u)));
  deps.store.setLeaves(owner, [...remaining, ...addedMeanwhile]);
}
