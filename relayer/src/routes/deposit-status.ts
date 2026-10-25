import { Router, Request, Response } from "express";
import { EsploraClient, EsploraError, isUpstreamUnavailable, type TxStatus } from "../bitcoin/esplora.js";
import { cachedTipReader, readLightClientTipHeight } from "../bitcoin/light-client.js";
import {
  DepositIndex,
  positionExists,
  readMinConfirmations,
  type DepositEventsServer,
  type DepositRecord,
  type LedgerEntriesServer,
} from "../lend/deposit-reads.js";
import { TtlCache } from "../proof-cache.js";
import { rateLimit } from "../rate-limit.js";
import { config } from "../config.js";

const TXID_RE = /^[0-9a-f]{64}$/i;

/**
 * How long one answer per txid is shared. A deposit card polls every few
 * seconds and a block takes minutes, so this costs no visible latency and
 * keeps a page left open from turning into a stream of upstream calls.
 */
const STATUS_TTL_MS = 5_000;
/** How long one read of the Bitcoin tip, and one refresh of the deposit index, is shared. */
const TIP_TTL_MS = 5_000;
const INDEX_FRESH_MS = 5_000;
const LIGHT_CLIENT_TIP_TTL_MS = 5_000;
/** Retry hint for a 503 when an upstream is unavailable. */
const UPSTREAM_RETRY_AFTER_SECONDS = 10;

export type DepositStage = "unseen" | "mempool" | "confirming" | "ready" | "verified";

/** Whether writz-lend registered the deposit, and the transaction that did when it is still visible. */
export type Registration = { registered: false } | { registered: true; record: DepositRecord | null };

export interface DepositStatus {
  txid: string;
  stage: DepositStage;
  confirmations: number | null;
  required: number;
  blockHeight: number | null;
  proofReady: boolean | null;
  lightClientTipHeight: number | null;
  stellarTxHash: string | null;
  ledger: number | null;
  verifiedAt: string | null;
}

export interface DepositStatusRouterDeps {
  /** Esplora's view of the transaction; null when the indexer has never seen it. */
  bitcoinTx: (txid: string) => Promise<TxStatus | null>;
  bitcoinTip: () => Promise<number>;
  /** `Config::min_confirmations` of the writz-lend deployment. */
  required: () => Promise<number>;
  /** Takes the txid in internal byte order, as writz-lend keys it. */
  registration: (txidInternal: string) => Promise<Registration>;
  /** bitcoin-spv's best-tip height; undefined when unknown. */
  lightClientTip: () => Promise<number | undefined>;
  /** Builds the deposit index ahead of the first request; see `warm` on the router. */
  warm: () => Promise<void>;
  /** Null when lending is not configured on this relayer; the route then answers 503. */
  notConfiguredReason: string | null;
  rateLimit: number;
  rateWindowMs: number;
  now: () => number;
}

/** Display byte order (explorers, Esplora) to internal byte order (writz-lend storage and events). */
export function toInternalTxid(display: string): string {
  return Buffer.from(display, "hex").reverse().toString("hex");
}

