/**
 * One Stellar transaction in flight per account across tabs (ux-spec 6.4):
 * Web Locks hold the lock, BroadcastChannel tells the other tabs so they can
 * disable their actions. Falls back to a per-tab lock where Web Locks are
 * missing.
 */

export interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable?: boolean; signal?: AbortSignal },
    callback: (lock: unknown) => Promise<unknown>,
  ): Promise<unknown>;
  query?(): Promise<{ held?: { name?: string }[] }>;
}

export interface ChannelLike {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close(): void;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface LockEnv {
  locks: LockManagerLike | null;
  openChannel: ((name: string) => ChannelLike) | null;
  storage: StorageLike | null;
}

export type TxLockState = "free" | "here" | "elsewhere";

export class TxBusyError extends Error {
  constructor() {
    super("TxLockBusy");
    this.name = "TxBusyError";
  }
}

const CHANNEL = "writz.tx";
const STALE_RECHECK_MS = 2_000;

export const txLockName = (account: string) => `writz.tx.${account}`;
export const depositLockName = (account: string) => `writz.deposit.${account}`;
const indexLockName = (owner: string) => `writz.index.${owner}`;
const reservedKey = (owner: string) => `writz.reservedIndices.${owner}`;

export function browserLockEnv(): LockEnv {
  if (typeof window === "undefined") return { locks: null, openChannel: null, storage: null };
  const locks =
    typeof navigator !== "undefined" && "locks" in navigator
      ? (navigator.locks as unknown as LockManagerLike)
      : null;
  const openChannel =
    typeof BroadcastChannel !== "undefined"
      ? (name: string) => new BroadcastChannel(name) as unknown as ChannelLike
      : null;
  return { locks, openChannel, storage: window.localStorage };
}

/** The smallest index not below any index already used or reserved. */
export function nextPositionIndex(used: Iterable<number>): number {
  let max = -1;
  for (const i of used) if (Number.isInteger(i) && i > max) max = i;
  return max + 1;
}

function readReserved(storage: StorageLike | null, owner: string): number[] {
  try {
    const raw = storage?.getItem(reservedKey(owner));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((n): n is number => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

export function createLockRegistry(env: LockEnv) {
  const localHeld = new Set<string>();
  const localWaiters = new Map<string, (() => void)[]>();

  /** Resolves to a release function, or to null when `ifAvailable` and the lock is taken. */
  function holdLock(
    name: string,
    options: { ifAvailable?: boolean; signal?: AbortSignal } = {},
  ): Promise<(() => void) | null> {
    if (env.locks) {
      const locks = env.locks;
      return new Promise((resolve, reject) => {
        locks
          .request(name, options, (lock) => {
            if (!lock) {
              resolve(null);
              return Promise.resolve();
            }
            return new Promise<void>((release) => resolve(() => release()));
          })
          .catch(reject);
      });
    }
    const release = () => {
      localHeld.delete(name);
      const next = localWaiters.get(name)?.shift();
      next?.();
    };
    if (!localHeld.has(name)) {
      localHeld.add(name);
      return Promise.resolve(release);
    }
    if (options.ifAvailable) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const grant = () => {
        localHeld.add(name);
        resolve(release);
      };
      const queue = localWaiters.get(name) ?? [];
      queue.push(grant);
      localWaiters.set(name, queue);
      options.signal?.addEventListener("abort", () => {
        const q = localWaiters.get(name);
        if (q) localWaiters.set(name, q.filter((g) => g !== grant));
        reject(options.signal?.reason ?? new Error("Aborted"));
      });
    });
  }

  // ── Cross-tab view of the per-account transaction lock ─────────────────

  const here = new Map<string, number>();
  const elsewhere = new Set<string>();
  const listeners = new Set<() => void>();
  let channel: ChannelLike | null = null;
  let recheck: ReturnType<typeof setInterval> | null = null;

  const notify = () => {
    for (const l of listeners) l();
  };

  async function heldAnywhere(account: string): Promise<boolean | null> {
    if (!env.locks?.query) return null;
    const { held = [] } = await env.locks.query();
    return held.some((l) => l.name === txLockName(account));
  }

  function scheduleRecheck() {
    if (recheck || elsewhere.size === 0) return;
    // A tab that closes mid-transaction never broadcasts "free"; the browser
    // drops its lock, so poll the lock table until it is gone.
    recheck = setInterval(async () => {
      for (const account of [...elsewhere]) {
        const held = await heldAnywhere(account).catch(() => null);
        if (held === false) {
          elsewhere.delete(account);
          notify();
        }
      }
      if (elsewhere.size === 0 && recheck) {
        clearInterval(recheck);
        recheck = null;
      }
    }, STALE_RECHECK_MS);
  }

  function ensureChannel() {
    if (channel || !env.openChannel) return;
    channel = env.openChannel(CHANNEL);
    channel.onmessage = (event) => {
      const data = event.data as { account?: string; busy?: boolean } | null;
      if (!data?.account) return;
      if (data.busy) elsewhere.add(data.account);
      else elsewhere.delete(data.account);
      notify();
      scheduleRecheck();
    };
  }

  function announce(account: string, busy: boolean) {
    ensureChannel();
    channel?.postMessage({ account, busy });
  }

  function txLockState(account: string): TxLockState {
    if ((here.get(account) ?? 0) > 0) return "here";
    return elsewhere.has(account) ? "elsewhere" : "free";
  }

  function subscribeTxLock(account: string, cb: () => void): () => void {
    ensureChannel();
    listeners.add(cb);
    void heldAnywhere(account)
      .then((held) => {
        if (held && txLockState(account) === "free") {
          elsewhere.add(account);
          notify();
          scheduleRecheck();
        }
      })
      .catch(() => {});
    return () => {
      listeners.delete(cb);
    };
  }

  /** Runs `fn` holding the account's transaction lock; throws `TxBusyError` if another tab or flow holds it. */
  async function withTxLock<T>(account: string, fn: () => Promise<T>): Promise<T> {
    const release = await holdLock(txLockName(account), { ifAvailable: true });
    if (!release) throw new TxBusyError();
    here.set(account, (here.get(account) ?? 0) + 1);
    notify();
    announce(account, true);
    try {
      return await fn();
    } finally {
      release();
      here.set(account, (here.get(account) ?? 1) - 1);
      notify();
      announce(account, false);
    }
  }

  /** Reserves the next position index for `owner` so two tabs never derive the same keys. */
  async function reservePositionIndex(owner: string, used: number[]): Promise<number> {
    const release = await holdLock(indexLockName(owner));
    try {
      const reserved = readReserved(env.storage, owner);
      const index = nextPositionIndex([...used, ...reserved]);
      env.storage?.setItem(reservedKey(owner), JSON.stringify([...reserved, index]));
      return index;
    } finally {
      release?.();
    }
  }

  /** Frees a reservation whose deposit never sent BTC. */
  async function releasePositionIndex(owner: string, index: number): Promise<void> {
    const release = await holdLock(indexLockName(owner));
    try {
      const reserved = readReserved(env.storage, owner).filter((i) => i !== index);
      env.storage?.setItem(reservedKey(owner), JSON.stringify(reserved));
    } finally {
      release?.();
    }
  }

  return {
    holdLock,
    withTxLock,
    txLockState,
    subscribeTxLock,
    reservePositionIndex,
    releasePositionIndex,
  };
}

export type LockRegistry = ReturnType<typeof createLockRegistry>;

let registry: LockRegistry | null = null;

/** The browser-wide registry, created on first use. */
export function locks(): LockRegistry {
  if (typeof window === "undefined") return createLockRegistry(browserLockEnv());
  registry ??= createLockRegistry(browserLockEnv());
  return registry;
}
