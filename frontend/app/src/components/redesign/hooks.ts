"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { scenarioFromSearch, UI_MOCK } from "@/lib/mock/gate";
import type { MockWorld } from "@/lib/mock/types";
import type { Read } from "@/lib/loan/model";

const noop = () => () => {};

/** False on the server and during hydration, true after. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

let cached: { search: string; world: MockWorld | null } | null = null;

function mockSnapshot(): MockWorld | null {
  if (!UI_MOCK) return null;
  const search = window.location.search;
  if (cached?.search !== search) {
    const scenario = scenarioFromSearch(search, true);
    cached = { search, world: scenario ? scenario.build(Date.now()) : null };
  }
  return cached.world;
}

/** The dev harness scenario world for this URL, or null when the harness is off. */
export function useMockWorld(): MockWorld | null {
  return useSyncExternalStore(noop, mockSnapshot, () => null);
}

/** True once `active` has stayed true for `ms`. */
export function useElapsed(active: boolean, ms: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setElapsed(true), ms);
    return () => {
      clearTimeout(t);
      setElapsed(false);
    };
  }, [active, ms]);
  return active && elapsed;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const q = window.matchMedia("(prefers-reduced-motion: reduce)");
      q.addEventListener("change", cb);
      return () => q.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/** A read that starts over whenever `key` changes, so a stale answer never shows for another wallet. Null key: nothing to read. */
export function useRead<T>(key: string | null, load: () => Promise<T>): Read<T> {
  const [state, setState] = useState<{ key: string; value: Read<T> } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    load()
      .then((value) => live && setState({ key, value: { kind: "ok", value } }))
      .catch(() => live && setState({ key, value: { kind: "failed" } }));
    return () => {
      live = false;
    };
    // `load` is keyed by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return key && state?.key === key ? state.value : { kind: "checking" };
}
