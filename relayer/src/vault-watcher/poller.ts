/**
 * Vault-watcher poller.
 *
 * Polls Soroban RPC for `deposit` / `withdraw` events on the Writz-owned
 * DeFindex vault contract from a persisted cursor (never from "now" - see
 * cursor-store.ts), and persists each matching event via
 * `insertVaultEvent` (event-store.ts) so #115 (TVL + unique depositors) and
 * #116 (30-day retention cohorts) have raw data to aggregate.
 *
 * Structurally a copy of `../repay-watcher/poller.ts`'s batch/cursor control
 * flow (same at-least-once, retry-until-success semantics - a batch's
 * cursor is only persisted once every event in it has been handled, and
 * `insertVaultEvent` is idempotent so a retried batch never double-counts).
 * The difference is what "handling" an event means: the repay watcher
 * reacts to one event kind by co-signing a release; this watcher just
 * records two event kinds for later aggregation, so there is no equivalent
 * of `handleRepayFull`'s cross-chain side effects here.
 *
 * BLOCKED on #102 (vault not deployed yet) - `config.defindexVaultId` is
 * unset until then, so `startVaultWatcher` no-ops. Not blocked on event
 * shape: `DEPOSIT_TOPIC`/`WITHDRAW_TOPIC` and `decodeVaultEvent` below are
 * taken directly from the DeFindex vault contract's own source
 * (`emit_deposit_event` / `emit_withdraw_event` in
 * github.com/paltalabs/defindex, apps/contracts/vault/src/events.rs) -
 * that contract is DeFindex's, already deployed and audited, so its event
 * names and payload shape are fixed and not something either side of this
 * integration gets to choose. `#103` only needs to give us the deployed
 * vault's contract ID.
 *
 * Deliberately does not statically import `@stellar/stellar-sdk` at module
 * scope, for the same CJS/ESM interop reason documented at the top of
 * `../repay-watcher/poller.ts`.
 */
import { readCursor, writeCursor } from "./cursor-store.js";
import { insertVaultEvent, type VaultEventKind } from "./event-store.js";

// Every DeFindex vault event's first topic is the fixed contract tag
// `symbol_short!("DeFindexVault")`; the second topic is the event kind.
const CONTRACT_TAG = "DeFindexVault";
const DEPOSIT_TOPIC = "deposit";
const WITHDRAW_TOPIC = "withdraw";

/** The subset of `rpc.Server` the poll cycle actually needs - narrowed so
 * tests can pass a plain mock object instead of a real RPC server. */
export interface EventsServer {
  getEvents(
    request:
      | { filters: { type: "contract"; contractIds: string[] }[]; cursor: string }
      | { filters: { type: "contract"; contractIds: string[] }[]; startLedger: number },
  ): Promise<{
    events: {
      topic: unknown[];
      value: unknown;
      ledger: number;
      ledgerClosedAt: string;
      txHash: string;
    }[];
    cursor: string;
  }>;
  getLatestLedger(): Promise<{ sequence: number }>;
}

export interface DecodedVaultEvent {
  kind: VaultEventKind | undefined;
  depositor: string | undefined;
  amountStroops: string | undefined;
}

/**
 * Decodes an event's topic + value into `{kind, depositor, amountStroops}`
 * (all `undefined` if the shape doesn't match a deposit/withdraw event).
 * Isolated as its own function - and injectable via
 * `PollCycleDeps.decodeEvent` - so `runVaultPollCycle`'s batch/cursor
 * control flow can be unit tested with plain mock objects, independent of
 * the Soroban SDK's real XDR decoding.
 *
 * Matches `VaultDepositEvent` / `VaultWithdrawEvent` in DeFindex's own
 * `events.rs` (see top-of-file comment for the source). The vault supports
 * multiple underlying assets per pool, so `amounts` / `amounts_withdrawn`
 * is a `Vec<i128>` even though Writz's vault holds only USDC - summed here
 * rather than indexed, so this doesn't silently drop a second asset if the
 * vault's composition ever changes. `amount` fields are `i128`, decoded by
 * `scValToNative` as `bigint`.
 */
export function decodeVaultEvent(event: { topic: unknown[]; value: unknown }): DecodedVaultEvent {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { scValToNative } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  const contractTag = event.topic[0] ? (scValToNative(event.topic[0] as never) as string) : undefined;
  const eventTag = event.topic[1] ? (scValToNative(event.topic[1] as never) as string) : undefined;
  if (contractTag !== CONTRACT_TAG) {
    return { kind: undefined, depositor: undefined, amountStroops: undefined };
  }
  const kind: VaultEventKind | undefined =
    eventTag === DEPOSIT_TOPIC ? "deposit" : eventTag === WITHDRAW_TOPIC ? "withdraw" : undefined;
  if (!kind) return { kind: undefined, depositor: undefined, amountStroops: undefined };

  const native = scValToNative(event.value as never) as {
    depositor?: string;
    withdrawer?: string;
    amounts?: bigint[];
    amounts_withdrawn?: bigint[];
  };
  const depositor = kind === "deposit" ? native.depositor : native.withdrawer;
  const amounts = (kind === "deposit" ? native.amounts : native.amounts_withdrawn) ?? [];
  const total = amounts.reduce((sum, a) => sum + a, 0n);

  return { kind, depositor, amountStroops: depositor ? total.toString() : undefined };
}

