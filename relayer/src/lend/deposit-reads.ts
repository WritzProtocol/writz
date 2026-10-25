/**
 * Reads `writz-lend` deposit state from Stellar for GET /deposit-status.
 *
 * Two questions, each answered from the chain rather than inferred:
 *
 *   - How many Bitcoin confirmations does this deployment require? That is
 *     `Config::min_confirmations`, read from the contract's persistent
 *     storage. The contract has no getter for its config, and the constructor
 *     is the only writer of that field, so one read per process is enough.
 *
 *   - Has a Stellar transaction registered this deposit, and which one? A
 *     `deposit` event is published only by a successful `deposit` call, with
 *     the Bitcoin txid (internal byte order) as its second topic. Stellar RPC
 *     keeps events for a rolling window (about 7 days on testnet), so a
 *     deposit older than that has no event left; its `Position` entry still
 *     proves it was registered, and that is reported without a hash rather
 *     than not at all.
 *
 * Stellar RPC scans at most 10,000 ledgers per `getEvents` request, so a
 * one-shot search of the whole window is about a dozen sequential requests.
 * The index below does that walk once, then follows the tip from its cursor:
 * each later refresh is one request, shared by every caller in flight.
 *
 * Deliberately does not statically import `@stellar/stellar-sdk` at module
 * scope (see `../repay-watcher/poller.ts` for why).
 */

/** One `deposit` event: the Stellar transaction that registered a deposit. */
export interface DepositRecord {
  stellarTxHash: string;
  ledger: number;
  /** ISO 8601 close time of `ledger`. */
  ledgerClosedAt: string;
}

/** The subset of `rpc.Server` the index needs, so tests can pass a plain mock. */
export interface DepositEventsServer {
  getHealth(): Promise<{ oldestLedger: number; latestLedger: number }>;
  getEvents(
    request:
      | { filters: DepositEventFilter[]; startLedger: number; limit: number }
      | { filters: DepositEventFilter[]; cursor: string; limit: number },
  ): Promise<{
    events: { topic: unknown[]; txHash: string; ledger: number; ledgerClosedAt: string }[];
    cursor: string;
    latestLedger: number;
  }>;
}

export interface DepositEventFilter {
  type: "contract";
  contractIds: string[];
  topics: string[][];
}

const PAGE_LIMIT = 200;
/** Pages one refresh may walk; the next refresh continues from the cursor. */
const MAX_PAGES_PER_REFRESH = 20;

/** The ledger a `getEvents` cursor points at (the high 32 bits of its TOID). */
export function ledgerOfCursor(cursor: string): number {
  return Number(BigInt(cursor.split("-")[0]) >> 32n);
}

/** Decodes a `deposit` event's txid topic to internal-order hex; undefined for any other shape. */
export function decodeDepositTxid(topic: unknown[]): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { scValToNative } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  if (topic.length < 2) return undefined;
  if (scValToNative(topic[0] as never) !== "deposit") return undefined;
  const txid = scValToNative(topic[1] as never) as unknown;
  return txid instanceof Uint8Array && txid.length === 32 ? Buffer.from(txid).toString("hex") : undefined;
}

function depositTopicFilter(contractId: string): DepositEventFilter {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { xdr } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  return {
    type: "contract",
    contractIds: [contractId],
    topics: [[xdr.ScVal.scvSymbol("deposit").toXDR("base64"), "*"]],
  };
}

export interface DepositIndexOptions {
  server: DepositEventsServer;
  contractId: string;
  /** A refresh younger than this is reused instead of asking the RPC again. */
  freshForMs: number;
  now?: () => number;
  /** Defaults to the real `deposit` topic filter and XDR decoding. */
  filter?: DepositEventFilter;
  decodeTxid?: (topic: unknown[]) => string | undefined;
}

/**
 * In-memory index of `writz-lend` deposit events, keyed by the Bitcoin txid in
 * internal byte order. Per process like the proof cache; a restart rebuilds it
 * from the RPC's retention window (the route warms it at boot).
 */
export class DepositIndex {
  private readonly records = new Map<string, DepositRecord>();
  private cursor: string | null = null;
  private refreshedAt = -Infinity;
  private inflight: Promise<void> | null = null;
  private readonly now: () => number;
  private readonly decodeTxid: (topic: unknown[]) => string | undefined;
  private filterValue: DepositEventFilter | undefined;

