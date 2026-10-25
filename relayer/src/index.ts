import express from "express";
import { config } from "./config.js";
import { proofRouter } from "./routes/proof.js";
import { createDepositStatusRouter } from "./routes/deposit-status.js";
import { merkleRouter } from "./routes/merkle.js";
import { defindexRouter } from "./routes/defindex.js";
import { metricsRouter } from "./routes/metrics.js";
import { vaultMetricsSnapshot } from "./defindex/metrics.js";
import { startRepayWatcher } from "./repay-watcher/poller.js";
import { startVaultWatcher } from "./vault-watcher/poller.js";
import { startHeaderSync } from "./bitcoin/spv-submit.js";
import { lendingEnabled } from "./deploy-target.js";
import { startTreeWatcher, treeSyncStatus } from "./tree-watcher/poller.js";
import { startZkKeeper } from "./zk-keeper/runner.js";
import { createFaucetRouter } from "./routes/faucet.js";
import { faucetFromConfig } from "./faucet/from-config.js";
import { createCctpRouter } from "./routes/cctp.js";
import { cctpRelayFromConfig } from "./cctp/from-config.js";

const app = express();
// Earn routes and the vault watcher run everywhere; the lending surface (SPV
// proofs, the commitment tree, header sync, auto-cosign) only where lending
// is enabled - not on mainnet, which is Earn-only (#122).
const LENDING = lendingEnabled(config.target);
// The Signet faucet exists only where the Bitcoin side is Signet, never on
// the mainnet target. Without FAUCET_SIGNET_WIF it answers 503 faucet_disabled.
const FAUCET = LENDING && config.bitcoinNetwork === "signet";
// The CCTP relay mints on Base Sepolia, a test network, so it belongs with the
// testnet lending surface. Without CCTP_RELAY_EVM_KEY it answers 503 cctp_relay_disabled.
const CCTP_RELAY = LENDING;

// Railway's edge is the one proxy in front of this service. Trusting exactly
// that many hops makes `req.ip` the address the edge saw, the right-most
// X-Forwarded-For entry, so a caller cannot pick its own rate-limit bucket by
// sending the header itself. TRUST_PROXY_HOPS=0 turns this off.
app.set("trust proxy", config.trustProxyHops);

app.use(express.json());

// CORS - allow configured origins (or all origins when CORS_ORIGIN="*").
app.use((req, res, next) => {
  const origin = req.headers["origin"];
  const allowed = config.corsOrigin;
  if (allowed === "*" || (origin && allowed.split(",").map((s) => s.trim()).includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin ?? "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Nothing this API returns is cacheable, and the failure modes of a cache in
// front of it are silent rather than loud.
//
// The read routes (`/defindex/apy`, `/defindex/position`, `/merkle/*`) are live
// state: a stale hit shows a balance or an APY that is no longer true, with no
// error anywhere, which defeats the point of reading them live at all. The
// transaction-building routes are worse - a built envelope carries the source
// account's sequence number, so a replayed cache hit produces a transaction the
// network rejects for a reason that points nowhere near the cache.
//
// Express sends an ETag but no cache directives, which leaves the decision to
// whatever sits in front. Stating it here removes that discretion from every
// intermediary at once: CDNs, reverse proxies and browsers alike.
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// Service index. Opening the bare origin in a browser is the first thing
// anyone does with a new deployment, and answering `{"error":"not_found"}`
// makes a working service look broken. Listing the routes also means the
// health check and the API surface are discoverable without the repo, which
// matters when the person checking is on call rather than on the team.
//
// A redirect to /health would answer "is it up" but not "what is this", and it
// would answer the first question twice, since /health is one curl away and
// listed below.
app.get("/", (_req, res) => {
  res.json({
    service: "writz-relayer",
    target: config.target,
    docs: "https://docs.writz.xyz",
    endpoints: {
      health: "GET /health",
      ...(LENDING
        ? {
            spvProof: "GET /spv-proof/:txid",
            depositStatus: "GET /deposit-status/:txid",
            merklePath: "GET /merkle-path",
            notes: "GET /notes",
            insertCommitment: "POST /insert-commitment",
            updateLeaf: "POST /update-leaf",
          }
        : {}),
      ...(FAUCET ? { signetFaucet: "GET /faucet/signet", signetFaucetClaim: "POST /faucet/signet" } : {}),
      ...(CCTP_RELAY
        ? {
            cctpRelay: "GET /cctp/relay",
            cctpRelayStart: "POST /cctp/relay",
            cctpRelayTransfer: "GET /cctp/relay/:burnHash",
          }
        : {}),
      defindexApy: "GET /defindex/apy",
      defindexPosition: "GET /defindex/position?address=G...",
      defindexDeposit: "POST /defindex/deposit",
      defindexWithdraw: "POST /defindex/withdraw",
      metricsTvl: "GET /metrics/tvl",
      metricsRetention: "GET /metrics/retention",
    },
  });
});

// Health check - used by monitors and load balancers. `target` is reported so
// that "is testnet.writz.xyz actually talking to the testnet relayer?" is a
// question one curl answers, rather than an inference from a dashboard.
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "writz-relayer",
    target: config.target,
    lending: LENDING,
    ...(LENDING ? { treeSync: treeSyncStatus } : {}),
    bitcoinNetwork: config.bitcoinNetwork,
    esploraBaseUrl: config.esploraBaseUrl,
    defindex: vaultMetricsSnapshot(),
  });
});

