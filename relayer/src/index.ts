import express from "express";
import { config } from "./config.js";
import { proofRouter } from "./routes/proof.js";

const app = express();

app.use(express.json());

// CORS — allow configured origins (or all origins when CORS_ORIGIN="*").
app.use((req, res, next) => {
  const origin = req.headers["origin"];
  const allowed = config.corsOrigin;
  if (allowed === "*" || (origin && allowed.split(",").map((s) => s.trim()).includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin ?? "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// Health check — used by monitors and load balancers.
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "writz-relayer",
    bitcoinNetwork: config.bitcoinNetwork,
    esploraBaseUrl: config.esploraBaseUrl,
  });
});

app.use("/spv-proof", proofRouter);

// 404 fallback.
app.use((_req, res) => {
  res.status(404).json({ error: "not_found" });
});

app.listen(config.port, () => {
  console.log(`Writz relayer running on port ${config.port}`);
  console.log(`Bitcoin network: ${config.bitcoinNetwork}`);
  console.log(`Esplora: ${config.esploraBaseUrl}`);
});

export { app };
