import { Router, Request, Response } from "express";
import { EsploraClient, EsploraError, type Outspend, type TxWithOutputs } from "../bitcoin/esplora.js";
import { readPosition, readUsdcToken, type PositionEventRecord, type PositionSummary } from "../lend/deposit-reads.js";
import { lendRpcServer, positionEventIndex } from "../lend/from-config.js";
import {
  attributeReceiveLegs,
  classifyOperation,
  fetchOwnerOperations,
  type OwnerOperation,
  type ReceiveContext,
} from "../lend/receive-legs.js";
import { BASE_SEPOLIA_EXPLORER, type CctpRelayView } from "../cctp/store.js";
import { BASE_DOMAIN } from "../cctp/message.js";
import { TtlCache } from "../proof-cache.js";
import { rateLimit } from "../rate-limit.js";
import { config } from "../config.js";
import { toInternalTxid } from "./deposit-status.js";

const TXID_RE = /^[0-9a-f]{64}$/i;

/**
 * How long one timeline per txid is shared. Every step is a settled
 * transaction, so a short cache costs nothing a reader would notice and
 * keeps a reloaded loan page from reading three upstreams each time.
 */
const TIMELINE_TTL_MS = 10_000;
/** Retry hint for a 503 when Stellar RPC is unavailable. */
const UPSTREAM_RETRY_AFTER_SECONDS = 10;
/** Pages of 200 owner operations read per timeline; past that the answer says it is incomplete. */
const OWNER_OPERATION_PAGES = 5;

/**
 * The app's types (frontend/app/src/lib/receive/timeline.ts), field for
 * field, plus `url`: the explorer page of `hash`.
 */
export type TimelineKind = "btc_lock" | "verified" | "borrowed" | "received" | "repaid" | "released";
export type TimelineChain = "bitcoin" | "stellar" | "base-sepolia";

export interface TimelineEvent {
  kind: TimelineKind;
  chain: TimelineChain;
  hash: string;
  /** Unix ms, when known. */
  at: number | null;
  /** For `received`: "as XLM", "sent to Base Sepolia", "on Base Sepolia". For a liquidation: "by liquidation". */
  detail?: string;
  url: string;
}

export interface Timeline {
  /** Display byte order, as requested. */
  btcTxid: string;
  /** writz-lend's key for the position: the txid in internal byte order. */
  positionId: string;
  /** The depositor's Stellar address; null only if neither the position nor a borrow names it. */
  owner: string | null;
  /** writz-lend's `PositionStatus` ("Active", "Closed", "Liquidated"); null when the entry is not readable. */
  status: string | null;
  /** False when a source could not be read in full; `gaps` says which. */
  complete: boolean;
  gaps: string[];
  /** In chain order, the order the app's `orderTimeline` produces. */
  events: TimelineEvent[];
}

/** Explorer pages, per chain. */
export interface Explorers {
  bitcoinTx: (hash: string) => string;
  stellarTx: (hash: string) => string;
  baseSepoliaTx: (hash: string) => string;
}

export interface MintRecord {
  mintHash: string;
  /** Unix ms the relay recorded the mint. */
  at: number;
}

export interface TimelineRouterDeps {
  /** Every indexed writz-lend event of the position (internal byte order), in ledger order. */
  history: (positionId: string) => Promise<PositionEventRecord[]>;
  position: (positionId: string) => Promise<PositionSummary | undefined>;
  /** Esplora's view of the deposit; null when the indexer has never seen it. */
  bitcoinTx: (txid: string) => Promise<TxWithOutputs | null>;
  outspends: (txid: string) => Promise<Outspend[]>;
  /** The owner's operations from `fromLedger` on, classified, in chain order. */
  ownerOperations: (owner: string, fromLedger: number) => Promise<{ operations: OwnerOperation[]; truncated: boolean }>;
  /** The Base Sepolia mint of a CCTP burn, when the relay holds it. */
  mint: (burnHash: string) => MintRecord | undefined;
  explorers: Explorers;
  warm: () => Promise<void>;
  /** Null when lending is not configured on this relayer; the route then answers 503. */
  notConfiguredReason: string | null;
  rateLimit: number;
  rateWindowMs: number;
  now: () => number;
}

/**
 * The mint a relay view reports, if any. Only an `arrived` transfer with a
 * known mint hash is one: a transfer the relay is still retrying reads
 * `confirming` or `confirmed`, and an arrival whose mint is still being looked
 * up has a null `mintHash`. `at` is when the relay recorded the arrival.
 */
