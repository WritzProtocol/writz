"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { config } from "@/config";
import { activeScenario } from "@/lib/mock/gate";
import { mockStatusSource } from "@/lib/mock/source";
import { createClientStatusSource } from "./client";
import type { StatusSource } from "./source";
import { CHECKING, createStatusStore, statusKey, type StatusStore } from "./store";
import type { DerivedStatus, LocalInputs } from "./types";

const StatusContext = createContext<StatusStore | null>(null);

/** Client reads, or the selected mock scenario when the dev harness is on. */
export function defaultStatusSource(): StatusSource {
  const scenario = activeScenario();
  return scenario ? mockStatusSource(scenario.build(Date.now())) : createClientStatusSource();
}

export function StatusProvider({
  source,
  store: injected,
  children,
}: {
  source?: StatusSource;
  store?: StatusStore;
  children: React.ReactNode;
}) {
  const [store] = useState(
    () =>
      injected ??
      createStatusStore(source ?? defaultStatusSource(), { minConfirmations: config.bitcoin.minConfirmations }),
  );
  return <StatusContext.Provider value={store}>{children}</StatusContext.Provider>;
}

export const DEFAULT_POLL_MS = 30_000;

/** Re-reads one position's status now, for a "Check again" action. */
export function useRefreshStatus(): (local: LocalInputs | null) => void {
  const store = useContext(StatusContext);
  return useCallback(
    (local) => {
      const key = local ? statusKey(local) : null;
      if (store && key && local) void store.refresh(key, local);
    },
    [store],
  );
}

/** Status of one position or pending deposit, refreshed on mount and every `pollMs`. */
export function usePositionStatus(local: LocalInputs | null, pollMs = DEFAULT_POLL_MS): DerivedStatus {
  const store = useContext(StatusContext);
  if (!store) throw new Error("usePositionStatus must be used inside a StatusProvider");

  const key = local ? statusKey(local) : null;
  const latest = useRef(local);
  useEffect(() => {
    latest.current = local;
  });

  const read = () => (key ? store.get(key) : CHECKING);
  const status = useSyncExternalStore(store.subscribe, read, read);

  useEffect(() => {
    if (!key) return;
    const tick = () => {
      if (latest.current) void store.refresh(key, latest.current);
    };
    tick();
    const id = setInterval(tick, pollMs);
    return () => clearInterval(id);
  }, [store, key, pollMs]);

  return status;
}
