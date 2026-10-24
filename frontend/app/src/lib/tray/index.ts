import type { PendingDeposit } from "@/lib/flow/pendingDeposit";
import type { PendingTx } from "@/lib/flow/pendingTx";
import { createJsonStore, type JsonStore } from "@/lib/flow/storage";
import type { RecentTx } from "@/lib/loan/model";
import type { PositionStatus } from "@/lib/status/types";

/** Finished items stay in the tray for a day; pending ones never expire. */
export const FINISHED_TTL_MS = 24 * 60 * 60 * 1000;

export function createRecentStore(store: JsonStore<RecentTx[]> = createJsonStore("writz.recent.")) {
  const list = (owner: string) => store.read(owner) ?? [];
  return {
    subscribe: store.subscribe,
    snapshot: (owner: string) => store.snapshot(owner),
    add(owner: string, tx: RecentTx, now = Date.now()) {
      const kept = list(owner).filter((t) => t.hash !== tx.hash && now - t.at < FINISHED_TTL_MS);
      store.write(owner, [...kept, tx]);
    },
    clear: (owner: string) => store.write(owner, null),
  };
}

export const recentActivity = createRecentStore();

export type TrayAction = "resume" | "check_again" | null;

export interface TrayItem {
  key: string;
  label: string;
  loan: string | null;
  state: "in_progress" | "needs_attention" | "done";
  stateLabel: string;
  chain: "stellar" | "bitcoin";
  hash: string | null;
  at: number | null;
  action: TrayAction;
}

const TX_LABEL: Record<PendingTx["kind"], string> = {
  deposit: "Register deposit",
  borrow: "Borrow",
  repay: "Repay",
  supply: "Supply to the pool",
  withdraw: "Withdraw from the pool",
  earn_deposit: "Deposit to Earn",
  earn_withdraw: "Withdraw from Earn",
};

const loanName = (index: number | undefined) => (index === undefined ? null : `Loan ${index + 1}`);

function depositItem(pd: PendingDeposit, status: PositionStatus | null): TrayItem {
  const base = {
    key: `deposit:${pd.btcTxid}`,
    label: "Deposit BTC",
    loan: loanName(pd.positionIndex),
    chain: "bitcoin" as const,
    hash: pd.btcTxid,
    at: pd.createdAt,
  };
  switch (status?.kind) {
    case "btc_unseen":
      return { ...base, state: "needs_attention", stateLabel: "Not seen on Bitcoin yet", action: "check_again" };
    case "ready_to_register":
      return { ...base, state: "needs_attention", stateLabel: "One signature left", action: "resume" };
    case "confirming":
      return { ...base, state: "in_progress", stateLabel: `${status.n} of ${status.m} confirmations`, action: "resume" };
    default:
      return { ...base, state: "in_progress", stateLabel: "In progress", action: "resume" };
  }
}

export function trayItems(args: {
  pendingDeposit: PendingDeposit | null;
  depositStatus: PositionStatus | null;
  pendingTxs: readonly PendingTx[];
  recent: readonly RecentTx[];
  now: number;
}): TrayItem[] {
  const items: TrayItem[] = [];
  const seen = new Set<string>();
  if (args.pendingDeposit) {
    items.push(depositItem(args.pendingDeposit, args.depositStatus));
    seen.add(args.pendingDeposit.btcTxid);
    if (args.pendingDeposit.stellarTxHash) seen.add(args.pendingDeposit.stellarTxHash);
  }
  for (const t of args.pendingTxs) {
    if (seen.has(t.hash)) continue;
    seen.add(t.hash);
    items.push({
      key: t.hash,
      label: TX_LABEL[t.kind],
      loan: loanName(t.positionUpdate?.save.index),
      state: "in_progress",
      stateLabel: "Confirming",
      chain: "stellar",
      hash: t.hash,
      at: t.createdAt,
      action: null,
    });
  }
  const finished = args.recent
    .filter((r) => !seen.has(r.hash) && args.now - r.at < FINISHED_TTL_MS)
    .sort((a, b) => b.at - a.at);
  for (const r of finished) {
    items.push({ key: r.hash, label: r.label, loan: null, state: "done", stateLabel: "Done", chain: r.chain, hash: r.hash, at: r.at, action: null });
  }
  const order = { needs_attention: 0, in_progress: 1, done: 2 };
  return items.sort((a, b) => order[a.state] - order[b.state]);
}

export const unsettledCount = (items: readonly TrayItem[]) => items.filter((i) => i.state !== "done").length;