export function mintFromRelayView(view: CctpRelayView | undefined): MintRecord | undefined {
  if (view?.kind !== "arrived" || !view.mintHash) return undefined;
  return { mintHash: view.mintHash, at: Date.parse(view.updatedAt) };
}

const RANK: Record<TimelineKind, number> = { btc_lock: 0, verified: 1, borrowed: 2, received: 3, repaid: 4, released: 5 };
const PHASE: Record<TimelineKind, number> = { btc_lock: 0, verified: 1, borrowed: 2, received: 2, repaid: 2, released: 3 };

/**
 * Chain order, the same as the app's `orderTimeline`: the lock and its
 * verification first, the release last, and between them time decides, an
 * unknown time after known ones, then cycle order.
 */
export function orderTimeline<E extends Omit<TimelineEvent, "url">>(events: readonly E[]): E[] {
  const seen = new Set<string>();
  const unique = events.filter((e) => {
    const key = `${e.kind}:${e.hash}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const p = PHASE[a.e.kind] - PHASE[b.e.kind];
      if (p !== 0) return p;
      const ta = a.e.at ?? Number.POSITIVE_INFINITY;
      const tb = b.e.at ?? Number.POSITIVE_INFINITY;
      if (ta !== tb) return ta < tb ? -1 : 1;
      const r = RANK[a.e.kind] - RANK[b.e.kind];
      return r !== 0 ? r : a.i - b.i;
    })
    .map(({ e }) => e);
}

function defaultDeps(): TimelineRouterDeps {
  const esplora = new EsploraClient(config.esploraBaseUrl, config.requestTimeoutMs, {
    retries: config.esploraRetries,
    fallbackBaseUrl: config.esploraFallbackUrl,
  });
  const contractId = config.writzLendId;

  // The constructor is the only writer of usdc_token: one successful read
  // holds for the process; a failed one is retried by the next request.
  let usdc: Promise<string> | undefined;
  const usdcToken = () => {
    usdc ??= readUsdcToken(lendRpcServer(), contractId).catch((err: unknown) => {
      usdc = undefined;
      throw err;
    });
    return usdc;
  };
  const xlmToken = () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Asset } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
    return Asset.native().contractId(config.networkPassphrase);
  };

  const stellarNetwork = config.networkPassphrase.startsWith("Public Global") ? "public" : "testnet";
  const bitcoinBase = config.bitcoinNetwork === "signet" ? "https://mempool.space/signet" : "https://mempool.space";

  return {
    history: (positionId) => positionEventIndex().history(positionId),
    position: (positionId) => readPosition(lendRpcServer(), contractId, positionId),
    bitcoinTx: async (txid) => {
      try {
        return await esplora.getTxWithOutputs(txid);
      } catch (err) {
        if (err instanceof EsploraError && err.status === 404 && err.url.endsWith(`/tx/${txid}`)) return null;
        throw err;
      }
    },
    outspends: (txid) => esplora.getOutspends(txid),
    ownerOperations: async (owner, fromLedger) => {
      const ctx: ReceiveContext = {
        owner,
        writzLend: contractId,
        soroswapRouter: config.soroswapRouterId,
        tokenMessengerMinter: config.cctpTokenMessengerMinterId,
        usdcToken: await usdcToken(),
        xlmToken: xlmToken(),
        baseDomain: BASE_DOMAIN,
      };
      const { operations, truncated } = await fetchOwnerOperations({
        horizonUrl: config.horizonUrl,
        owner,
        fromLedger,
        maxPages: OWNER_OPERATION_PAGES,
        timeoutMs: config.requestTimeoutMs,
      });
      const classified = operations.map((op) => classifyOperation(op, ctx)).filter((op) => op !== undefined);
      return { operations: classified, truncated };
    },
    // Set by `createTimelineRouter`'s caller when the CCTP relay runs here.
    mint: () => undefined,
    explorers: {
      bitcoinTx: (hash) => `${bitcoinBase}/tx/${hash}`,
      stellarTx: (hash) => `https://stellar.expert/explorer/${stellarNetwork}/tx/${hash}`,
      baseSepoliaTx: (hash) => `${BASE_SEPOLIA_EXPLORER}/tx/${hash}`,
    },
    warm: () => (contractId ? positionEventIndex().refresh() : Promise.resolve()),
    notConfiguredReason: contractId ? null : "WRITZ_LEND_ID is not set on this relayer",
    rateLimit: config.timelineRateLimit,
    rateWindowMs: config.timelineRateWindowMs,
    now: Date.now,
  };
}

class StellarUnavailableError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "StellarUnavailableError";
  }
}

