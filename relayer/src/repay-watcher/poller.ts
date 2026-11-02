/**
 * Repay-watcher poller.
 *
 * Two steps, run in turn. `runPollCycle` reads `repay_full` events on
 * `writz-lend` from a persisted cursor, and records each one as a pending
 * release in the same transaction that advances the cursor. `runReleaseSweep`
 * then publishes what is pending, with backoff on failure. Recording and
 * publishing are separate so that one release that keeps failing never holds
 * the cursor for the repayments behind it (see release-store.ts).
 *
 * The watcher never starts from the chain tip. A store with no cursor starts
 * from `WRITZ_LEND_DEPLOY_LEDGER`, because starting from "now" would silently
 * skip every repayment made while the database was gone.
 *
 * `runPollCycle` and `decodeRepayFullEvent` deliberately do not statically
 * import `@stellar/stellar-sdk`, `@writz/bitcoin-script`, or `./handler.js`
 * at module scope - those are lazily `require()`'d inside `decodeRepayFullEvent`
 * and `startRepayWatcher` instead. `@stellar/stellar-sdk`'s CJS build
 * `require()`s an ESM-only `@noble/hashes` file, which Node's (and ts-jest's)
 * strict CJS loader cannot execute; Bun's runtime tolerates it, but the
 * relayer's Jest suite runs under ts-jest's CommonJS transform and does not.
 * Deferring the import keeps this file - and its unit-testable control flow
 * in particular - loadable under Jest without needing to fix that
 * interop gap in the test toolchain.
 */
import { MAX_RELEASE_ATTEMPTS, releaseStore, type ReleaseStore, type ReleaseSummary } from "./release-store.js";
import { withBackoff } from "../bitcoin/header-sync.js";

const REPAY_FULL_TOPIC = "repay_full";

/** The subset of `rpc.Server` the poll cycle actually needs - narrowed so
 * tests can pass a plain mock object instead of a real RPC server. */
export interface EventsServer {
  getEvents(
    request:
      | { filters: { type: "contract"; contractIds: string[] }[]; cursor: string }
      | { filters: { type: "contract"; contractIds: string[] }[]; startLedger: number },
  ): Promise<{ events: { topic: unknown[]; cursor?: string }[]; cursor: string }>;
}

/**
 * Decodes an event's topics into `{topic0, txid}` (both `undefined` if the
 * shape doesn't match what a `repay_full` event looks like). Isolated as
 * its own function - and injectable via `PollCycleDeps.decodeEvent` - so
 * `runPollCycle`'s batch/cursor control flow can be unit tested with plain
 * mock objects, independent of the Soroban SDK's real XDR decoding.
 */
export function decodeRepayFullEvent(event: {
  topic: unknown[];
}): { topic0: string | undefined; txid: Buffer | undefined } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { scValToNative } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  const topic0 = event.topic[0] ? (scValToNative(event.topic[0] as never) as string) : undefined;
  const txidTopic = event.topic[1];
  const txid = txidTopic
    ? Buffer.from(scValToNative(txidTopic as never) as Uint8Array)
    : undefined;
  return { topic0, txid };
}

export interface PollCycleDeps {
  server: EventsServer;
  contractId: string;
  store: ReleaseStore;
  /** Where a store with no cursor starts. Required only in that case. */
  deployLedger: number | undefined;
  /** Defaults to `decodeRepayFullEvent`. Override in tests to avoid
   * needing real Soroban XDR ScVal objects in fixtures. */
  decodeEvent?: (event: { topic: unknown[] }) => { topic0: string | undefined; txid: Buffer | undefined };
  now?: () => number;
}

/**
 * Runs a single poll cycle: fetch events since the persisted cursor, and
 * record every `repay_full` together with the new cursor. A failed read or
 * write leaves the cursor in place, so nothing is skipped.
 *
 * Exported (separately from `startRepayWatcher`) so it can be unit tested
 * against a mocked `EventsServer`, without needing a real Soroban RPC
 * connection or AWS credentials.
 */
