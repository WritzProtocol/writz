import { createJsonStore } from "@/lib/flow/storage";
import type { ActivityItem } from "@/lib/loan/model";
import type { Position } from "@/lib/position/types";
import type { TimelineEvent } from "./timeline";

/**
 * Second legs (swap or CCTP) this device sent, per Stellar owner and loan, so
 * the timeline keeps them after a reload. Only settled transactions go here.
 */
export const receiveLog = createJsonStore<Record<string, TimelineEvent[]>>("writz:receive:");

export function logReceived(owner: string, positionId: string, event: TimelineEvent): void {
  const all = receiveLog.read(owner) ?? {};
  const list = all[positionId] ?? [];
  if (list.some((e) => e.hash === event.hash)) return;
  receiveLog.write(owner, { ...all, [positionId]: [...list, event] });
}

const KIND_OF: [RegExp, TimelineEvent["kind"]][] = [
  [/^Deposit/, "verified"],
  [/^Borrow/, "borrowed"],
  [/^Repa/, "repaid"],
  [/^Release/, "released"],
];

/**
 * The timeline from what this device knows: the loan record, its settled
 * transactions and the second legs it sent. Pending transactions are left
 * out: a step shows only once its transaction settled.
 */
export function clientTimeline(position: Position, activity: readonly ActivityItem[], received: readonly TimelineEvent[]): TimelineEvent[] {
  const out: TimelineEvent[] = [{ kind: "btc_lock", chain: "bitcoin", hash: position.txid, at: null }];
  if (position.stellarTxHash) out.push({ kind: "verified", chain: "stellar", hash: position.stellarTxHash, at: position.createdAt });
  for (const a of activity) {
    if (a.state !== "done") continue;
    const kind = KIND_OF.find(([re]) => re.test(a.label))?.[1];
    if (!kind) continue;
    out.push({ kind, chain: a.chain, hash: a.hash, at: a.at });
  }
  if (position.releaseTxid) out.push({ kind: "released", chain: "bitcoin", hash: position.releaseTxid, at: null });
  return [...out, ...received];
}
