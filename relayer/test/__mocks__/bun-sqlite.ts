/**
 * Test-only stand-in for `bun:sqlite`, used exclusively under Jest (which
 * runs on Node, where `bun:sqlite` doesn't exist). Production code
 * (`cursor-store.ts`, `leaf-store.ts`, `vault-watcher/event-store.ts`) is
 * untouched and continues to use the real `bun:sqlite` when run under Bun
 * (`bun src/index.ts`, `bun test`) - this file is wired in only via
 * jest.config.js's `moduleNameMapper` for the `bun:sqlite` specifier.
 *
 * Implements just enough of the `Database` API surface for four fixed
 * shapes: the single-row `watcher_cursor` table (`cursor-store.ts`,
 * `vault-watcher/cursor-store.ts`), the append-only `vault_events` table
 * (`vault-watcher/event-store.ts`), the `leaves`/`notes` tables
 * (`leaf-store.ts`), and the append-only `tree_events` archive
 * (`tree-watcher/event-archive.ts`). State is persisted to a JSON sidecar
 * file next to the given DB path - not an in-memory object - so it
 * genuinely survives `jest.resetModules()` within a test process, the same
 * way the real sqlite file survives a real process restart. This is what
 * makes repay-watcher.test.ts's "cursor survives a simulated restart" tests
 * a meaningful check rather than a tautology.
 */
import fs from "fs";

interface CursorRow {
  cursor: string;
}

interface VaultEventRow {
  cursor: string;
  kind: string;
  depositor: string;
  amountStroops: string;
  ledger: number;
  txHash: string;
  ledgerCloseTime: number;
}

interface LeafRow {
  idx: number;
  commitment: string;
}

interface NoteRow {
  leafIndex: number;
  encNote: string;
}

interface TreeEventRow {
  id: string;
  ledger: number;
  txHash: string;
  kind: string;
  newRoot: string;
  commitment: string;
  leafIndex: number | null;
  encNote: string | null;
  rawXdr: string;
}

interface State {
  cursor?: string;
  treeEvents?: TreeEventRow[];
  vaultEvents?: VaultEventRow[];
  leaves?: LeafRow[];
  notes?: NoteRow[];
}

export class Database {
  private readonly sidecarPath: string;

  constructor(dbPath: string, _opts?: { create?: boolean }) {
    this.sidecarPath = dbPath + ".mock.json";
  }

  exec(_sql: string): void {
    // CREATE TABLE / PRAGMA statements - no-op, this mock has fixed shapes.
  }

  private readState(): State {
    try {
      return JSON.parse(fs.readFileSync(this.sidecarPath, "utf8"));
    } catch {
      return {};
    }
  }

  private writeState(state: State): void {
    fs.writeFileSync(this.sidecarPath, JSON.stringify(state));
  }

  query<T, _A extends unknown[]>(sql: string) {
    return {
      get: (): T | undefined => {
        if (/COUNT\(\*\) AS n FROM tree_events/.test(sql)) {
          return { n: (this.readState().treeEvents ?? []).length } as T;
        }
        if (!/watcher_cursor/.test(sql)) {
          throw new Error(`mock bun:sqlite: unsupported query: ${sql}`);
        }
        const state = this.readState();
        return state.cursor !== undefined ? ({ cursor: state.cursor } as CursorRow as T) : undefined;
      },
      all: (...args: unknown[]): T[] => {
        if (/FROM tree_events/.test(sql)) {
          const after = /WHERE id > \?/.test(sql) ? (args[0] as string) : undefined;
          const limit = args[args.length - 1] as number;
          return ([...(this.readState().treeEvents ?? [])]
            .filter((r) => after === undefined || r.id > after)
            .sort((a, b) => a.ledger - b.ledger || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            .slice(0, limit) as unknown[]) as T[];
        }
        if (/vault_events/.test(sql)) {
          const state = this.readState();
          return ((state.vaultEvents ?? []) as unknown[]) as T[];
        }
        if (/FROM leaves/.test(sql)) {
          const state = this.readState();
          const rows = [...(state.leaves ?? [])].sort((a, b) => a.idx - b.idx);
          return (rows.map((r) => ({ commitment: r.commitment })) as unknown[]) as T[];
        }
        if (/FROM notes/.test(sql)) {
          const state = this.readState();
          const rows = [...(state.notes ?? [])].sort((a, b) => a.leafIndex - b.leafIndex);
          return (rows as unknown[]) as T[];
        }
        throw new Error(`mock bun:sqlite: unsupported query: ${sql}`);
      },
      // `DELETE FROM leaves` is issued via `.query(sql).run()` in leaf-store.ts,
      // not `.prepare()` - matches real bun:sqlite's Statement, which supports
      // both entry points.
      run: (): void => {
        if (!/DELETE FROM leaves/.test(sql)) {
          throw new Error(`mock bun:sqlite: unsupported statement: ${sql}`);
        }
        this.writeState({ ...this.readState(), leaves: [] });
      },
    };
  }

  prepare<_T, A extends unknown[]>(sql: string) {
    return {
      run: (...args: A): void => {
        if (/watcher_cursor/.test(sql)) {
          this.writeState({ ...this.readState(), cursor: args[0] as unknown as string });
          return;
        }
        if (/vault_events/.test(sql)) {
          const [cursor, kind, depositor, amountStroops, ledger, txHash, ledgerCloseTime] =
            args as unknown as [string, string, string, string, number, string, number];
          const state = this.readState();
          const rows = state.vaultEvents ?? [];
          const isDuplicate = rows.some(
            (r) =>
              r.txHash === txHash &&
              r.depositor === depositor &&
              r.kind === kind &&
              r.amountStroops === amountStroops,
          );
          if (!isDuplicate) {
            rows.push({ cursor, kind, depositor, amountStroops, ledger, txHash, ledgerCloseTime });
          }
          this.writeState({ ...state, vaultEvents: rows });
          return;
        }
        if (/INTO tree_events/.test(sql)) {
          const [id, ledger, txHash, kind, newRoot, commitment, leafIndex, encNote, rawXdr] =
            args as unknown as [string, number, string, string, string, string, number | null, string | null, string];
          const state = this.readState();
          const rows = state.treeEvents ?? [];
          // INSERT OR IGNORE on the primary key.
          if (!rows.some((r) => r.id === id)) {
            rows.push({ id, ledger, txHash, kind, newRoot, commitment, leafIndex, encNote, rawXdr });
          }
          this.writeState({ ...state, treeEvents: rows });
          return;
        }
        if (/INTO leaves/.test(sql)) {
          const [idx, commitment] = args as unknown as [number, string];
          const state = this.readState();
          const rows = (state.leaves ?? []).filter((r) => r.idx !== idx);
          rows.push({ idx, commitment });
          this.writeState({ ...state, leaves: rows });
          return;
        }
        if (/INTO notes/.test(sql)) {
          const [leafIndex, encNote] = args as unknown as [number, string];
          const state = this.readState();
          const rows = (state.notes ?? []).filter((r) => r.leafIndex !== leafIndex);
          rows.push({ leafIndex, encNote });
          this.writeState({ ...state, notes: rows });
          return;
        }
        throw new Error(`mock bun:sqlite: unsupported statement: ${sql}`);
      },
    };
  }

  /** Real bun:sqlite wraps `fn` for atomicity; this mock's writes are
   * synchronous and single-threaded, so it's sufficient to just run `fn`
   * and return a callable matching the real `db.transaction(fn)()` usage. */
  transaction<F extends (...args: unknown[]) => unknown>(fn: F): F {
    return fn;
  }
}