class PositionNotFoundError extends Error {}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const blockTimeMs = (status: { confirmed: boolean; block_time: number | null } | undefined) =>
  status?.confirmed && status.block_time ? status.block_time * 1000 : null;

/**
 * Builds the timeline of one position. writz-lend decides whether there is
 * a position at all and is required; Bitcoin and Horizon only add steps, so
 * when either cannot be read the answer is still given, marked incomplete.
 */
async function computeTimeline(deps: TimelineRouterDeps, btcTxid: string): Promise<Timeline> {
  const positionId = toInternalTxid(btcTxid);
  const [history, position] = await Promise.all([deps.history(positionId), deps.position(positionId)]).catch(
    (err: unknown) => {
      throw new StellarUnavailableError(err);
    },
  );
  if (history.length === 0 && !position) throw new PositionNotFoundError();

  const gaps: string[] = [];
  const events: Omit<TimelineEvent, "url">[] = [];
  const stellarAt = (e: PositionEventRecord) => Date.parse(e.ledgerClosedAt);
  const borrows = history.filter((e) => e.kind === "borrow");
  const owner = position?.depositor ?? borrows[0]?.account ?? null;

  if (!history.some((e) => e.kind === "deposit")) {
    gaps.push("stellar: this position is older than the Stellar RPC event window; its earlier steps are not shown");
  }

  // Bitcoin: the lock, then the transaction that spent the locked output.
  try {
    const tx = await deps.bitcoinTx(btcTxid);
    events.push({ kind: "btc_lock", chain: "bitcoin", hash: btcTxid, at: blockTimeMs(tx?.status) });
    const vout = tx && position ? tx.vout.findIndex((o) => o.scriptpubkey === position.p2wshScriptPubkey) : -1;
    if (tx && vout >= 0) {
      const spend = (await deps.outspends(btcTxid))[vout];
      if (spend?.spent && spend.txid) {
        events.push({ kind: "released", chain: "bitcoin", hash: spend.txid, at: blockTimeMs(spend.status) });
      }
    } else if (tx && position) {
      gaps.push("bitcoin: no output of this transaction carries the position's script, so its release cannot be looked up");
    }
  } catch (err) {
    // writz-lend holds the position, so the lock exists; only its time and
    // the release are unknown.
    if (!events.some((e) => e.kind === "btc_lock")) events.push({ kind: "btc_lock", chain: "bitcoin", hash: btcTxid, at: null });
    gaps.push(`bitcoin: the indexer could not be read, so the release was not checked (${message(err)})`);
  }

  for (const e of history) {
    const at = stellarAt(e);
    if (e.kind === "deposit") events.push({ kind: "verified", chain: "stellar", hash: e.stellarTxHash, at });
    else if (e.kind === "borrow") events.push({ kind: "borrowed", chain: "stellar", hash: e.stellarTxHash, at });
    else if (e.kind === "repay" || e.kind === "repay_full") {
      events.push({ kind: "repaid", chain: "stellar", hash: e.stellarTxHash, at });
    } else if (e.kind === "liquidate") {
      events.push({ kind: "repaid", chain: "stellar", hash: e.stellarTxHash, at, detail: "by liquidation" });
    }
  }

  // How each borrow was received: the owner's swaps and burns, by the rule in
  // ../lend/receive-legs.ts. A borrow taken as USDC on Stellar has none.
  if (owner && borrows.length > 0) {
    try {
      const fromLedger = Math.min(...borrows.map((b) => b.ledger));
      const { operations, truncated } = await deps.ownerOperations(owner, fromLedger);
      if (truncated) gaps.push("stellar: the owner has more operations than one timeline reads; later receive legs may be missing");
      for (const leg of attributeReceiveLegs(operations, new Set(borrows.map((b) => b.stellarTxHash)))) {
        if (leg.kind === "swap_to_xlm") {
          events.push({ kind: "received", chain: "stellar", hash: leg.txHash, at: leg.at, detail: "as XLM" });
        } else if (leg.kind === "burn_to_base_sepolia") {
          events.push({ kind: "received", chain: "stellar", hash: leg.txHash, at: leg.at, detail: "sent to Base Sepolia" });
          const mint = deps.mint(leg.txHash);
          if (mint) {
            events.push({ kind: "received", chain: "base-sepolia", hash: mint.mintHash, at: mint.at, detail: "on Base Sepolia" });
          }
        }
      }
    } catch (err) {
      gaps.push(`stellar: the owner's operations could not be read, so receive legs are not shown (${message(err)})`);
    }
  }

  const url = (e: Omit<TimelineEvent, "url">) =>
    e.chain === "bitcoin"
      ? deps.explorers.bitcoinTx(e.hash)
      : e.chain === "stellar"
        ? deps.explorers.stellarTx(e.hash)
        : deps.explorers.baseSepoliaTx(e.hash);

  return {
    btcTxid,
    positionId,
    owner,
    status: position?.status ?? null,
    complete: gaps.length === 0,
    gaps,
    events: orderTimeline(events).map((e) => ({ ...e, url: url(e) })),
  };
}

