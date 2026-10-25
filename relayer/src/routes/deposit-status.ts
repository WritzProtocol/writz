import { Router, Request, Response } from "express";
import { EsploraClient, EsploraError, isUpstreamUnavailable, type TxStatus } from "../bitcoin/esplora.js";
import { cachedTipReader, readLightClientTipHeight } from "../bitcoin/light-client.js";
import { positionExists, readMinConfirmations, type DepositRecord } from "../lend/deposit-reads.js";
import { checkDepositSubmission, type SubmissionCheck } from "../lend/deposit-submission.js";
import { lendRpcServer as rpcServer, positionEventIndex as depositIndex } from "../lend/from-config.js";
import { TtlCache } from "../proof-cache.js";
import { rateLimit } from "../rate-limit.js";
import { config } from "../config.js";

const TXID_RE = /^[0-9a-f]{64}$/i;
/** A Stellar transaction hash is also 32 bytes of hex. */
const STELLAR_TX_RE = TXID_RE;

/**
 * How long one answer per txid is shared. A deposit card polls every few
 * seconds and a block takes minutes, so this costs no visible latency and
 * keeps a page left open from turning into a stream of upstream calls.
 */
const STATUS_TTL_MS = 5_000;
/** How long one read of the Bitcoin tip is shared. */
const TIP_TTL_MS = 5_000;
const LIGHT_CLIENT_TIP_TTL_MS = 5_000;
/** Retry hint for a 503 when an upstream is unavailable. */
const UPSTREAM_RETRY_AFTER_SECONDS = 10;
/**
 * How long a `stellarTx` the RPC does not hold yet is still reported as
 * `submitted`, from the first request that named it. The SDK builds the
 * deposit with a 300 s time bound, so a transaction not in a ledger by then
 * can no longer land; one more minute covers RPC ingestion lag.
 */
export const SUBMISSION_WINDOW_MS = 360_000;
/** How long the first sighting of a pending `stellarTx` is remembered; well past the window. */
const FIRST_SEEN_TTL_MS = 24 * 60 * 60 * 1000;

export type DepositStage = "unseen" | "mempool" | "confirming" | "ready" | "submitted" | "verified" | "failed";

/** Whether writz-lend registered the deposit, and the transaction that did when it is still visible. */
export type Registration = { registered: false } | { registered: true; record: DepositRecord | null };

/** What Stellar says about the `stellarTx` the caller named, after it was matched to this deposit. */
export interface DepositSubmission {
  stellarTxHash: string;
  /** `not_found`: not in a ledger the RPC holds (in flight, dropped, or never sent). */
  status: "not_found" | "success" | "failed";
  ledger: number | null;
  closedAt: string | null;
  /** For `failed`: the `WritzLendError` name, or the Soroban or result code when the contract did not return one. */
  reason: string | null;
  /** For `failed` with a contract error: its numeric code. */
  errorCode: number | null;
}

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
  /** Null unless the request named a `stellarTx`. */
  submission: DepositSubmission | null;
}

export interface DepositStatusRouterDeps {
  /** Esplora's view of the transaction; null when the indexer has never seen it. */
  bitcoinTx: (txid: string) => Promise<TxStatus | null>;
  bitcoinTip: () => Promise<number>;
  /** `Config::min_confirmations` of the writz-lend deployment. */
  required: () => Promise<number>;
  /** Takes the txid in internal byte order, as writz-lend keys it. */
  registration: (txidInternal: string) => Promise<Registration>;
  /**
   * Reads a Stellar transaction and checks it is a writz-lend `deposit` for
   * this txid (internal byte order).
   */
  submission: (txidInternal: string, stellarTxHash: string) => Promise<SubmissionCheck>;
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