export async function runPollCycle(deps: PollCycleDeps): Promise<void> {
  const { server, contractId, store, deployLedger } = deps;
  const decodeEvent = deps.decodeEvent ?? decodeRepayFullEvent;
  const now = deps.now ?? Date.now;
  const filters = [{ type: "contract" as const, contractIds: [contractId] }];
  const persistedCursor = store.readCursor();
  if (!persistedCursor && deployLedger === undefined) {
    throw new Error("no cursor and WRITZ_LEND_DEPLOY_LEDGER is not set, so the watcher cannot start");
  }

  const response = persistedCursor
    ? await server.getEvents({ filters, cursor: persistedCursor })
    : await server.getEvents({ filters, startLedger: deployLedger! });

  const repaid: string[] = [];
  for (const event of response.events) {
    const { topic0, txid } = decodeEvent(event);
    if (topic0 === REPAY_FULL_TOPIC && txid) repaid.push(txid.toString("hex"));
  }
  store.recordBatch(contractId, repaid, response.cursor, now());
}

export interface ReleaseSweepDeps {
  store: ReleaseStore;
  contractId: string;
  publish: (txid: Buffer) => Promise<void>;
  /** Whether the contract shows the release. A row is removed only on true. */
  isPublished: (txid: Buffer) => Promise<boolean>;
  now?: () => number;
}

/**
 * Publishes the releases that are due. A failure is recorded on its own row
 * and the sweep moves on, so one position never holds up another.
 */
export async function runReleaseSweep(deps: ReleaseSweepDeps): Promise<void> {
  const { store, contractId, publish, isPublished } = deps;
  const now = deps.now ?? Date.now;
  for (const row of store.due(contractId, now())) {
    const txid = Buffer.from(row.txid, "hex");
    try {
      await publish(txid);
      if (!(await isPublished(txid))) throw new Error("published, but the release is not visible on chain yet");
      store.remove(contractId, row.txid);
      console.log(`[repay-watcher] published release PSBT for ${row.txid}`);
    } catch (e) {
      const message = e instanceof Error ? e.message.split("\n")[0]! : String(e);
      store.markFailed(contractId, row.txid, message, now());
      const stuck = row.attempts + 1 >= MAX_RELEASE_ATTEMPTS;
      console.error(
        `[repay-watcher] ${stuck ? "giving up on" : "failed to publish"} release for ${row.txid}: ${message}`,
      );
    }
  }
}

/**
 * Retries a failed release publish within seconds instead of waiting for the
 * next poll: 2 s, then 4 s, three attempts in all. Each attempt runs the whole
 * handler again, so it re-checks `get_release_psbt` first (nothing is
 * published twice) and builds the transaction from a fresh sequence number.
 * Every error is retried: the handler's deterministic failures (an unknown
 * position, a script mismatch) cost two quick extra reads, and the poll cycle
 * retries the row later, from its backoff, if the last attempt fails.
 */
export const PUBLISH_RETRIES = 2;
export const PUBLISH_RETRY_BASE_DELAY_MS = 2_000;

