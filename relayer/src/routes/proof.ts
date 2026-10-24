import { Router, Request, Response } from "express";
import { EsploraClient, EsploraError, isUpstreamUnavailable } from "../bitcoin/esplora.js";
import {
  buildSPVProof,
  UnconfirmedTxError,
  InsufficientConfirmationsError,
  type SPVProofBundle,
} from "../bitcoin/spv.js";
import { cachedTipReader, readLightClientTipHeight } from "../bitcoin/light-client.js";
import { REORG_RESUBMIT_DEPTH } from "../bitcoin/header-sync.js";
import { TtlCache } from "../proof-cache.js";
import { rateLimit } from "../rate-limit.js";
import { config } from "../config.js";

const TXID_RE = /^[0-9a-f]{64}$/i;

/**
 * A proof is cached for the long TTL only once its block is this deep below
 * the Bitcoin tip: the header sync re-submits that many blocks for reorgs, so
 * past it the proof (block hash, Merkle path, header chain) is final in
 * practice. Shallower proofs, and the "not yet" answers (unconfirmed, not
 * enough confirmations, unknown txid), are cached for SHORT_TTL_MS only.
 */
const DEEP_CONFIRMATION_DEPTH = REORG_RESUBMIT_DEPTH;
const SHORT_TTL_MS = 15_000;
/** How long one read of the light client's tip is shared across requests. */
const LIGHT_CLIENT_TIP_TTL_MS = 5_000;
/** Retry hint for a 503 when Esplora is unavailable. */
const UPSTREAM_RETRY_AFTER_SECONDS = 10;

/** One HTTP answer, as stored in the cache. */
interface ProofResult {
  status: number;
  body: Record<string, unknown>;
}

export interface ProofRouterDeps {
  build: (txid: string, confirmations: number) => Promise<SPVProofBundle>;
  /** bitcoin-spv's best-tip height; undefined skips the light-client check. */
  lightClientTip: () => Promise<number | undefined>;
  rateLimit: number;
  rateWindowMs: number;
  cacheMaxEntries: number;
  cacheTtlMs: number;
  /** Seconds a caller should wait for the next header-sync pass. */
  headerSyncRetryAfterSeconds: number;
  now: () => number;
}

function defaultDeps(): ProofRouterDeps {
  const esplora = new EsploraClient(config.esploraBaseUrl, config.requestTimeoutMs, {
    retries: config.esploraRetries,
    fallbackBaseUrl: config.esploraFallbackUrl,
  });
  return {
    build: (txid, confirmations) => buildSPVProof(txid, confirmations, esplora),
    lightClientTip: cachedTipReader(readLightClientTipHeight, LIGHT_CLIENT_TIP_TTL_MS),
    rateLimit: config.spvProofRateLimit,
    rateWindowMs: config.spvProofRateWindowMs,
    cacheMaxEntries: config.spvProofCacheMaxEntries,
    cacheTtlMs: config.spvProofCacheTtlMs,
    headerSyncRetryAfterSeconds: Math.ceil(config.spvSyncIntervalMs / 1000),
    now: Date.now,
  };
}

/** Builds a proof and turns the outcome into a cacheable answer. Upstream
 * failures throw instead, so they are never cached. */
