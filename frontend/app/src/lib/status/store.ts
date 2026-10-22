import { derivePositionStatus } from "./derive";
import { readStatusInputs, type StatusSource } from "./source";
import type { DerivedStatus, LocalInputs } from "./types";

export const CHECKING: DerivedStatus = {
  status: { kind: "checking", missing: [] },
  reclaimable: false,
  timelock: null,
  syncing: false,
};

/** Changes whenever the local inputs that drive the status change. */
export function statusKey(local: LocalInputs): string | null {
  const id = local.position?.id ?? local.pendingDeposit?.btcTxid;
  if (!id) return null;
  return [
    id,
    local.position?.status,
    local.position?.releaseTxid,
    local.pendingDeposit?.step,
    local.pendingDeposit?.stellarTxHash,
    local.proving ? "proving" : "",
    local.insertFailed ? "insert_failed" : "",
    (local.pendingTxs ?? []).map((t) => t.hash).join(","),
  ].join("|");
}

export interface StatusStore {
  get(key: string): DerivedStatus;
  refresh(key: string, local: LocalInputs): Promise<DerivedStatus>;
  subscribe(cb: () => void): () => void;
}

export function createStatusStore(
  source: StatusSource,
  opts: { minConfirmations: number; now?: () => number },
): StatusStore {
  const cache = new Map<string, DerivedStatus>();
  const latest = new Map<string, number>();
  const listeners = new Set<() => void>();
  let seq = 0;

  return {
    get: (key) => cache.get(key) ?? CHECKING,
    async refresh(key, local) {
      const mine = ++seq;
      latest.set(key, mine);
      const inputs = await readStatusInputs(local, source, {
        minConfirmations: opts.minConfirmations,
        now: (opts.now ?? Date.now)(),
      });
      const derived = derivePositionStatus(inputs);
      if (latest.get(key) === mine) {
        cache.set(key, derived);
        for (const l of listeners) l();
      }
      return derived;
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
