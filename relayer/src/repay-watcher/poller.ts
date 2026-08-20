/**
 * Repay-watcher poller.
 *
 * Polls Soroban RPC for `repay_full` events on the `private-lend` contract
 * from a persisted cursor (never from "now" - see cursor-store.ts), and
 * hands each matching event to a handler function.
 *
 * A batch's cursor is only persisted once every event in that batch has
 * been handled successfully. If any event fails, the cursor is left
 * unadvanced so the whole batch (including already-handled events, which
 * `handleRepayFull` treats idempotently) is retried on the next poll -
 * this gives at-least-once, retry-until-success delivery per event rather
 * than silently skipping a transient failure.
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
import { readCursor, writeCursor } from "./cursor-store.js";

const REPAY_FULL_TOPIC = "repay_full";

/** The subset of `rpc.Server` the poll cycle actually needs - narrowed so
 * tests can pass a plain mock object instead of a real RPC server. */
export interface EventsServer {
  getEvents(
    request:
      | { filters: { type: "contract"; contractIds: string[] }[]; cursor: string }
      | { filters: { type: "contract"; contractIds: string[] }[]; startLedger: number },
  ): Promise<{ events: { topic: unknown[]; cursor?: string }[]; cursor: string }>;
  getLatestLedger(): Promise<{ sequence: number }>;
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
  handle: (txid: Buffer) => Promise<void>;
  /** Defaults to `decodeRepayFullEvent`. Override in tests to avoid
   * needing real Soroban XDR ScVal objects in fixtures. */
  decodeEvent?: (event: { topic: unknown[] }) => { topic0: string | undefined; txid: Buffer | undefined };
}

/**
 * Runs a single poll cycle: fetch events since the persisted cursor, hand
 * matching `repay_full` events to `deps.handle`, and persist the new
 * cursor only if every event in the batch was handled without error.
 *
 * Exported (separately from `startRepayWatcher`) so it can be unit tested
 * against a mocked `EventsServer` and handler, without needing a real
 * Soroban RPC connection or AWS credentials.
 */
export async function runPollCycle(deps: PollCycleDeps): Promise<void> {
  const decodeEvent = deps.decodeEvent ?? decodeRepayFullEvent;
  const filters = [{ type: "contract" as const, contractIds: [deps.contractId] }];
  const persistedCursor = readCursor();

  const response = persistedCursor
    ? await deps.server.getEvents({ filters, cursor: persistedCursor })
    : await deps.server.getEvents({
        filters,
        // First run ever: start from the current tip, not a historical
        // backfill. An outage longer than Soroban RPC's retention window
        // (~days) requires a documented manual backfill.
        startLedger: (await deps.server.getLatestLedger()).sequence,
      });

  let sawFailure = false;
  for (const event of response.events) {
    const { topic0, txid } = decodeEvent(event);
    if (topic0 !== REPAY_FULL_TOPIC || !txid) continue;

    try {
      await deps.handle(txid);
      console.log(`[repay-watcher] published release PSBT for ${txid.toString("hex")}`);
    } catch (e) {
      sawFailure = true;
      console.error(
        `[repay-watcher] failed to handle repay_full for ${txid.toString("hex")}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  if (!sawFailure) {
    writeCursor(response.cursor);
  }
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
  if (!config.privateLendId || !config.relayerSecret || !hasSignerConfig) {
    console.warn(
      "[repay-watcher] PRIVATE_LEND_ID / RELAYER_SECRET / (KMS_KEY_ID or " +
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
  const { getBitcoinNetwork, handleRepayFull } =
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
          contractId: config.privateLendId,
          handle: (txid) => handleRepayFull(txid, { esplora, signer: signer!, relayerKeypair }),
        });
      } catch (e) {
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