function defaultDeps(): DepositStatusRouterDeps {
  const esplora = new EsploraClient(config.esploraBaseUrl, config.requestTimeoutMs, {
    retries: config.esploraRetries,
    fallbackBaseUrl: config.esploraFallbackUrl,
  });
  const contractId = config.writzLendId;
  const tip = new TtlCache<number>(1);

  // Built on first use: @stellar/stellar-sdk is required lazily (see
  // repay-watcher/poller.ts), and a relayer without WRITZ_LEND_ID never needs it.
  let server: (DepositEventsServer & LedgerEntriesServer) | undefined;
  let index: DepositIndex | undefined;
  const rpcServer = () => {
    if (!server) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { rpc } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
      server = new rpc.Server(config.stellarRpcUrl, {
        allowHttp: config.stellarRpcUrl.startsWith("http://"),
      }) as unknown as DepositEventsServer & LedgerEntriesServer;
    }
    return server;
  };
  const depositIndex = () => {
    index ??= new DepositIndex({ server: rpcServer(), contractId, freshForMs: INDEX_FRESH_MS });
    return index;
  };

  // The constructor is the only writer of min_confirmations, so the first
  // successful read holds for the life of the process. A failed read is not
  // kept: the next request tries again.
  let required: Promise<number> | undefined;

  return {
    bitcoinTx: async (txid) => {
      try {
        return (await esplora.getTxInfo(txid)).status;
      } catch (err) {
        if (err instanceof EsploraError && err.status === 404 && err.url.endsWith(`/tx/${txid}`)) return null;
        throw err;
      }
    },
    bitcoinTip: () => tip.getOrCompute("tip", async () => ({ value: await esplora.getTipHeight(), ttlMs: TIP_TTL_MS })),
    required: () => {
      required ??= readMinConfirmations(rpcServer(), contractId).catch((err: unknown) => {
        required = undefined;
        throw err;
      });
      return required;
    },
    registration: async (txidInternal) => {
      const record = await depositIndex().lookup(txidInternal);
      if (record) return { registered: true, record };
      if (!(await positionExists(rpcServer(), contractId, txidInternal))) return { registered: false };
      // Registered, but the index has not seen the event yet (it refreshes at
      // most every few seconds) or the event is older than the RPC keeps.
      // One forced refresh tells the two apart.
      await depositIndex().refresh(true);
      return { registered: true, record: (await depositIndex().lookup(txidInternal)) ?? null };
    },
    lightClientTip: cachedTipReader(readLightClientTipHeight, LIGHT_CLIENT_TIP_TTL_MS),
    warm: () => (contractId ? depositIndex().refresh() : Promise.resolve()),
    notConfiguredReason: contractId ? null : "WRITZ_LEND_ID is not set on this relayer",
    rateLimit: config.depositStatusRateLimit,
    rateWindowMs: config.depositStatusRateWindowMs,
    now: Date.now,
  };
}

class StellarUnavailableError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "StellarUnavailableError";
  }
}

/**
 * Reads both chains and says where the deposit is. Stellar first decides
 * whether it is verified; Bitcoin says how far it is otherwise. A verified
 * deposit is still answered when Bitcoin cannot be read, with the Bitcoin
 * fields null, because the Stellar transaction is the fact the caller needs.
 */
async function computeStatus(deps: DepositStatusRouterDeps, txid: string): Promise<DepositStatus> {
  const stellar = Promise.all([deps.required(), deps.registration(toInternalTxid(txid))]).catch((err: unknown) => {
    throw new StellarUnavailableError(err);
  });
  const bitcoin = deps.bitcoinTx(txid).then(async (tx) => ({
    tx,
    tip: tx?.confirmed ? await deps.bitcoinTip() : null,
  }));
  const [stellarResult, bitcoinResult] = await Promise.allSettled([stellar, bitcoin]);
  if (stellarResult.status === "rejected") throw stellarResult.reason;
  const [required, registration] = stellarResult.value;

  const record = registration.registered ? registration.record : null;
  const verified = {
    stellarTxHash: record?.stellarTxHash ?? null,
    ledger: record?.ledger ?? null,
    verifiedAt: record?.ledgerClosedAt ?? null,
  };

  if (bitcoinResult.status === "rejected") {
    if (!registration.registered) throw bitcoinResult.reason;
    return {
      txid,
      stage: "verified",
      confirmations: null,
      required,
      blockHeight: null,
      proofReady: null,
      lightClientTipHeight: null,
      ...verified,
    };
  }

  const { tx, tip } = bitcoinResult.value;
  const blockHeight = tx?.confirmed ? tx.block_height : null;
  // A fallback Esplora host a block behind can report a tip below the block
  // it just placed the transaction in; a confirmed transaction has at least one.
  const confirmations = blockHeight !== null && tip !== null ? Math.max(1, tip - blockHeight + 1) : 0;

  // The light client is only consulted once Bitcoin alone would allow the
  // proof: before that its answer cannot change the stage.
  let lightClientTipHeight: number | null = null;
  let proofReady = false;
  if (blockHeight !== null && confirmations >= required) {
    const lcTip = await deps.lightClientTip();
    lightClientTipHeight = lcTip ?? null;
    // verify_transaction needs the block and `required - 1` blocks above it
    // stored in bitcoin-spv. Unknown (unset or unreadable) is treated as the
    // proof route treats it: the proof is served and the contract decides.
    proofReady = lcTip === undefined || lcTip >= blockHeight + required - 1;
  }

  let stage: DepositStage;
  if (registration.registered) stage = "verified";
  else if (tx === null) stage = "unseen";
  else if (!tx.confirmed) stage = "mempool";
  else stage = proofReady ? "ready" : "confirming";

  return { txid, stage, confirmations, required, blockHeight, proofReady, lightClientTipHeight, ...verified };
}

