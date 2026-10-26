/**
 * Background header sync: feeds bitcoin-spv from its checkpoint up to the
 * Bitcoin tip, signing each batch with the relayer key (the bitcoin-spv
 * submitter). Off by default - no-ops with a warning until BITCOIN_SPV_ID
 * and SPV_SYNC_FROM_HEIGHT are configured, so it never blocks the API.
 *
 * @stellar/stellar-sdk is required lazily (see repay-watcher/poller.ts for
 * why: its CJS build breaks ts-jest's loader).
 */
import { config } from "../config.js";
import { EsploraClient, EsploraError } from "./esplora.js";
import { syncHeaders, syncStartHeight, withBackoff } from "./header-sync.js";
import { withAccountLock } from "../account-lock.js";

const MAX_HEADERS_PER_SUBMIT = 16;

// Each header costs two Esplora calls (hash at height, then the header). A
// short gap between them, plus backoff on 429, keeps a long catch-up sync
// under public Esplora rate limits instead of failing every pass.
const HEADER_FETCH_GAP_MS = 250;
const isRateLimited = (e: unknown) => e instanceof EsploraError && e.status === 429;

export function startHeaderSync(): { stop: () => void } {
  if (!config.bitcoinSpvId || !config.spvSyncFromHeight || !config.relayerSecret) {
    console.warn("[spv-sync] BITCOIN_SPV_ID, SPV_SYNC_FROM_HEIGHT and RELAYER_SECRET are required - header sync disabled");
    return { stop: () => {} };
  }

  const esplora = new EsploraClient(config.esploraBaseUrl, config.requestTimeoutMs);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const tip = await esplora.getTipHeight();
      // Resume near the contract's own tip; restarting from the configured
      // height every pass would resubmit the whole chain since the checkpoint.
      const from = syncStartHeight(config.spvSyncFromHeight!, await readContractTipHeight());
      const result = await syncHeaders(from, tip, MAX_HEADERS_PER_SUBMIT, {
        getHeaderHex: async (h) => {
          await new Promise((r) => setTimeout(r, HEADER_FETCH_GAP_MS));
          const hash = await withBackoff(() => esplora.getBlockHashAtHeight(h), isRateLimited);
          return (await withBackoff(() => esplora.getBlockHeader(hash), isRateLimited)).trim();
        },
        submitHeaders: (headers) => submitHeadersOnChain(headers),
      });
      if (result.submittedThrough !== null) console.log(`[spv-sync] submitted through height ${result.submittedThrough}`);
    } catch (e) {
      console.error("[spv-sync] sync failed, will retry:", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, config.spvSyncIntervalMs);
  void tick();
  return { stop: () => clearInterval(timer) };
}

/** bitcoin-spv's best-tip height, or undefined when it has none or the read fails. */
async function readContractTipHeight(): Promise<number | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see top-of-file comment.
  const sdk = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  const { Keypair, Contract, TransactionBuilder, scValToNative, rpc } = sdk;
  try {
    const server = new rpc.Server(config.stellarRpcUrl, { allowHttp: config.stellarRpcUrl.startsWith("http://") });
    const account = await server.getAccount(Keypair.fromSecret(config.relayerSecret!).publicKey());
    const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase: config.networkPassphrase })
      .addOperation(new Contract(config.bitcoinSpvId).call("get_best_tip"))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim) || !sim.result) return undefined;
    const tip = scValToNative(sim.result.retval) as { height?: number } | undefined;
    return tip?.height;
  } catch {
    return undefined;
  }
}

async function submitHeadersOnChain(headersHex: string[]): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see top-of-file comment.
  const sdk = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  const { Keypair } = sdk;

  const keypair = Keypair.fromSecret(config.relayerSecret!);
  // The repay watcher publishes releases from this same account. Holding the
  // account's lock from getAccount to confirmation keeps this batch from
  // reusing the sequence number of a pending publish and, with its higher
  // bid, evicting it from the queue (see account-lock.ts).
  await withAccountLock(keypair.publicKey(), () => sendHeaders(sdk, keypair, headersHex));
}

async function sendHeaders(
  sdk: typeof import("@stellar/stellar-sdk"),
  keypair: import("@stellar/stellar-sdk").Keypair,
  headersHex: string[],
): Promise<void> {
  const { Contract, TransactionBuilder, nativeToScVal, rpc } = sdk;
  const server = new rpc.Server(config.stellarRpcUrl, { allowHttp: config.stellarRpcUrl.startsWith("http://") });
  const account = await server.getAccount(keypair.publicKey());
  const headersVal = nativeToScVal(headersHex.map((h) => Buffer.from(h, "hex")));
  const tx = new TransactionBuilder(account, { fee: "1000000", networkPassphrase: config.networkPassphrase })
    .addOperation(new Contract(config.bitcoinSpvId).call("submit_headers", headersVal))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`submit_headers simulation failed: ${JSON.stringify(sim.error)}`);
  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(keypair);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error(`submit_headers rejected: ${JSON.stringify(sent.errorResult)}`);
  for (let i = 0; i < 60; i++) {
    const res = await server.getTransaction(sent.hash);
    if (res.status === "SUCCESS") return;
    if (res.status === "FAILED") throw new Error(`submit_headers failed: ${sent.hash}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`submit_headers timed out: ${sent.hash}`);
}

