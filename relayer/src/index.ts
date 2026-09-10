import express from "express";
import { config } from "./config.js";
import { proofRouter } from "./routes/proof.js";
import { merkleRouter } from "./routes/merkle.js";
import { defindexRouter } from "./routes/defindex.js";
import { startRepayWatcher } from "./repay-watcher/poller.js";
import { startVaultWatcher } from "./vault-watcher/poller.js";

const app = express();

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
      spvProof: "GET /spv-proof/:txid",
      merklePath: "GET /merkle-path",
      notes: "GET /notes",
      insertCommitment: "POST /insert-commitment",
      updateLeaf: "POST /update-leaf",
      defindexApy: "GET /defindex/apy",
      defindexPosition: "GET /defindex/position?address=G...",
      defindexDeposit: "POST /defindex/deposit",
      defindexWithdraw: "POST /defindex/withdraw",
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
    bitcoinNetwork: config.bitcoinNetwork,
    esploraBaseUrl: config.esploraBaseUrl,
  });
});

app.use("/spv-proof", proofRouter);
app.use("/", merkleRouter);
app.use("/defindex", defindexRouter);

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
startRepayWatcher();

// DeFindex vault event watcher (#114) - no-ops with a warning until #102
// deploys the vault and DEFINDEX_VAULT_ID is configured.
startVaultWatcher();
