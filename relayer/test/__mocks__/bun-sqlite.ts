/**
 * Test-only stand-in for `bun:sqlite`, used exclusively under Jest (which
 * runs on Node, where `bun:sqlite` doesn't exist). Production code
 * (`cursor-store.ts`, `leaf-store.ts`) is untouched and continues to use
 * the real `bun:sqlite` when run under Bun (`bun src/index.ts`,
 * `bun test`) - this file is wired in only via jest.config.js's
 * `moduleNameMapper` for the `bun:sqlite` specifier.
 *
 * Implements just enough of the `Database` API surface `cursor-store.ts`
 * uses (`exec`, `query().get()`, `prepare().run()`) for a single
 * `watcher_cursor` table. State is persisted to a JSON sidecar file next
 * to the given DB path - not an in-memory object - so it genuinely
 * survives `jest.resetModules()` within a test process, the same way the
 * real sqlite file survives a real process restart. This is what makes
 * repay-watcher.test.ts's "cursor survives a simulated restart" tests a
 * meaningful check rather than a tautology.
 */
import fs from "fs";

interface CursorRow {
  cursor: string;
}

export class Database {
  private readonly sidecarPath: string;

  constructor(dbPath: string, _opts?: { create?: boolean }) {
    this.sidecarPath = dbPath + ".mock.json";
  }

  exec(_sql: string): void {
    // CREATE TABLE / PRAGMA statements - no-op, this mock has one fixed shape.
  }

  private readState(): { cursor?: string } {
    try {
      return JSON.parse(fs.readFileSync(this.sidecarPath, "utf8"));
    } catch {
      return {};
    }
  }

  private writeState(state: { cursor?: string }): void {
    fs.writeFileSync(this.sidecarPath, JSON.stringify(state));
  }

  query<T, _A extends unknown[]>(sql: string) {
    return {
      get: (): T | undefined => {
        if (!/watcher_cursor/.test(sql)) {
          throw new Error(`mock bun:sqlite: unsupported query: ${sql}`);
        }
        const state = this.readState();
        return state.cursor !== undefined ? ({ cursor: state.cursor } as CursorRow as T) : undefined;
      },
      all: (): T[] => [],
    };
  }

  prepare<_T, A extends unknown[]>(sql: string) {
    return {
      run: (...args: A): void => {
        if (!/watcher_cursor/.test(sql)) {
          throw new Error(`mock bun:sqlite: unsupported statement: ${sql}`);
        }
        this.writeState({ cursor: args[0] as unknown as string });
      },
    };
  }
}
