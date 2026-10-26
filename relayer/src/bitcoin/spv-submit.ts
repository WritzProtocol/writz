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
import {
  assertWithinFeeCeiling,
  type ChainTip,
  FeeCeilingExceededError,
  hasNewHeaders,
  headerSyncStatus,
  internalHashToDisplayHex,
  recordRelayerBalance,
  stroopsToXlm,
  syncHeaders,
  syncStartHeight,
  withBackoff,
} from "./header-sync.js";
import { withAccountLock } from "../account-lock.js";

const MAX_HEADERS_PER_SUBMIT = 16;

// Each header costs two Esplora calls (hash at height, then the header). A
// short gap between them, plus backoff on 429, keeps a long catch-up sync
// under public Esplora rate limits instead of failing every pass.
const HEADER_FETCH_GAP_MS = 250;
const isRateLimited = (e: unknown) => e instanceof EsploraError && e.status === 429;

// The balance moves only when a transaction lands, so a read every ten
// minutes is enough for the alert and keeps RPC calls and log lines down.
const BALANCE_CHECK_INTERVAL_MS = 10 * 60_000;

export function startHeaderSync(): { stop: () => void } {
  if (!config.bitcoinSpvId || !config.spvSyncFromHeight || !config.relayerSecret) {
    console.warn("[spv-sync] BITCOIN_SPV_ID, SPV_SYNC_FROM_HEIGHT and RELAYER_SECRET are required - header sync disabled");
    return { stop: () => {} };
  }

  headerSyncStatus.enabled = true;
  headerSyncStatus.maxFeeXlm = stroopsToXlm(config.spvMaxFeeStroops);
  headerSyncStatus.minBalanceXlm = stroopsToXlm(config.relayerMinBalanceStroops);

  const esplora = new EsploraClient(config.esploraBaseUrl, config.requestTimeoutMs);
  let running = false;
  let lastBalanceCheck = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      if (Date.now() - lastBalanceCheck >= BALANCE_CHECK_INTERVAL_MS) {
        lastBalanceCheck = Date.now();
        await checkRelayerBalance();
      }

      const tipHeight = await esplora.getTipHeight();
      const bitcoinTip = { height: tipHeight, hash: (await esplora.getBlockHashAtHeight(tipHeight)).trim() };
      // A failed read throws and the pass is retried; treating it as "no tip"
      // would resubmit everything since the checkpoint.
      const contractTip = await readContractTip();
      headerSyncStatus.lastPassAt = new Date().toISOString();
      headerSyncStatus.bitcoinTipHeight = bitcoinTip.height;
      headerSyncStatus.contractTipHeight = contractTip?.height ?? null;
      if (!hasNewHeaders(bitcoinTip, contractTip)) {
        headerSyncStatus.skippedNoNewHeaders++;
        headerSyncStatus.lastError = null;
        return;
      }

      // Resume near the contract's own tip; restarting from the configured
      // height every pass would resubmit the whole chain since the checkpoint.
      const from = syncStartHeight(config.spvSyncFromHeight!, contractTip?.height);
      const result = await syncHeaders(from, bitcoinTip.height, MAX_HEADERS_PER_SUBMIT, {
        getHeaderHex: async (h) => {
          await new Promise((r) => setTimeout(r, HEADER_FETCH_GAP_MS));
          const hash = await withBackoff(() => esplora.getBlockHashAtHeight(h), isRateLimited);
          return (await withBackoff(() => esplora.getBlockHeader(hash), isRateLimited)).trim();
        },
        submitHeaders: (headers) => submitHeadersOnChain(headers),
      });
      headerSyncStatus.lastError = null;
      if (result.submittedThrough !== null) {
        headerSyncStatus.lastSubmittedThrough = result.submittedThrough;
        console.log(`[spv-sync] submitted through height ${result.submittedThrough}`);
      }
    } catch (e) {
      if (e instanceof FeeCeilingExceededError) {
        headerSyncStatus.skippedFeeCeiling++;
        headerSyncStatus.lastFeeCeilingSkip = { at: new Date().toISOString(), feeXlm: stroopsToXlm(e.feeStroops) };
        headerSyncStatus.lastError = e.message;
        console.warn(`[spv-sync] fee ceiling: ${e.message}; nothing sent, will retry next pass`);
      } else {
        headerSyncStatus.lastError = e instanceof Error ? e.message : String(e);
        console.error("[spv-sync] sync failed, will retry:", headerSyncStatus.lastError);
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, config.spvSyncIntervalMs);
  void tick();
  return { stop: () => clearInterval(timer) };
}

