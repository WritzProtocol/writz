import express from "express";
import { config } from "./config.js";
import { proofRouter } from "./routes/proof.js";

const app = express();

app.use(express.json());

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
