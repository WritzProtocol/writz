"use client";

import { useCallback, useEffect, useReducer, useSyncExternalStore } from "react";
import { useReportBusy } from "@/lib/activity";
import { IDLE, guardsUnload, isInFlight, reduceFlow, type Emit, type FlowState } from "./engine";
import { locks, type TxLockState } from "./lock";

/** Whether this account's transaction lock is free, held by this tab, or held by another tab. */
export function useTxLockState(account: string | null): TxLockState {
  return useSyncExternalStore(
    (cb) => (account ? locks().subscribeTxLock(account, cb) : () => {}),
    () => (account ? locks().txLockState(account) : "free"),
    () => "free",
  );
}

/** Warns before the tab closes while `active` is true. */
export function useBeforeUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}

/** Holds one flow's lifecycle state, reports it as busy and guards unload while it matters. */
export function useFlow(initial: FlowState = IDLE): [FlowState, Emit] {
  const [state, dispatch] = useReducer(reduceFlow, initial);
  const emit = useCallback<Emit>((event) => dispatch(event), []);
  useReportBusy(isInFlight(state));
  useBeforeUnloadGuard(guardsUnload(state));
  return [state, emit];
}
