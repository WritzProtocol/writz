"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Reads a value on an interval and keeps the last good one.
 *
 * The Earn position and APY are read from the relayer, which reads them from
 * DeFindex, which reads them from chain. Any link can be briefly unavailable,
 * so a failed poll must not blank a number the user is looking at: it keeps
 * the previous value and records the error separately. Blanking is only
 * correct before the first successful read.
 *
 * The value is keyed so it never survives the thing it described. Pass the
 * connected address as the key and switching wallets clears the display rather
 * than showing the previous account's balance until the next tick lands.
 */
export interface Polled<T> {
  /** Last successful value for the current key, or null before the first one. */
  value: T | null;
  /** True until the first read for this key settles. */
  loading: boolean;
  /** Error from the most recent attempt, cleared by the next success. */
  error: unknown;
  /** When the current `value` was read. */
  updatedAt: Date | null;
  /** Read again now, outside the interval. */
  refresh: () => Promise<void>;
}

/** Internal state: the last read for one key. */
export interface PolledState<T> {
  key: string;
  value: T | null;
  error: unknown;
  updatedAt: Date | null;
}

/**
 * The state transition for one completed read, extracted so the rules are
 * testable without rendering. Three of them, and the middle one is the point:
 *
 *   success            -> new value, error cleared, timestamp bumped
 *   failure, same key  -> value kept, error recorded (this is the whole reason
 *                         the hook exists: a blip must not blank the number
 *                         the user is reading)
 *   failure, new key   -> nothing to keep, so null value with the error
 */
export function applyRead<T>(
  prev: PolledState<T> | null,
  key: string,
  result: { ok: true; value: T } | { ok: false; error: unknown },
  now: Date,
): PolledState<T> {
  if (result.ok) {
    return { key, value: result.value, error: null, updatedAt: now };
  }
  if (prev?.key === key) {
    return { ...prev, error: result.error };
  }
  return { key, value: null, error: result.error, updatedAt: null };
}

export function usePolledValue<T>(
  key: string | null,
  /**
   * Must be referentially stable (wrap it in `useCallback`) - it is an effect
   * dependency, so a new identity every render would tear down and restart the
   * timer on each render and the interval would never elapse. Everything it
   * needs should come from its `key` argument rather than from a closure, so
   * an empty dependency list is usually correct.
   */
  read: (key: string) => Promise<T>,
  intervalMs: number,
): Polled<T> {
  const [state, setState] = useState<PolledState<T> | null>(null);

  const load = useCallback(
    async (target: string) => {
      let result: { ok: true; value: T } | { ok: false; error: unknown };
      try {
        result = { ok: true, value: await read(target) };
      } catch (error) {
        result = { ok: false, error };
      }
      setState((prev) => applyRead(prev, target, result, new Date()));
    },
    [read],
  );

  useEffect(() => {
    if (!key) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      await load(key);
    };

    void tick();
    const timer = setInterval(() => void tick(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key, intervalMs, load]);

  const refresh = useCallback(async () => {
    if (key) await load(key);
  }, [key, load]);

  const current = state?.key === key ? state : null;

  return {
    value: current?.value ?? null,
    loading: current === null,
    error: current?.error ?? null,
    updatedAt: current?.updatedAt ?? null,
    refresh,
  };
}