  // The RPC client and the event index are shared with GET /timeline and
  // built on first use (see ../lend/from-config.ts).

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
    submission: (txidInternal, stellarTxHash) =>
      checkDepositSubmission(rpcServer(), contractId, txidInternal, stellarTxHash),
    lightClientTip: cachedTipReader(readLightClientTipHeight, LIGHT_CLIENT_TIP_TTL_MS),
    warm: () => (contractId ? depositIndex().refresh() : Promise.resolve()),
    notConfiguredReason: contractId ? null : "WRITZ_LEND_ID is not set on this relayer",
    rateLimit: config.depositStatusRateLimit,
    rateWindowMs: config.depositStatusRateWindowMs,
    now: Date.now,
  };
}

/** The `stellarTx` exists on Stellar but is not a writz-lend `deposit` for the requested txid. */
class StellarTxMismatchError extends Error {
  constructor() {
    super("stellarTx is not a writz-lend deposit call for this txid");
    this.name = "StellarTxMismatchError";
  }
}

class StellarUnavailableError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "StellarUnavailableError";
  }
}

/** A named `stellarTx`, and when this process first saw it named for this deposit. */
interface SubmissionQuery {
  hash: string;
  /** Milliseconds since the first request that named it; 0 on that request. */
  elapsedMs: number;
}

function submissionView(hash: string, check: SubmissionCheck): DepositSubmission {
  if (check.status === "not_found" || check.status === "mismatch") {
    return { stellarTxHash: hash, status: "not_found", ledger: null, closedAt: null, reason: null, errorCode: null };
  }
  const failed = check.status === "failed";
  return {
    stellarTxHash: hash,
    status: check.status,
    ledger: check.ledger,
    closedAt: check.closedAt,
    reason: failed ? check.reason : null,
    errorCode: failed ? check.errorCode : null,
  };
}

/**
 * Reads both chains and says where the deposit is. Stellar first decides
 * whether it is verified; Bitcoin says how far it is otherwise. A verified
 * deposit is still answered when Bitcoin cannot be read, with the Bitcoin
 * fields null, because the Stellar transaction is the fact the caller needs.
 *
 * With a `stellarTx`, the Stellar side also reads that transaction, and a
 * deposit not registered yet can be `submitted` or `failed`. `verified` still
 * comes only from the registration.
 */
async function computeStatus(
  deps: DepositStatusRouterDeps,
  txid: string,
  query: SubmissionQuery | null,
): Promise<DepositStatus> {
  const txidInternal = toInternalTxid(txid);
  const stellar = Promise.all([
    deps.required(),
    deps.registration(txidInternal),
    query ? deps.submission(txidInternal, query.hash) : Promise.resolve(null),
  ]).catch((err: unknown) => {
    throw new StellarUnavailableError(err);
  });
  const bitcoin = deps.bitcoinTx(txid).then(async (tx) => ({
    tx,
    tip: tx?.confirmed ? await deps.bitcoinTip() : null,
  }));
  const [stellarResult, bitcoinResult] = await Promise.allSettled([stellar, bitcoin]);
  if (stellarResult.status === "rejected") throw stellarResult.reason;
  const [required, registration, check] = stellarResult.value;
  // Checked before anything else is answered: a hash that is on chain but
  // deposits something else (or nothing) must not lend its state to this txid.
  if (check?.status === "mismatch") throw new StellarTxMismatchError();
  const submission = query && check ? submissionView(query.hash, check) : null;

  const record = registration.registered ? registration.record : null;
  // A successful `deposit` for this txid is the registering transaction (a
  // second one fails with PositionAlreadyExists), so it fills the hash when
  // the event index has not caught up or the event is past its retention.
  let verified = {
    stellarTxHash: record?.stellarTxHash ?? null,
    ledger: record?.ledger ?? null,
    verifiedAt: record?.ledgerClosedAt ?? null,
  };
  if (registration.registered && !record && check?.status === "success" && query) {
    verified = { stellarTxHash: query.hash, ledger: check.ledger, verifiedAt: check.closedAt };
  }

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
      submission,
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
  else if (check?.status === "failed") stage = "failed";
  // In a ledger and successful, but the registration read has not caught up.
  else if (check?.status === "success") stage = "submitted";
  // Not in a ledger the RPC holds, so the envelope cannot be checked. It is
  // only believed while it could still land, and only once the Bitcoin
  // transaction is in a block: a deposit call needs the block hash and the
  // Merkle proof, so none can exist before that.
  else if (check?.status === "not_found" && blockHeight !== null && query && query.elapsedMs < SUBMISSION_WINDOW_MS) {
    stage = "submitted";
  } else if (tx === null) stage = "unseen";
  else if (!tx.confirmed) stage = "mempool";
  else stage = proofReady ? "ready" : "confirming";

  return {
    txid,
    stage,
    confirmations,
    required,
    blockHeight,
    proofReady,
    lightClientTipHeight,
    ...verified,
    submission,
  };
}

