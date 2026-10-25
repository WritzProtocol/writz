"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { BTC_NETWORK_LABEL, config } from "@/config";
import { shortAddress } from "@/lib/borrow/journey";
import { networkName } from "@/lib/wallet/precheck";
import { baseSepoliaTxUrl, btcTxUrl, stellarTxUrl } from "@/lib/explorer";
import { clientTimeline, receiveLog } from "@/lib/receive/clientTimeline";
import { TIMELINE_LABEL, timelineRows, type TimelineEvent } from "@/lib/receive/timeline";
import { shortDate } from "@/lib/loan/model";
import type { Position } from "@/lib/position/types";
import { ExternalLink } from "@/components/ui";
import type { LoanModel } from "./model";

const NONE: Record<string, TimelineEvent[]> = {};

const urlOf = (e: TimelineEvent) =>
  e.chain === "bitcoin" ? btcTxUrl(e.hash) : e.chain === "stellar" ? stellarTxUrl(e.hash) : baseSepoliaTxUrl(e.hash);

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
  const api = m.receive.timeline;
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
  const rows = timelineRows(useTimelineEvents(m, position));
  // Debt on chain means a borrow happened, even when its transaction isn't known here.
  const borrowedElsewhere = BigInt(position.debtStroops) > 0n;
  return (
    <section className="ln-tl" aria-labelledby="ln-tl-h">
      <h2 id="ln-tl-h" className="ln-h2">
        Full cycle
      </h2>
      <ol className="ln-tl-list">
        {rows.map((r, i) => {
          const e = r.event;
          return (
            <li
              key={e ? `${e.kind}:${e.hash}` : `${r.kind}:${i}`}
              data-state={e || (r.kind === "borrowed" && borrowedElsewhere) ? "done" : "next"}
            >
              <i aria-hidden="true" />
              <div>
                <b>
                  {TIMELINE_LABEL[r.kind]}
                  {e?.detail ? ` ${e.detail}` : ""}
                </b>
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
                ) : r.kind === "borrowed" && borrowedElsewhere ? (
                  <span className="ln-tl-meta">Done. The transaction isn&apos;t on this device.</span>
                ) : (
                  <span className="ln-tl-meta">Not yet</span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {!m.receive.timeline && <p className="wz-muted ln-tl-note">Built from this device. Steps taken on another device need the Writz indexer.</p>}
    </section>
  );
}
