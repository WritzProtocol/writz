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
import { EsploraClient } from "./esplora.js";
import { syncHeaders } from "./header-sync.js";

const MAX_HEADERS_PER_SUBMIT = 16;

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
      const from = config.spvSyncFromHeight!;
      const result = await syncHeaders(from, tip, MAX_HEADERS_PER_SUBMIT, {
        getHeaderHex: async (h) => (await esplora.getBlockHeader(await esplora.getBlockHashAtHeight(h))).trim(),
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

async function submitHeadersOnChain(headersHex: string[]): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see top-of-file comment.
  const sdk = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  const { Keypair, Contract, TransactionBuilder, Address, nativeToScVal, rpc } = sdk;

  const keypair = Keypair.fromSecret(config.relayerSecret!);
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