  constructor(private readonly options: DepositIndexOptions) {
    this.now = options.now ?? Date.now;
    this.decodeTxid = options.decodeTxid ?? decodeDepositTxid;
    this.filterValue = options.filter;
  }

  /** The record for `txidInternal`, after bringing the index up to the tip. */
  async lookup(txidInternal: string): Promise<DepositRecord | undefined> {
    await this.refresh();
    return this.records.get(txidInternal.toLowerCase());
  }

  /**
   * Coalesced: concurrent callers share one walk, and a fresh one is reused.
   * `force` skips the freshness check and, if a walk is already running,
   * runs one more after it, since that walk may have started before the
   * event the caller is looking for.
   */
  async refresh(force = false): Promise<void> {
    if (!force && this.now() - this.refreshedAt < this.options.freshForMs) return;
    if (this.inflight) {
      await this.inflight;
      if (!force) return;
    }
    this.inflight ??= this.walk()
      .then(() => {
        this.refreshedAt = this.now();
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private filter(): DepositEventFilter {
    this.filterValue ??= depositTopicFilter(this.options.contractId);
    return this.filterValue;
  }

  private async walk(): Promise<void> {
    const filters = [this.filter()];
    for (let page = 0; page < MAX_PAGES_PER_REFRESH; page++) {
      let res: Awaited<ReturnType<DepositEventsServer["getEvents"]>>;
      if (this.cursor) {
        try {
          res = await this.options.server.getEvents({ filters, cursor: this.cursor, limit: PAGE_LIMIT });
        } catch (e) {
          // A cursor that has fallen out of the retention window (a relayer
          // idle for longer than it) is rejected; restart from the oldest
          // retained ledger. Records already indexed stay, they are final.
          const { oldestLedger } = await this.options.server.getHealth();
          if (ledgerOfCursor(this.cursor) >= oldestLedger) throw e;
          this.cursor = null;
          continue;
        }
      } else {
        const { oldestLedger } = await this.options.server.getHealth();
        res = await this.options.server.getEvents({ filters, startLedger: oldestLedger, limit: PAGE_LIMIT });
      }

      for (const event of res.events) {
        const txid = this.decodeTxid(event.topic);
        if (!txid) continue;
        this.records.set(txid, {
          stellarTxHash: event.txHash,
          ledger: event.ledger,
          ledgerClosedAt: event.ledgerClosedAt,
        });
      }
      this.cursor = res.cursor;
      // A page that is not full ends at the last ledger it scanned; once that
      // is the RPC's latest ledger, the index is at the tip. A full page ends
      // at its last event, so there may be more in the same range.
      if (res.events.length < PAGE_LIMIT && ledgerOfCursor(res.cursor) >= res.latestLedger) return;
    }
  }
}

/** The subset of `rpc.Server` the storage reads need. */
export interface LedgerEntriesServer {
  getLedgerEntries(...keys: unknown[]): Promise<{ entries: { val: unknown }[] }>;
}

function persistentKey(contractId: string, key: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Address, xdr } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(contractId).toScAddress(),
      key: key as import("@stellar/stellar-sdk").xdr.ScVal,
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

async function readPersistent(server: LedgerEntriesServer, contractId: string, key: unknown): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { scValToNative } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  const res = await server.getLedgerEntries(persistentKey(contractId, key));
  const entry = res.entries[0] as { val: import("@stellar/stellar-sdk").xdr.LedgerEntryData } | undefined;
  return entry ? scValToNative(entry.val.contractData().val()) : undefined;
}

/** `Config::min_confirmations` of the `writz-lend` deployment. */
export async function readMinConfirmations(server: LedgerEntriesServer, contractId: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { xdr } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  const config = (await readPersistent(server, contractId, xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Config")]))) as
    | { min_confirmations?: unknown }
    | undefined;
  const value = config?.min_confirmations;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`writz-lend ${contractId} has no readable Config::min_confirmations on this network`);
  }
  return value;
}

/** True when `writz-lend` holds a `Position` for this txid (internal byte order). */
export async function positionExists(
  server: LedgerEntriesServer,
  contractId: string,
  txidInternal: string,
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { xdr } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  const key = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Position"), xdr.ScVal.scvBytes(Buffer.from(txidInternal, "hex"))]);
  return (await readPersistent(server, contractId, key)) !== undefined;
}
