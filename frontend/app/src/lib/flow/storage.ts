import type { StorageLike } from "./lock";

export function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface JsonStore<T> {
  read(owner: string): T | null;
  write(owner: string, value: T | null): void;
  /** Same-tab writes and other tabs' `storage` events. */
  subscribe(cb: () => void): () => void;
  /** Stable snapshot for `useSyncExternalStore`. */
  snapshot(owner: string): T | null;
}

export function createJsonStore<T>(
  prefix: string,
  storage: () => StorageLike | null = browserStorage,
): JsonStore<T> {
  const listeners = new Set<() => void>();
  const cache = new Map<string, { raw: string | null; value: T | null }>();
  let bound = false;

  const notify = () => {
    for (const l of listeners) l();
  };

  function rawFor(owner: string): string | null {
    try {
      return storage()?.getItem(prefix + owner) ?? null;
    } catch {
      return null;
    }
  }

  function parse(raw: string | null): T | null {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  return {
    read: (owner) => parse(rawFor(owner)),
    write(owner, value) {
      const s = storage();
      if (!s) return;
      if (value === null && s.removeItem) s.removeItem(prefix + owner);
      else s.setItem(prefix + owner, JSON.stringify(value));
      notify();
    },
    subscribe(cb) {
      listeners.add(cb);
      if (!bound && typeof window !== "undefined") {
        bound = true;
        window.addEventListener("storage", (e) => {
          if (!e.key || e.key.startsWith(prefix)) notify();
        });
      }
      return () => {
        listeners.delete(cb);
      };
    },
    snapshot(owner) {
      const raw = rawFor(owner);
      const hit = cache.get(owner);
      if (hit && hit.raw === raw) return hit.value;
      const value = parse(raw);
      cache.set(owner, { raw, value });
      return value;
    },
  };
}
