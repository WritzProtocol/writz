/**
 * The full cycle of a loan, one event per transaction: the Bitcoin lock, its
 * verification on Stellar, borrows, how the loan was received, repays and the
 * release. Read from the relayer once it serves it (`TimelineApi`); until
 * then built on the client from what this device knows.
 */

export type TimelineKind = "btc_lock" | "verified" | "borrowed" | "received" | "repaid" | "released";
export type TimelineChain = "bitcoin" | "stellar" | "base-sepolia";

export interface TimelineEvent {
  kind: TimelineKind;
  chain: TimelineChain;
  hash: string;
  /** Unix ms, when known. */
  at: number | null;
  /** Overrides the step's label: "Received as XLM", "Sent to Base Sepolia". */
  label?: string;
}

export interface TimelineApi {
  get(btcTxid: string): Promise<TimelineEvent[]>;
}

export const TIMELINE_LABEL: Record<TimelineKind, string> = {
  btc_lock: "Bitcoin locked",
  verified: "Verified on Stellar",
  borrowed: "Borrowed",
  received: "Received",
  repaid: "Repaid",
  released: "BTC released",
};

const RANK: Record<TimelineKind, number> = { btc_lock: 0, verified: 1, borrowed: 2, received: 3, repaid: 4, released: 5 };
const PHASE: Record<TimelineKind, number> = { btc_lock: 0, verified: 1, borrowed: 2, received: 2, repaid: 2, released: 3 };

/**
 * Chain order. The lock and its verification come first and the release
 * last; borrows, receipts and repays can repeat and interleave, so between
 * them time decides, an unknown time after known ones, then cycle order.
 * Duplicate hashes of the same kind keep the first.
 */
export function orderTimeline(events: readonly TimelineEvent[]): TimelineEvent[] {
  const seen = new Set<string>();
  const unique = events.filter((e) => {
    const key = `${e.kind}:${e.hash}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const p = PHASE[a.e.kind] - PHASE[b.e.kind];
      if (p !== 0) return p;
      const ta = a.e.at ?? Number.POSITIVE_INFINITY;
      const tb = b.e.at ?? Number.POSITIVE_INFINITY;
      if (ta !== tb) return ta < tb ? -1 : 1;
      const r = RANK[a.e.kind] - RANK[b.e.kind];
      return r !== 0 ? r : a.i - b.i;
    })
    .map(({ e }) => e);
}

export type TimelineRow = {
  kind: TimelineKind;
  event: TimelineEvent | null;
  /** No transaction here, but a later step has one, so this one is not "not yet". */
  passed: boolean;
};

/**
 * Every step of the cycle in order: the known events, and a row without a
 * transaction for each step that has none. A borrow taken as USDC on Stellar
 * is received with the borrow itself, so once something was borrowed
 * "received" is never a row of its own.
 */
export function timelineRows(events: readonly TimelineEvent[]): TimelineRow[] {
  const ordered = orderTimeline(events);
  const has = (k: TimelineKind) => ordered.some((e) => e.kind === k);
  const rows: TimelineRow[] = ordered.map((event) => ({ kind: event.kind, event, passed: false }));
  for (const kind of Object.keys(RANK) as TimelineKind[]) {
    if (has(kind)) continue;
    if (kind === "received" && has("borrowed")) continue;
    // Before the first row of a later step, so the cycle keeps its order.
    const at = rows.findIndex((r) => RANK[r.kind] > RANK[kind]);
    const row = { kind, event: null, passed: at !== -1 };
    if (at === -1) rows.push(row);
    else rows.splice(at, 0, row);
  }
  return rows;
}