/**
 * GET /deposit-status/:txid[?stellarTx=<hash>]
 *
 * Where a writz-lend deposit is, from the Bitcoin transaction to its
 * registration on Stellar. `txid` is in display byte order, as explorers and
 * wallets show it. `stellarTx` is the hash the app got back when it submitted
 * the `deposit` call; without it there is no `submitted` or `failed` stage.
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
 *   "verifiedAt": "2026-10-24T12:26:52Z",
 *   "submission": null
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
 *   - `submitted` (only with `stellarTx`): the deposit call is in a ledger
 *     and succeeded but the registration read has not caught up, or the RPC
 *     does not hold it yet, the Bitcoin transaction is in a block, and less
 *     than `SUBMISSION_WINDOW_MS` passed since the hash was first named.
 *   - `failed` (only with `stellarTx`): the deposit call is in a ledger and
 *     failed; `submission.reason` says why. A new submission is needed.
 *   - `verified`: writz-lend registered the deposit. `stellarTxHash`,
 *     `ledger` and `verifiedAt` come from its `deposit` event, or from the
 *     successful `stellarTx` when the event is not indexed; they are null
 *     only for a deposit registered before the Stellar RPC's event retention.
 *
 * `required` is the deployment's `min_confirmations`, read from the contract.
 * A `stellarTx` found on Stellar that is not a writz-lend `deposit` for this
 * txid is answered `400 stellar_tx_mismatch`, whatever the stage.
 */
export type DepositStatusRouter = Router & { cache: TtlCache<DepositStatus>; warm: () => Promise<void> };

export function createDepositStatusRouter(
  overrides: Partial<DepositStatusRouterDeps> = {},
): DepositStatusRouter {
  const deps: DepositStatusRouterDeps = { ...defaultDeps(), ...overrides };
  const cache = new TtlCache<DepositStatus>(1000, deps.now);
  // Keyed by txid and hash, so a hash only ever speaks for the deposit it was named with.
  const firstSeen = new TtlCache<number>(10_000, deps.now);
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
    const { stellarTx } = req.query;
    if (stellarTx !== undefined && (typeof stellarTx !== "string" || !STELLAR_TX_RE.test(stellarTx))) {
      res.status(400).json({
        error: "invalid_stellar_tx",
        message: "stellarTx must be a 64-character hex Stellar transaction hash",
      });
      return;
    }
    if (deps.notConfiguredReason) {
      res.status(503).json({ error: "lending_not_configured", message: deps.notConfiguredReason });
      return;
    }

    const normalized = txid.toLowerCase();
    const hash = typeof stellarTx === "string" ? stellarTx.toLowerCase() : null;
    const key = hash ? `${normalized}:${hash}` : normalized;
    try {
      const status = await cache.getOrCompute(key, async () => {
        let query: SubmissionQuery | null = null;
        if (hash) {
          let since = firstSeen.get(key);
          if (since === undefined) {
            since = deps.now();
            firstSeen.set(key, since, FIRST_SEEN_TTL_MS);
          }
          query = { hash, elapsedMs: deps.now() - since };
        }
        return { value: await computeStatus(deps, normalized, query), ttlMs: STATUS_TTL_MS };
      });
      res.json(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof StellarTxMismatchError) {
        res.status(400).json({ error: "stellar_tx_mismatch", message });
        return;
      }
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
