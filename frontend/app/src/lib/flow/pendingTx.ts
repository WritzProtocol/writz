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

export interface PendingTx {
  hash: string;
  kind: PendingTxKind;
  createdAt: number;
  /** Local position change to apply once the transaction is confirmed. */
  positionUpdate?: { removeId: string; save: Position };
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

export function createActivityStore(txStore: JsonStore<PendingTx[]> = createJsonStore("writz.activity.")) {
  const txs = (owner: string) => txStore.read(owner) ?? [];

  return {
    pendingTxs: txs,
    subscribe: (cb: () => void): (() => void) => txStore.subscribe(cb),
    txSnapshot: (owner: string) => txStore.snapshot(owner),
    addTx(owner: string, tx: PendingTx) {
      txStore.write(owner, [...txs(owner).filter((t) => t.hash !== tx.hash), tx]);
    },
    removeTx(owner: string, hash: string) {
      txStore.write(owner, txs(owner).filter((t) => t.hash !== hash));
    },
  };
}

export type ActivityStore = ReturnType<typeof createActivityStore>;

export const activity = createActivityStore();

/** Applies a confirmed transaction's local effects. Idempotent: a position already moved on is left alone. */
export function applyPendingTx(
  tx: PendingTx,
  deps: {
    store: ActivityStore;
    hasPosition: (id: string) => boolean;
    replacePosition: (removeId: string, save: Position) => void;
  },
): void {
  const u = tx.positionUpdate;
  if (u && deps.hasPosition(u.removeId)) deps.replacePosition(u.removeId, u.save);
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
    if (decision === "apply") applyPendingTx(tx, deps);
    deps.store.removeTx(owner, tx.hash);
  }
}
