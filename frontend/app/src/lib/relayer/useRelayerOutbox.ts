"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isStuck, processOutbox, RETRY_BASE_MS, type OutboxDeps } from "./outbox";
import type { OutboxEntry } from "./outboxStore";

export interface RelayerOutboxState {
  /** Entries that failed `NOTICE_AFTER_FAILURES` times and are still owed. */
  stuck: OutboxEntry[];
  /** Sends every ready entry now, ignoring the backoff. */
  retryNow(): Promise<void>;
  retrying: boolean;
}

/**
 * Runs the relayer outbox for one wallet (#267): on load, when the browser
 * comes back online, and every 30 s while the app is open. Each entry still
 * waits out its own backoff; this only decides when to look.
 */
export function useRelayerOutbox(owner: string | null, deps: () => OutboxDeps, intervalMs = RETRY_BASE_MS): RelayerOutboxState {
  // Kept with the owner it belongs to, so switching wallets never shows the previous one's entries.
  const [stuckOf, setStuckOf] = useState<{ owner: string; entries: OutboxEntry[] } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const running = useRef<Promise<void> | null>(null);

  const run = useCallback(
    (force = false) => {
      if (!owner) return Promise.resolve();
      // Runs never overlap, so two of them never send the same entry.
      running.current ??= processOutbox(owner, deps(), { force })
        .then((r) => setStuckOf({ owner, entries: r.remaining.filter(isStuck) }))
        .catch(() => undefined)
        .finally(() => {
          running.current = null;
        });
      return running.current;
    },
    [owner, deps],
  );

  useEffect(() => {
    if (!owner) return;
    void run();
    const onOnline = () => void run();
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => void run(), intervalMs);
    return () => {
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, [owner, run, intervalMs]);

  const retryNow = useCallback(async () => {
    setRetrying(true);
    try {
      await running.current;
      await run(true);
    } finally {
      setRetrying(false);
    }
  }, [run]);

  const stuck = owner && stuckOf?.owner === owner ? stuckOf.entries : [];
  return { stuck, retryNow, retrying };
}
