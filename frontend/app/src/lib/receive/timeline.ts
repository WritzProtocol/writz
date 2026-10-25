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
  /** For `received`: "as XLM", "on Base Sepolia". */
  detail?: string;
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

export type TimelineRow = { kind: TimelineKind; event: TimelineEvent | null };

/**
 * The ordered events, then the steps of the cycle not reached yet, without a
 * transaction. A borrow taken as USDC on Stellar is received with the borrow
 * itself, so once something was borrowed "received" is never a pending step.
 */
export function timelineRows(events: readonly TimelineEvent[]): TimelineRow[] {
  const ordered = orderTimeline(events);
  const rows: TimelineRow[] = ordered.map((event) => ({ kind: event.kind, event }));
  const has = (k: TimelineKind) => ordered.some((e) => e.kind === k);
  const last = ordered.reduce((m, e) => Math.max(m, RANK[e.kind]), -1);
  for (const kind of Object.keys(RANK) as TimelineKind[]) {
    if (has(kind) || RANK[kind] < last) continue;
    if (kind === "received" && has("borrowed")) continue;
    rows.push({ kind, event: null });
  }
  return rows;
}
