import { Router, Request, Response } from "express";
import { EsploraClient } from "../bitcoin/esplora.js";
import {
  buildSPVProof,
  UnconfirmedTxError,
  InsufficientConfirmationsError,
} from "../bitcoin/spv.js";
import { config } from "../config.js";

const TXID_RE = /^[0-9a-f]{64}$/i;

const esplora = new EsploraClient(config.esploraBaseUrl, config.requestTimeoutMs);

export const proofRouter = Router();

/**
 * GET /spv-proof/:txid
 *
 * Returns a complete SPV proof bundle ready for submission to the
 * Writz `bitcoin-spv` Soroban contract.
 *
 * Query parameters:
 *   confirmations (optional, integer ≥ 1, default: 6, max: 20)
 *
 * Success 200:
 * ```json
 * {
 *   "txid": "...",
 *   "rawTxNoWitness": "...",
 *   "txIndex": 42,
 *   "merkleProof": ["...", "..."],
 *   "headers": ["...", "..."],
 *   "blockHeight": 800000,
 *   "confirmations": 6,
 *   "sorobanArgs": {
 *     "headers": ["..."],
 *     "merkle_proof": ["..."],
 *     "tx_index": 42,
 *     "raw_tx": "...",
 *     "min_confirmations": 6
 *   }
 * }
 * ```
 *
 * The `sorobanArgs` field contains the parameters formatted exactly as the
 * Stellar CLI and SDKs expect them, ready for direct use.
 */
proofRouter.get("/:txid", async (req: Request, res: Response): Promise<void> => {
  const { txid } = req.params;

  // Validate txid format.
  if (!TXID_RE.test(txid)) {
    res.status(400).json({
      error: "invalid_txid",
      message: "txid must be a 64-character lowercase hex string",
    });
    return;
  }

  // Parse and validate the confirmations query param.
  const rawConf = req.query["confirmations"];
  let confirmations = config.defaultConfirmations;
  if (rawConf !== undefined) {
    const parsed = parseInt(String(rawConf), 10);
    if (isNaN(parsed) || parsed < 1 || parsed > config.maxConfirmations) {
      res.status(400).json({
        error: "invalid_confirmations",
        message: `confirmations must be an integer between 1 and ${config.maxConfirmations}`,
      });
      return;
    }
    confirmations = parsed;
  }

  try {
    const bundle = await buildSPVProof(txid, confirmations, esplora);

    res.json({
      ...bundle,
      // Pre-formatted Soroban CLI / SDK args for immediate use.
      sorobanArgs: {
        headers: bundle.headers,
        merkle_proof: bundle.merkleProof,
        tx_index: bundle.txIndex,
        raw_tx: bundle.rawTxNoWitness,
        min_confirmations: bundle.confirmations,
      },
    });
  } catch (err) {
    if (err instanceof UnconfirmedTxError) {
      res.status(404).json({
        error: "unconfirmed",
        message: err.message,
      });
      return;
    }
    if (err instanceof InsufficientConfirmationsError) {
      res.status(409).json({
        error: "insufficient_confirmations",
        message: err.message,
        requested: err.requested,
        available: err.available,
      });
      return;
    }
    // Propagate unexpected errors as 502 (upstream failure).
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({
      error: "upstream_error",
      message,
    });
  }
});
