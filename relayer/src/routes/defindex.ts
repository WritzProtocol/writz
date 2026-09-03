import { Router, Request, Response } from "express";
import { config } from "../config.js";
import { defindexSdk, defindexNetwork } from "../defindex/client.js";
import { mapDefindexError } from "../defindex/errors.js";

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;
const STROOP_AMOUNT_RE = /^[1-9]\d*$/;

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

/**
 * POST /defindex/deposit  { "caller": "G...", "amountStroops": "10000000" }
 * Success 200: { "xdr": "AAAAAgAAAAA..." }
 *
 * Builds an unsigned deposit transaction only - the relayer never signs or
 * submits on the caller's behalf (epic #101's custody model). The connected
 * wallet signs the returned XDR and the browser submits it to Soroban RPC.
 *
 * `amountStroops` is a decimal string of USDC stroops (7 decimals), matching
 * the frontend's wire convention (frontend/src/lib/earn/amount.ts) - a JSON
 * number above 2^53 loses precision. `invest: true` follows DeFindex's own
 * documented deposit example (docs.defindex.io: "Auto-invest into
 * strategies") so a deposit starts earning immediately instead of sitting
 * idle until a manual rebalance.
 */
defindexRouter.post("/deposit", async (req: Request, res: Response): Promise<void> => {
  const { caller, amountStroops } = req.body as { caller?: unknown; amountStroops?: unknown };
  if (typeof caller !== "string" || !STELLAR_ADDRESS_RE.test(caller)) {
    res.status(400).json({ error: "caller must be a Stellar G... public key" });
    return;
  }
  if (typeof amountStroops !== "string" || !STROOP_AMOUNT_RE.test(amountStroops)) {
    res.status(400).json({ error: "amountStroops must be a positive integer string (USDC stroops)" });
    return;
  }
  if (!config.defindexVaultId) {
    res.status(500).json({ error: "DEFINDEX_VAULT_ID not configured" });
    return;
  }
  try {
    const { xdr } = await defindexSdk.depositToVault(
      config.defindexVaultId,
      { caller, amounts: [Number(amountStroops)], invest: true },
      defindexNetwork,
    );
    if (!xdr) {
      res.status(502).json({ error: "DeFindex API did not return a transaction to sign" });
      return;
    }
    res.json({ xdr });
  } catch (err) {
    const { status, error } = mapDefindexError(err);
    res.status(status).json({ error });
  }
});

/**
 * POST /defindex/withdraw  { "caller": "G...", "amountStroops": "5000000" }
 * Success 200: { "xdr": "AAAAAgAAAAA..." }
 *
 * Builds an unsigned withdraw transaction only - the relayer never signs or
 * submits on the caller's behalf (epic #101's custody model). The connected
 * wallet signs the returned XDR and the browser submits it to Soroban RPC.
 *
 * `amountStroops` is the underlying USDC amount to withdraw (7 decimals), the
 * same wire convention as `/deposit`. Passed straight through to
 * `withdrawFromVault`'s `amounts`, DeFindex's asset-amount withdrawal call -
 * a "full" withdrawal is simply an amount equal to the caller's whole
 * position, so no separate full/partial branch is needed here.
 */
defindexRouter.post("/withdraw", async (req: Request, res: Response): Promise<void> => {
  const { caller, amountStroops } = req.body as { caller?: unknown; amountStroops?: unknown };
  if (typeof caller !== "string" || !STELLAR_ADDRESS_RE.test(caller)) {
    res.status(400).json({ error: "caller must be a Stellar G... public key" });
    return;
  }
  if (typeof amountStroops !== "string" || !STROOP_AMOUNT_RE.test(amountStroops)) {
    res.status(400).json({ error: "amountStroops must be a positive integer string (USDC stroops)" });
    return;
  }
  if (!config.defindexVaultId) {
    res.status(500).json({ error: "DEFINDEX_VAULT_ID not configured" });
    return;
  }
  try {
    const { xdr } = await defindexSdk.withdrawFromVault(
      config.defindexVaultId,
      { caller, amounts: [Number(amountStroops)] },
      defindexNetwork,
    );
    if (!xdr) {
      res.status(502).json({ error: "DeFindex API did not return a transaction to sign" });
      return;
    }
    res.json({ xdr });
  } catch (err) {
    const { status, error } = mapDefindexError(err);
    res.status(status).json({ error });
  }
});