/**
 * Reads the relayer account's XLM balance and logs an error-level alert while
 * it is under RELAYER_MIN_BALANCE_XLM. A failed read is logged and does not
 * stop the pass: the balance is a warning, not a precondition.
 */
async function checkRelayerBalance(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see top-of-file comment.
  const { Keypair, rpc } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  try {
    const server = new rpc.Server(config.stellarRpcUrl, { allowHttp: config.stellarRpcUrl.startsWith("http://") });
    const address = Keypair.fromSecret(config.relayerSecret!).publicKey();
    const entry = await server.getAccountEntry(address);
    const balance = entry.balance().toBigInt();
    if (recordRelayerBalance(headerSyncStatus, balance, config.relayerMinBalanceStroops)) {
      console.error(
        `[spv-sync] ALERT relayer balance low: ${stroopsToXlm(balance)} XLM, under the ${stroopsToXlm(config.relayerMinBalanceStroops)} XLM threshold (RELAYER_MIN_BALANCE_XLM); top up ${address}`,
      );
    }
  } catch (e) {
    console.error("[spv-sync] relayer balance read failed:", e instanceof Error ? e.message : e);
  }
}

/** bitcoin-spv's best tip, or undefined when it has none. Throws when the read fails. */
async function readContractTip(): Promise<ChainTip | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see top-of-file comment.
  const sdk = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  const { Keypair, Contract, TransactionBuilder, scValToNative, rpc } = sdk;
  const server = new rpc.Server(config.stellarRpcUrl, { allowHttp: config.stellarRpcUrl.startsWith("http://") });
  const account = await server.getAccount(Keypair.fromSecret(config.relayerSecret!).publicKey());
  const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase: config.networkPassphrase })
    .addOperation(new Contract(config.bitcoinSpvId).call("get_best_tip"))
    .setTimeout(30)
    .build();
  // Simulation only: nothing is signed or sent, so the read is free.
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`get_best_tip simulation failed: ${sim.error}`);
  if (!sim.result) throw new Error("get_best_tip simulation returned no result");
  const tip = scValToNative(sim.result.retval) as { height?: number; hash?: Uint8Array } | null | undefined;
  if (!tip || tip.height === undefined || !tip.hash) return undefined;
  return { height: Number(tip.height), hash: internalHashToDisplayHex(tip.hash) };
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
  // The most this transaction can be charged: inclusion bid plus the simulated
  // resource fee. On 2026-10-25 a testnet rent spike made single-header calls
  // cost up to 181 XLM; past the ceiling nothing is sent and the pass retries.
  const feeStroops = BigInt(prepared.fee);
  assertWithinFeeCeiling(feeStroops, config.spvMaxFeeStroops);
  prepared.sign(keypair);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error(`submit_headers rejected: ${JSON.stringify(sent.errorResult)}`);
  for (let i = 0; i < 60; i++) {
    const res = await server.getTransaction(sent.hash);
    if (res.status === "SUCCESS") {
      headerSyncStatus.submissions++;
      headerSyncStatus.lastSubmissionAt = new Date().toISOString();
      headerSyncStatus.lastFeeXlm = stroopsToXlm(res.resultXdr.feeCharged().toBigInt());
      return;
    }
    if (res.status === "FAILED") throw new Error(`submit_headers failed: ${sent.hash}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`submit_headers timed out: ${sent.hash}`);
}