/**
 * GET /deposit-status/:txid
 *
 * Where a writz-lend deposit is, from the Bitcoin transaction to its
 * registration on Stellar. `txid` is in display byte order, as explorers and
 * wallets show it.
 *
 * Success 200:
 * ```json
 * {
 *   "txid": "...",
 *   "stage": "verified",
 *   "confirmations": 155,
 *   "required": 1,
 *   "blockHeight": 327757,
 *   "proofReady": true,
 *   "lightClientTipHeight": 327911,
 *   "stellarTxHash": "...",
 *   "ledger": 5364245,
 *   "verifiedAt": "2026-10-24T12:26:52Z"
 * }
 * ```
 *
 * Stages:
 *   - `unseen`: the Bitcoin indexer does not know the transaction (not
 *     broadcast yet, or not propagated to it).
 *   - `mempool`: broadcast, not in a block.
 *   - `confirming`: in a block, and either fewer than `required`
 *     confirmations or the light client does not hold the confirming
 *     headers yet (`confirmations >= required`, `proofReady: false`).
 *   - `ready`: the SPV proof can be built and the light client can verify
 *     it; nothing on Stellar has registered the deposit yet.
 *   - `verified`: writz-lend registered the deposit. `stellarTxHash`,
 *     `ledger` and `verifiedAt` come from its `deposit` event; they are null
 *     only for a deposit registered before the Stellar RPC's event retention.
 *
 * `required` is the deployment's `min_confirmations`, read from the contract.
 * A deposit transaction that is pending or failed on Stellar is not
 * observable here (it is signed and submitted by the user's wallet, and a
 * failed call emits no event), so there is no "submitted" stage.
 */
export type DepositStatusRouter = Router & { cache: TtlCache<DepositStatus>; warm: () => Promise<void> };

export function createDepositStatusRouter(
  overrides: Partial<DepositStatusRouterDeps> = {},
): DepositStatusRouter {
  const deps: DepositStatusRouterDeps = { ...defaultDeps(), ...overrides };
  const cache = new TtlCache<DepositStatus>(1000, deps.now);
  const router = Router() as DepositStatusRouter;
  router.cache = cache;
  // The first walk of the deposit index covers the RPC's whole event window,
  // about a dozen sequential requests on testnet. Starting it at boot keeps
  // that off the first caller; a failure here is only logged, since the
  // first request retries it.
  router.warm = () =>
    deps.warm().catch((err: unknown) => {
      console.warn("[deposit-status] index warm-up failed:", err instanceof Error ? err.message : err);
    });

  router.use(
    rateLimit({
      name: "deposit-status",
      limit: deps.rateLimit,
      windowMs: deps.rateWindowMs,
      now: deps.now,
      body: (retryAfterSeconds) => ({
        error: "rate_limited",
        message: `Too many deposit status requests from this address; retry in ${retryAfterSeconds}s`,
        retryAfterSeconds,
      }),
    }),
  );

  router.get("/:txid", async (req: Request, res: Response): Promise<void> => {
    const { txid } = req.params;
    if (!TXID_RE.test(txid)) {
      res.status(400).json({
        error: "invalid_txid",
        message: "txid must be a 64-character hex string, in display byte order",
      });
      return;
    }
    if (deps.notConfiguredReason) {
      res.status(503).json({ error: "lending_not_configured", message: deps.notConfiguredReason });
      return;
    }

    const normalized = txid.toLowerCase();
    try {
      const status = await cache.getOrCompute(normalized, async () => ({
        value: await computeStatus(deps, normalized),
        ttlMs: STATUS_TTL_MS,
      }));
      res.json(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof StellarUnavailableError) {
        res.setHeader("Retry-After", String(UPSTREAM_RETRY_AFTER_SECONDS));
        res.status(503).json({
          error: "stellar_unavailable",
          message: `Could not read writz-lend from Stellar RPC; retry shortly (${message})`,
          retryAfterSeconds: UPSTREAM_RETRY_AFTER_SECONDS,
        });
        return;
      }
      if (isUpstreamUnavailable(err)) {
        res.setHeader("Retry-After", String(UPSTREAM_RETRY_AFTER_SECONDS));
        res.status(503).json({
          error: "upstream_unavailable",
          message: "The Bitcoin indexer is rate limiting or unavailable; retry shortly",
          retryAfterSeconds: UPSTREAM_RETRY_AFTER_SECONDS,
        });
        return;
      }
      res.status(502).json({ error: "upstream_error", message });
    }
  });

  return router;
}
