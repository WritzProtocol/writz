/**
 * Persistence for the relayer outbox (#267, GHSA-vwvv-3255-783f item 4): the
 * `/insert-commitment` and `/update-leaf` calls the app still owes the relayer
 * after an on-chain deposit, borrow or repay. Entries live in IndexedDB, keyed
 * by Stellar address and network, so they survive a closed tab or a reload.
 *
 * Nothing here is a signing secret. `authTxXdr` is a signed, single-purpose
 * transaction already bound to the depositor (GHSA-wqp4), so it may be stored.
 */

export type OutboxKind = "insert-commitment" | "update-leaf";

/** Body of `POST /insert-commitment`. */
export interface InsertCommitmentPayload {
  commitment: string;
  encNote?: string;
  authTxXdr: string;
}

/** Body of `POST /update-leaf`. */
export interface UpdateLeafPayload {
  leafIndex: number;
  newCommitment: string;
  encNote?: string;
}

interface EntryBase {
  /** Unique per entry; the commitment the call is about plus its kind. */
  id: string;
  /** The commitment the call inserts or writes, 64-char hex. */
  commitment: string;
  createdAt: number;
  /** Failed attempts so far. */
  attempts: number;
  lastError?: string;
  /** Earliest time the next attempt may run (ms since epoch). */
  nextAttemptAt: number;
  /**
   * `pending` until the on-chain transaction is confirmed: the entry is
   * written before submit and is never sent while pending.
   */
  state: "pending" | "ready";
}

export type OutboxEntry =
  | (EntryBase & { kind: "insert-commitment"; payload: InsertCommitmentPayload })
  | (EntryBase & { kind: "update-leaf"; payload: UpdateLeafPayload });

/** Where the outbox keeps its entries. `owner` is `${network}:${address}`. */
export interface OutboxStore {
  list(owner: string): Promise<OutboxEntry[]>;
  put(owner: string, entry: OutboxEntry): Promise<void>;
  remove(owner: string, id: string): Promise<void>;
}

export function outboxOwner(network: string, address: string): string {
  return `${network}:${address}`;
}

export function entryId(kind: OutboxKind, commitment: string): string {
  return `${kind}:${commitment}`;
}

/** A store held in memory: for tests, and the fallback where IndexedDB is unavailable. */
export function createMemoryOutboxStore(): OutboxStore {
  const byOwner = new Map<string, Map<string, OutboxEntry>>();
  const of = (owner: string) => {
    let m = byOwner.get(owner);
    if (!m) byOwner.set(owner, (m = new Map()));
    return m;
  };
  return {
    async list(owner) {
      return [...of(owner).values()].map((e) => structuredClone(e));
    },
    async put(owner, entry) {
      of(owner).set(entry.id, structuredClone(entry));
    },
    async remove(owner, id) {
      of(owner).delete(id);
    },
  };
}

const DB_NAME = "writz-relayer-outbox";
const STORE = "entries";

/** Rows are stored with their owner so one object store serves every wallet and network. */
type Row = OutboxEntry & { owner: string; key: string };

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The IndexedDB store, or `null` where IndexedDB does not exist (server render, some private modes). */
export function createIndexedDbOutboxStore(idb: IDBFactory | undefined = globalThis.indexedDB): OutboxStore | null {
  if (!idb) return null;
  let db: Promise<IDBDatabase> | null = null;
  const open = () =>
    (db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = idb.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore(STORE, { keyPath: "key" });
        s.createIndex("owner", "owner");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        db = null;
        reject(req.error);
      };
    }));
  const tx = async (mode: IDBTransactionMode) => (await open()).transaction(STORE, mode).objectStore(STORE);

  return {
    async list(owner) {
      const rows = (await request((await tx("readonly")).index("owner").getAll(owner))) as Row[];
      return rows.map((row) => {
        const entry: Partial<Row> = { ...row };
        delete entry.owner;
        delete entry.key;
        return entry as OutboxEntry;
      });
    },
    async put(owner, entry) {
      const row: Row = { ...entry, owner, key: `${owner}|${entry.id}` };
      await request((await tx("readwrite")).put(row));
    },
    async remove(owner, id) {
      await request((await tx("readwrite")).delete(`${owner}|${id}`));
    },
  };
}
