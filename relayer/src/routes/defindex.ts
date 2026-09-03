import { Router, Request, Response } from "express";
import { config } from "../config.js";
import { defindexSdk, defindexNetwork } from "../defindex/client.js";
import { mapDefindexError } from "../defindex/errors.js";

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

export const defindexRouter = Router();

/**
 * GET /defindex/apy
 * Success 200: { "apy": 0.0731 }   (fraction: 0.0731 = 7.31%)
 *
 * DeFindex's own `GET /vault/:id/apy` returns a percentage number, not a
 * fraction - confirmed against the live testnet vault (returns e.g.
 * `{"apy":7.21}`, i.e. 7.21%) and against DeFindex's own docs
 * ("APY... expressed as a percentage", docs.defindex.io/getting-started/
 * understanding-apy). The frontend's contract for this route
 * (frontend/src/lib/earn/api.ts) commits to a fraction, matching its own
 * mock (`0.0731`), so this route divides by 100 to honor that contract
 * rather than passing DeFindex's raw value straight through.
 */
defindexRouter.get("/apy", async (_req: Request, res: Response): Promise<void> => {
  if (!config.defindexVaultId) {
    res.status(500).json({ error: "DEFINDEX_VAULT_ID not configured" });
    return;
  }
  try {
    const { apy } = await defindexSdk.getVaultAPY(config.defindexVaultId, defindexNetwork);
    res.json({ apy: apy / 100 });
  } catch (err) {
    const { status, error } = mapDefindexError(err);
    res.status(status).json({ error });
  }
});

/**
 * GET /defindex/position?address=<G...>
 * Success 200: { "dfTokens": "12500000", "underlyingStroops": "12734512" }
 *
 * Both fields are decimal strings, not JSON numbers - a stroop amount
 * above 2^53 loses precision as a double. Note: the SDK's own
 * VaultBalanceResponse types dfTokens/underlyingBalance as `number`, so
 * if DeFindex ever returns a value above that threshold as a bare JSON
 * number, precision is already lost before this code runs; stringifying
 * afterward can't recover it. Not a risk at this vault's current scale.
 */
defindexRouter.get("/position", async (req: Request, res: Response): Promise<void> => {
  const address = req.query["address"];
  if (typeof address !== "string" || !STELLAR_ADDRESS_RE.test(address)) {
    res.status(400).json({ error: "address must be a Stellar G... public key" });
    return;
  }
  if (!config.defindexVaultId) {
    res.status(500).json({ error: "DEFINDEX_VAULT_ID not configured" });
    return;
  }
  try {
    const balance = await defindexSdk.getVaultBalance(config.defindexVaultId, address, defindexNetwork);
    res.json({
      dfTokens: String(balance.dfTokens),
      underlyingStroops: String(balance.underlyingBalance[0] ?? 0),
    });
  } catch (err) {
    const { status, error } = mapDefindexError(err);
    res.status(status).json({ error });
  }
});
