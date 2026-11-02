/**
 * Follows `writz-lend` and archives its events (see store.ts).
 *
 * An empty archive starts from `WRITZ_LEND_DEPLOY_LEDGER`, never from the
 * chain tip. A failure stops the cycle with the cursor where it was and shows
 * on /health, because an archive that skips ahead is worse than one that
 * visibly stops.
 *
 * `./decode.js` is loaded lazily, for the reason at the top of
 * ../repay-watcher/poller.ts.
 */
import { lendEventStore, type LendEventRow, type LendEventStore } from "./store.js";

/** Pages read per poll, so catching up cannot starve the rest of the loop. */
const MAX_PAGES_PER_POLL = 20;

export interface LendEventsServer {
  getEvents(
    request:
      | { filters: { type: "contract"; contractIds: string[] }[]; cursor: string }
      | { filters: { type: "contract"; contractIds: string[] }[]; startLedger: number },
  ): Promise<{ events: unknown[]; cursor: string }>;
}

export interface LendEventsCycleDeps {
  server: LendEventsServer;
  contractId: string;
  store: LendEventStore;
  /** Where an empty archive starts. Required only in that case. */
  deployLedger: number | undefined;
  decodeEvent: (event: never, contractId: string) => LendEventRow | null;
}

/** Reads pages until the chain has nothing newer. Each page commits on its own. */
export async function runLendEventsCycle(deps: LendEventsCycleDeps): Promise<void> {
  const { server, contractId, store, deployLedger, decodeEvent } = deps;
  const filters = [{ type: "contract" as const, contractIds: [contractId] }];
  for (let page = 0; page < MAX_PAGES_PER_POLL; page++) {
    const cursor = store.readCursor();
    if (!cursor && deployLedger === undefined) {
      throw new Error("empty archive and WRITZ_LEND_DEPLOY_LEDGER is not set");
    }
    const response = cursor
      ? await server.getEvents({ filters, cursor })
      : await server.getEvents({ filters, startLedger: deployLedger! });
    const rows: LendEventRow[] = [];
    for (const event of response.events) {
      const row = decodeEvent(event as never, contractId);
      if (row) rows.push(row);
    }
    store.commit(rows, response.cursor);
    if (response.events.length === 0) return;
  }
}

let lastError: string | null = null;

/** What /health reports. */
export function lendEventsStatus(contractId: string) {
  return { ok: lastError === null, lastLedger: lendEventStore().lastLedger(contractId), lastError };
}

export function startLendEventArchive(): { stop: () => void } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see top-of-file comment
  const { config } = require("../config.js") as typeof import("../config.js");
  if (!config.writzLendId) {
    console.warn("[lend-events] WRITZ_LEND_ID not configured - archive disabled");
    return { stop: () => {} };
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see top-of-file comment
  const { rpc } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see top-of-file comment
  const { decodeLendEvent } = require("./decode.js") as typeof import("./decode.js");
  const server = new rpc.Server(config.stellarRpcUrl, {
    allowHttp: config.stellarRpcUrl.startsWith("http://"),
  });
  let stopped = false;

  async function loop(): Promise<void> {
    while (!stopped) {
      try {
        await runLendEventsCycle({
          server: server as unknown as LendEventsServer,
          contractId: config.writzLendId,
          store: lendEventStore(),
          deployLedger: config.writzLendDeployLedger,
          decodeEvent: decodeLendEvent as LendEventsCycleDeps["decodeEvent"],
        });
        lastError = null;
      } catch (e) {
        lastError = e instanceof Error ? e.message.split("\n")[0]! : String(e);
        console.error("[lend-events] poll failed:", e instanceof Error ? e.message : e);
      }
      if (stopped) break;
      await new Promise((resolve) => setTimeout(resolve, config.lendEventsPollIntervalMs));
    }
  }

  void loop();
  return { stop: () => { stopped = true; } };
}
