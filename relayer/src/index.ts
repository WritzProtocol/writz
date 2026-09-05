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

// Health check - used by monitors and load balancers.
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "writz-relayer",
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
