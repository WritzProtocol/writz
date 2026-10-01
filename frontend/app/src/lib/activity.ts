"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * In-memory registry of flows that are mid-transaction in this tab, so the
 * wallet menu can confirm before a disconnect.
 */
const active = new Set<symbol>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Mark the calling component's flow as in progress while `busy` is true. */
export function useReportBusy(busy: boolean): void {
  useEffect(() => {
    if (!busy) return;
    const token = Symbol();
    active.add(token);
    notify();
    return () => {
      active.delete(token);
      notify();
    };
  }, [busy]);
}

/** True while any flow in this tab is in progress. */
export function useAnyFlowBusy(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => active.size > 0,
    () => false,
  );
}