/**
 * GET /timeline/:btcTxid
 *
 * The full cycle of one writz-lend position, one event per transaction, each
 * with its explorer link: the Bitcoin lock (mempool.space), its verification
 * and every borrow and repay on Stellar (stellar.expert), how each borrow was
 * received (a swap to XLM, or a CCTP burn on Stellar and its mint on Base
 * Sepolia, Basescan), and the Bitcoin transaction that spent the lock.
 * `btcTxid` is in display byte order.
 *
 * Success 200:
 * ```json
 * {
 *   "btcTxid": "b7b74d27...",
 *   "positionId": "6e8b2b7c...",
 *   "owner": "GAXD...",
 *   "status": "Closed",
 *   "complete": true,
 *   "gaps": [],
 *   "events": [
 *     { "kind": "btc_lock", "chain": "bitcoin", "hash": "b7b74d27...", "at": 1792844759000, "url": "https://mempool.space/signet/tx/b7b74d27..." },
 *     { "kind": "verified", "chain": "stellar", "hash": "020bdab6...", "at": 1792844812000, "url": "https://stellar.expert/explorer/testnet/tx/020bdab6..." }
 *   ]
 * }
 * ```
 *
 * `kind`, `chain`, `hash`, `at` and `detail` are the app's `TimelineEvent`.
 * Only transactions that exist are listed; a step not taken yet has no event.
 * Receive legs are linked to the loan by a stated rule, not by the chain:
 * see ../lend/receive-legs.ts. A Base Sepolia mint is listed when the CCTP
 * relay on this relayer completed or observed it.
 *
 * 404 `position_not_found` when writz-lend has neither a `Position` nor any
 * event for the txid (GET /deposit-status follows a deposit before that).
 */
export type TimelineRouter = Router & { cache: TtlCache<Timeline>; warm: () => Promise<void> };

export function createTimelineRouter(overrides: Partial<TimelineRouterDeps> = {}): TimelineRouter {
  const deps: TimelineRouterDeps = { ...defaultDeps(), ...overrides };
  const cache = new TtlCache<Timeline>(1000, deps.now);
  const router = Router() as TimelineRouter;
  router.cache = cache;
  router.warm = () =>
    deps.warm().catch((err: unknown) => {
      console.warn("[timeline] index warm-up failed:", message(err));
    });

  router.use(
    rateLimit({
      name: "timeline",
      limit: deps.rateLimit,
      windowMs: deps.rateWindowMs,
      now: deps.now,
      body: (retryAfterSeconds) => ({
        error: "rate_limited",
        message: `Too many timeline requests from this address; retry in ${retryAfterSeconds}s`,
        retryAfterSeconds,
      }),
    }),
  );

  router.get("/:btcTxid", async (req: Request, res: Response): Promise<void> => {
    const { btcTxid } = req.params;
    if (!TXID_RE.test(btcTxid)) {
      res.status(400).json({
        error: "invalid_txid",
        message: "btcTxid must be a 64-character hex string, in display byte order",
      });
      return;
    }
    if (deps.notConfiguredReason) {
      res.status(503).json({ error: "lending_not_configured", message: deps.notConfiguredReason });
      return;
    }

    const normalized = btcTxid.toLowerCase();
    try {
      const timeline = await cache.getOrCompute(normalized, async () => ({
        value: await computeTimeline(deps, normalized),
        ttlMs: TIMELINE_TTL_MS,
      }));
      res.json(timeline);
    } catch (err) {
      if (err instanceof PositionNotFoundError) {
        res.status(404).json({
          error: "position_not_found",
          message: "writz-lend has no position for this Bitcoin transaction; GET /deposit-status/:txid follows a deposit until it is verified",
        });
        return;
      }
      if (err instanceof StellarUnavailableError) {
        res.setHeader("Retry-After", String(UPSTREAM_RETRY_AFTER_SECONDS));
        res.status(503).json({
          error: "stellar_unavailable",
          message: `Could not read writz-lend from Stellar RPC; retry shortly (${message(err)})`,
          retryAfterSeconds: UPSTREAM_RETRY_AFTER_SECONDS,
        });
        return;
      }
      res.status(502).json({ error: "upstream_error", message: message(err) });
    }
  });

  return router;
}