if (LENDING) {
  app.use("/spv-proof", proofRouter);
  const depositStatus = createDepositStatusRouter();
  app.use("/deposit-status", depositStatus);
  void depositStatus.warm();
  app.use("/", merkleRouter);
}
app.use("/defindex", defindexRouter);
app.use("/metrics", metricsRouter);
if (FAUCET) {
  const { faucet, disabledReason } = faucetFromConfig();
  app.use(
    "/faucet",
    createFaucetRouter({
      faucet,
      disabledReason,
      rateLimit: config.faucet.rateLimit,
      rateWindowMs: config.faucet.rateWindowMs,
    }),
  );
  console.log(faucet ? `Signet faucet: ${faucet.address}` : `Signet faucet off: ${disabledReason}`);
}
if (CCTP_RELAY) {
  const { relay, disabledReason } = cctpRelayFromConfig();
  app.use(
    "/cctp",
    createCctpRouter({
      relay,
      disabledReason,
      rateLimit: config.cctpRelay.rateLimit,
      rateWindowMs: config.cctpRelay.rateWindowMs,
    }),
  );
  if (relay) {
    // Transfers a previous process left in flight carry on without waiting for the app to ask again.
    const resumed = relay.resume();
    console.log(`CCTP relay: ${relay.address} (Base Sepolia), ${resumed} transfer(s) resumed`);
  } else {
    console.log(`CCTP relay off: ${disabledReason}`);
  }
}

// 404 fallback.
app.use((_req, res) => {
  res.status(404).json({ error: "not_found" });
});

app.listen(config.port, () => {
  console.log(`Writz relayer running on port ${config.port}`);
  console.log(`Deploy target: ${config.target}`);
  console.log(`Bitcoin network: ${config.bitcoinNetwork}`);
  console.log(`Esplora: ${config.esploraBaseUrl}`);
  console.log(`Stellar RPC: ${config.stellarRpcUrl}`);
});

// Auto-cosign repay watcher - no-ops with a warning if its
// required config isn't set, so this never blocks the HTTP API from starting.
if (LENDING) startRepayWatcher();

// DeFindex vault event watcher (#114) - no-ops with a warning until #102
// deploys the vault and DEFINDEX_VAULT_ID is configured.
startVaultWatcher();

// bitcoin-spv header sync - no-ops until BITCOIN_SPV_ID and SPV_SYNC_FROM_HEIGHT are set.
if (LENDING) startHeaderSync();

// Follows commitment-tree events so the leaf store never depends on a client
// calling /update-leaf (GHSA-vwvv-3255-783f).
if (LENDING) startTreeWatcher();

// ZK keeper (#212): liquidates undercollateralized commitment-tree positions
// from the keeper notes the tree watcher collects. Off unless its keys are set.
if (LENDING) startZkKeeper();
