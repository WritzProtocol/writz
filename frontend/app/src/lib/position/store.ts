import type { Position, PositionsBackup } from "./types";

/**
 * Local persistence for positions, keyed by owner address, in `localStorage`.
 * Storage key: `writz.positions.<address>`.
 */
const KEY_PREFIX = "writz.positions.";
const keyFor = (owner: string) => `${KEY_PREFIX}${owner}`;

function read(owner: string): Position[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(keyFor(owner));
    return raw ? (JSON.parse(raw) as Position[]) : [];
  } catch {
    return [];
  }
}

function write(owner: string, positions: Position[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(keyFor(owner), JSON.stringify(positions));
  notify();
}

// ── Reactive subscription (for React's useSyncExternalStore) ────────────────

const listeners = new Set<() => void>();
let storageBound = false;

function notify(): void {
  for (const l of listeners) l();
}

/** Subscribe to position changes (same-tab writes and cross-tab storage events). */
export function subscribePositions(cb: () => void): () => void {
  listeners.add(cb);
  if (typeof window !== "undefined" && !storageBound) {
    storageBound = true;
    window.addEventListener("storage", notify);
  }
  return () => {
    listeners.delete(cb);
  };
}

/** Stable empty snapshot (server + disconnected). */
export const EMPTY_POSITIONS: readonly Position[] = Object.freeze([]);

const snapshotCache = new Map<string, { raw: string | null; value: Position[] }>();

/**
 * Snapshot for `useSyncExternalStore`: returns a stable array reference while
 * the underlying storage string is unchanged, so React does not loop.
 */
export function positionsSnapshot(owner: string): readonly Position[] {
  if (typeof window === "undefined") return EMPTY_POSITIONS;
  const raw = localStorage.getItem(keyFor(owner));
  const cached = snapshotCache.get(owner);
  if (cached && cached.raw === raw) return cached.value;
  const value = raw ? (JSON.parse(raw) as Position[]) : [];
  snapshotCache.set(owner, { raw, value });
  return value;
}

export function listPositions(owner: string): Position[] {
  return read(owner);
}

export function getPosition(owner: string, id: string): Position | undefined {
  return read(owner).find((p) => p.id === id);
}

/** Insert or update a position (matched by `id`). */
export function savePosition(position: Position): void {
  const positions = read(position.owner);
  const idx = positions.findIndex((p) => p.id === position.id);
  if (idx >= 0) positions[idx] = position;
  else positions.push(position);
  write(position.owner, positions);
}

export function removePosition(owner: string, id: string): void {
  write(
    owner,
    read(owner).filter((p) => p.id !== id),
  );
}

/** Serialize an owner's positions for backup. */
export function exportPositions(owner: string): string {
  const backup: PositionsBackup = { version: 1, owner, positions: read(owner) };
  return JSON.stringify(backup, null, 2);
}

/** Restore positions from a backup, merging by id. Returns the count imported. */
export function importPositions(json: string): { owner: string; count: number } {
  const data = JSON.parse(json) as PositionsBackup;
  if (!data?.owner || !Array.isArray(data.positions)) {
    throw new Error("Invalid positions backup");
  }
  const byId = new Map(read(data.owner).map((p) => [p.id, p]));
  for (const p of data.positions) byId.set(p.id, p);
  write(data.owner, [...byId.values()]);
  return { owner: data.owner, count: data.positions.length };
}
