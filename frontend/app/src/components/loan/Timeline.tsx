"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { BTC_NETWORK_LABEL, config } from "@/config";
import { shortAddress } from "@/lib/borrow/journey";
import { networkName } from "@/lib/wallet/precheck";
import { btcTxUrl, stellarTxUrl } from "@/lib/explorer";
import { destinationTxUrl } from "@/lib/receive/cctp";
import { clientTimeline, receiveLog } from "@/lib/receive/clientTimeline";
import { TIMELINE_LABEL, timelineRows, type TimelineEvent, type TimelineKind } from "@/lib/receive/timeline";
import { shortDate } from "@/lib/loan/model";
import type { Position } from "@/lib/position/types";
import { ExternalLink } from "@/components/ui";
import type { LoanModel } from "./model";

const NONE: Record<string, TimelineEvent[]> = {};

const urlOf = (e: TimelineEvent) =>
  e.chain === "bitcoin" ? btcTxUrl(e.hash) : e.chain === "stellar" ? stellarTxUrl(e.hash) : destinationTxUrl(e.hash);

const CHAIN: Record<TimelineEvent["chain"], string> = {
  bitcoin: BTC_NETWORK_LABEL,
  stellar: networkName(config.networkPassphrase),
  "base-sepolia": "Base Sepolia testnet",
};

/**
 * The loan's events from the timeline source when there is one, else from
 * what this device knows. A failed read falls back to this device's events.
 */
function useTimelineEvents(m: LoanModel, position: Position): TimelineEvent[] {
  const owner = m.owner;
  const log = useSyncExternalStore(
    receiveLog.subscribe,
    () => (owner ? (receiveLog.snapshot(owner) ?? NONE) : NONE),
    () => NONE,
  );
  const local = useMemo(
    () => clientTimeline(position, m.activity, log[position.id] ?? []),
    [position, m.activity, log],
  );
  const api = m.timeline;
  const [remote, setRemote] = useState<{ txid: string; events: TimelineEvent[] } | null>(null);
  useEffect(() => {
    if (!api) return;
    let live = true;
    api
      .get(position.txid)
      .then((events) => live && setRemote({ txid: position.txid, events }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, position.txid]);
  return remote && remote.txid === position.txid ? remote.events : local;
}

/** Bitcoin lock, verified on Stellar, borrowed, received, repaid, BTC released: each step with its transaction. */
export function LoanTimeline({ m, position }: { m: LoanModel; position: Position }) {
  const all = timelineRows(useTimelineEvents(m, position));
  // The chain says which steps happened even when their transactions aren't on this device.
  const s = m.status.status;
  const repaid =
    (s.kind === "repaid_locked" && !s.neverBorrowed) || s.kind === "releasing" || s.kind === "released";
  const happened = (k: TimelineKind) =>
    (k === "borrowed" && (BigInt(position.debtStroops) > 0n || repaid)) || (k === "repaid" && repaid);
  // Without a swap or transfer of its own, a borrow is received as USDC with the borrow itself.
  const rows = all.filter((r) => r.event || r.kind !== "received" || !(happened("borrowed") || r.passed));
  return (
    <section className="ln-tl" aria-labelledby="ln-tl-h">
      <h2 id="ln-tl-h" className="ln-h2">
        Full cycle
      </h2>
      <ol className="ln-tl-list">
        {rows.map((r, i) => {
          const e = r.event;
          return (
            <li key={e ? `${e.kind}:${e.hash}` : `${r.kind}:${i}`} data-state={e || happened(r.kind) ? "done" : "next"}>
              <i aria-hidden="true" />
              <div>
                <b>{e?.label ?? TIMELINE_LABEL[r.kind]}</b>
                {e ? (
                  <span className="ln-tl-meta">
                    <ExternalLink href={urlOf(e)} className="wz-link mono">
                      {shortAddress(e.hash, 6, 4)}
                    </ExternalLink>
                    <span>
                      {CHAIN[e.chain]}
                      {e.at ? `, ${shortDate(e.at)}` : ""}
                    </span>
                  </span>
                ) : happened(r.kind) ? (
                  <span className="ln-tl-meta">Done. The transaction isn&apos;t on this device.</span>
                ) : r.passed ? (
                  <span className="ln-tl-meta">No transaction on this device</span>
                ) : (
                  <span className="ln-tl-meta">Not yet</span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {!m.timeline && <p className="wz-muted ln-tl-note">Built from this device. Steps taken on another device need the Writz indexer.</p>}
    </section>
  );
}