export function withPromptRetry(
  handle: (txid: Buffer) => Promise<void>,
  {
    retries = PUBLISH_RETRIES,
    baseDelayMs = PUBLISH_RETRY_BASE_DELAY_MS,
    sleep,
  }: { retries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): (txid: Buffer) => Promise<void> {
  return (txid) => {
    let attempt = 0;
    return withBackoff(
      async () => {
        attempt++;
        try {
          return await handle(txid);
        } catch (e) {
          if (attempt <= retries) {
            console.warn(
              `[repay-watcher] attempt ${attempt} for ${txid.toString("hex")} failed, retrying:`,
              e instanceof Error ? e.message.split("\n")[0] : e,
            );
          }
          throw e;
        }
      },
      () => true,
      { retries, baseDelayMs, ...(sleep ? { sleep } : {}) },
    );
  };
}

/** The watcher's last poll failure, for /health. */
let lastError: string | null = null;

/** What /health reports. */
export function releaseStatus(contractId: string): ReleaseSummary & { lastError: string | null } {
  return { ...releaseStore().summary(contractId), lastError };
}

export interface RepayWatcherHandle {
  stop: () => void;
}

/**
 * Starts the repay watcher's polling loop against real Soroban RPC / KMS /
 * Esplora clients built from `config`. Returns a handle to stop it.
 *
 * No-op (with a warning) if the required configuration isn't present, so a
 * relayer deployment that hasn't configured the watcher yet doesn't crash on
 * startup - the rest of the relayer's HTTP API remains fully functional.
 */
export function startRepayWatcher(): RepayWatcherHandle {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see top-of-file comment: deliberately deferred to avoid the CJS/ESM interop crash under ts-jest.
  const { config } = require("../config.js") as typeof import("../config.js");

  const hasSignerConfig = Boolean(config.kmsKeyId || config.protocolSigningKeyWif);
  if (!config.writzLendId || !config.relayerSecret || !hasSignerConfig) {
    console.warn(
      "[repay-watcher] WRITZ_LEND_ID / RELAYER_SECRET / (KMS_KEY_ID or " +
        "PROTOCOL_SIGNING_KEY) not fully configured - auto-cosign watcher disabled",
    );
    return { stop: () => {} };
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see top-of-file comment: deliberately deferred to avoid the CJS/ESM interop crash under ts-jest.
  const { Keypair, rpc } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see top-of-file comment: deliberately deferred to avoid the CJS/ESM interop crash under ts-jest.
  const { resolveProtocolSigner } = require("@writz/bitcoin-script") as typeof import("@writz/bitcoin-script");
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see top-of-file comment: deliberately deferred to avoid the CJS/ESM interop crash under ts-jest.
  const { EsploraClient } = require("../bitcoin/esplora.js") as typeof import("../bitcoin/esplora.js");
  const { getBitcoinNetwork, handleRepayFull, isReleasePublished } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see top-of-file comment: deliberately deferred to avoid the CJS/ESM interop crash under ts-jest.
    require("./handler.js") as typeof import("./handler.js");

  const server = new rpc.Server(config.stellarRpcUrl, {
    allowHttp: config.stellarRpcUrl.startsWith("http://"),
  });
  const esplora = new EsploraClient(config.esploraBaseUrl, config.requestTimeoutMs);
  const relayerKeypair = Keypair.fromSecret(config.relayerSecret);
  const network = getBitcoinNetwork();

  // Derived from `resolveProtocolSigner`'s return type rather than a named
  // exported type, to stay consistent with the dynamic `typeof import(...)`
  // pattern used throughout this function.
  let signer: Awaited<ReturnType<typeof resolveProtocolSigner>> | undefined;
  let stopped = false;

  async function loop(): Promise<void> {
    while (!stopped) {
      try {
        if (!signer) {
          signer = await resolveProtocolSigner({
            kmsKeyId: config.kmsKeyId,
            envPrivateKeyWif: config.protocolSigningKeyWif,
            network,
          });
        }
        await runPollCycle({
          server,
          contractId: config.writzLendId,
          store: releaseStore(),
          deployLedger: config.writzLendDeployLedger,
        });
        lastError = null;
        await runReleaseSweep({
          store: releaseStore(),
          contractId: config.writzLendId,
          publish: withPromptRetry((txid) => handleRepayFull(txid, { esplora, signer: signer!, relayerKeypair })),
          isPublished: isReleasePublished,
        });
      } catch (e) {
        lastError = e instanceof Error ? e.message.split("\n")[0]! : String(e);
        console.error("[repay-watcher] poll failed:", e instanceof Error ? e.message : e);
      }
      if (stopped) break;
      await new Promise((resolve) => setTimeout(resolve, config.repayWatcherPollIntervalMs));
    }
  }

  void loop();

  return {
    stop: () => {
      stopped = true;
    },
  };
}