async function computeProof(
  deps: ProofRouterDeps,
  txid: string,
  confirmations: number,
): Promise<{ value: ProofResult; ttlMs: number }> {
  try {
    const { bitcoinTipHeight, ...bundle } = await deps.build(txid, confirmations);
    const depth = bitcoinTipHeight === undefined ? 0 : bitcoinTipHeight - bundle.blockHeight + 1;
    return {
      value: {
        status: 200,
        body: {
          ...bundle,
          // Pre-formatted Soroban CLI / SDK args for immediate use.
          sorobanArgs: {
            block_hash: bundle.blockHash,
            merkle_proof: bundle.merkleProof,
            tx_index: bundle.txIndex,
            raw_tx: bundle.rawTxNoWitness,
            min_confirmations: bundle.confirmations,
          },
        },
      },
      ttlMs: depth >= DEEP_CONFIRMATION_DEPTH ? deps.cacheTtlMs : SHORT_TTL_MS,
    };
  } catch (err) {
    if (err instanceof UnconfirmedTxError) {
      return { value: { status: 404, body: { error: "unconfirmed", message: err.message } }, ttlMs: SHORT_TTL_MS };
    }
    if (err instanceof InsufficientConfirmationsError) {
      return {
        value: {
          status: 409,
          body: {
            error: "insufficient_confirmations",
            message: err.message,
            requested: err.requested,
            available: err.available,
          },
        },
        ttlMs: SHORT_TTL_MS,
      };
    }
    // Esplora answers 404 for a txid it has never seen (typo, wrong network,
    // or not broadcast yet). Distinct from "unconfirmed", which it does know.
    if (err instanceof EsploraError && err.status === 404 && err.url.endsWith(`/tx/${txid}`)) {
      return {
        value: {
          status: 404,
          body: {
            error: "tx_not_found",
            message: `Transaction ${txid} is not known to the Bitcoin ${config.bitcoinNetwork} indexer`,
          },
        },
        ttlMs: SHORT_TTL_MS,
      };
    }
    throw err;
  }
}

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
 *     "block_hash": "...",
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
 *
 * Under load: per-IP rate limit (429 with Retry-After), a proof cache that
 * also coalesces identical concurrent requests, Esplora retry with an
 * optional fallback host (503 when both are unavailable), and a 409
 * `light_client_behind` when bitcoin-spv does not hold the block yet, or not
 * deep enough, which on-chain would fail with HeaderNotFound (#22) or
 * InsufficientConfirmations.
 */
export function createProofRouter(
  overrides: Partial<ProofRouterDeps> = {},
): Router & { cache: TtlCache<ProofResult> } {
  const deps: ProofRouterDeps = { ...defaultDeps(), ...overrides };
  const cache = new TtlCache<ProofResult>(deps.cacheMaxEntries, deps.now);
  const router = Router() as Router & { cache: TtlCache<ProofResult> };
  router.cache = cache;

  router.use(
    rateLimit({
      name: "spv-proof",
      limit: deps.rateLimit,
      windowMs: deps.rateWindowMs,
      now: deps.now,
      body: (retryAfterSeconds) => ({
        error: "rate_limited",
        message: `Too many proof requests from this address; retry in ${retryAfterSeconds}s`,
        retryAfterSeconds,
      }),
    }),
  );

  router.get("/:txid", async (req: Request, res: Response): Promise<void> => {
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

    const normalized = txid.toLowerCase();
    let result: ProofResult;
    try {
      result = await cache.getOrCompute(`${normalized}:${confirmations}`, () =>
        computeProof(deps, normalized, confirmations),
      );
    } catch (err) {
      if (isUpstreamUnavailable(err)) {
        res.setHeader("Retry-After", String(UPSTREAM_RETRY_AFTER_SECONDS));
        res.status(503).json({
          error: "upstream_unavailable",
          message: "The Bitcoin indexer is rate limiting or unavailable; retry shortly",
          retryAfterSeconds: UPSTREAM_RETRY_AFTER_SECONDS,
        });
        return;
      }
      // Anything else is an unexpected upstream answer.
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: "upstream_error", message });
      return;
    }

    if (result.status === 200) {
      // The proof is valid on Bitcoin; check the light client can verify it
      // now. verify_transaction needs the block stored and the light client's
      // tip at least `confirmations - 1` blocks above it.
      const blockHeight = result.body["blockHeight"] as number;
      const needed = blockHeight + confirmations - 1;
      const lcTip = await deps.lightClientTip();
      if (lcTip !== undefined && lcTip < needed) {
        const retryAfterSeconds = deps.headerSyncRetryAfterSeconds;
        res.setHeader("Retry-After", String(retryAfterSeconds));
        res.status(409).json({
          error: "light_client_behind",
          message:
            `bitcoin-spv holds headers up to height ${lcTip} and this proof needs ${needed}; ` +
            `the relayer submits new headers every ${retryAfterSeconds}s, retry then`,
          requested: confirmations,
          available: Math.max(0, lcTip - blockHeight + 1),
          blockHeight,
          lightClientTipHeight: lcTip,
          retryAfterSeconds,
        });
        return;
      }
    }

    res.status(result.status).json(result.body);
  });

  return router;
}

export const proofRouter = createProofRouter();