export interface PollCycleDeps {
  server: EventsServer;
  contractId: string;
  /** Defaults to `decodeVaultEvent`. Override in tests to avoid needing
   * real Soroban XDR ScVal objects in fixtures. */
  decodeEvent?: (event: { topic: unknown[]; value: unknown }) => DecodedVaultEvent;
  /** Defaults to `insertVaultEvent`. Override in tests to assert on calls
   * without touching a real sqlite file. */
  persist?: (event: Parameters<typeof insertVaultEvent>[0]) => void;
}

/**
 * Runs a single poll cycle: fetch events since the persisted cursor,
 * persist matching `deposit`/`withdraw` events, and persist the new cursor
 * only if every event in the batch was handled without error.
 *
 * Exported (separately from `startVaultWatcher`) so it can be unit tested
 * against a mocked `EventsServer`, without needing a real Soroban RPC
 * connection.
 */
export async function runVaultPollCycle(deps: PollCycleDeps): Promise<void> {
  const decodeEvent = deps.decodeEvent ?? decodeVaultEvent;
  const persist = deps.persist ?? insertVaultEvent;
  const filters = [{ type: "contract" as const, contractIds: [deps.contractId] }];
  const persistedCursor = readCursor();

  const response = persistedCursor
    ? await deps.server.getEvents({ filters, cursor: persistedCursor })
    : await deps.server.getEvents({
        filters,
        // First run ever: start from the current tip, not a historical
        // backfill. Unlike repay-watcher (see its own poller.ts comment and
        // docs/developers/relayer-backfill-runbook.md), a gap here only
        // undercounts metrics - no funds are at risk - so there's no
        // dedicated runbook. Recovery is simple and doesn't need one:
        // `insertVaultEvent` is idempotent (UNIQUE on tx_hash/depositor/
        // kind/amount), so re-running `runVaultPollCycle` with the cursor
        // manually rewound to an earlier ledger (via `writeCursor`, or a
        // fresh `getEvents({ filters, startLedger })` call) safely re-scans
        // and fills the gap without double-counting anything already
        // persisted.
        startLedger: (await deps.server.getLatestLedger()).sequence,
      });

  let sawFailure = false;
  for (const event of response.events) {
    const { kind, depositor, amountStroops } = decodeEvent(event);
    if (!kind || !depositor || amountStroops === undefined) continue;

    try {
      persist({
        cursor: response.cursor,
        kind,
        depositor,
        amountStroops,
        ledger: event.ledger,
        txHash: event.txHash,
        ledgerCloseTime: Math.floor(new Date(event.ledgerClosedAt).getTime() / 1000),
      });
    } catch (e) {
      sawFailure = true;
      console.error(
        `[vault-watcher] failed to persist ${kind} event for ${depositor}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  if (!sawFailure) {
    writeCursor(response.cursor);
  }
}

export interface VaultWatcherHandle {
  stop: () => void;
}

/**
 * Starts the vault watcher's polling loop against real Soroban RPC. Returns
 * a handle to stop it.
 *
 * No-op (with a warning) if `DEFINDEX_VAULT_ID` isn't configured, so a
 * relayer deployment started before the vault exists (#102) doesn't crash
 * on startup - the rest of the relayer's HTTP API remains fully functional.
 */
export function startVaultWatcher(): VaultWatcherHandle {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see top-of-file comment: deliberately deferred to avoid the CJS/ESM interop crash under ts-jest.
  const { config } = require("../config.js") as typeof import("../config.js");

  if (!config.defindexVaultId) {
    console.warn("[vault-watcher] DEFINDEX_VAULT_ID not configured - vault watcher disabled");
    return { stop: () => {} };
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see top-of-file comment: deliberately deferred to avoid the CJS/ESM interop crash under ts-jest.
  const { rpc } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");

  const server = new rpc.Server(config.stellarRpcUrl, {
    allowHttp: config.stellarRpcUrl.startsWith("http://"),
  });

  let stopped = false;

  async function loop(): Promise<void> {
    while (!stopped) {
      try {
        await runVaultPollCycle({ server, contractId: config.defindexVaultId! });
      } catch (e) {
        console.error("[vault-watcher] poll failed:", e instanceof Error ? e.message : e);
      }
      if (stopped) break;
      await new Promise((resolve) => setTimeout(resolve, config.vaultWatcherPollIntervalMs));
    }
  }

  void loop();

  return {
    stop: () => {
      stopped = true;
    },
  };
}
