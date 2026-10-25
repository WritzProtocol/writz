/**
 * Reads `writz-lend` position state from Stellar, for GET /deposit-status and
 * GET /timeline.
 *
 * Two questions, each answered from the chain rather than inferred:
 *
 *   - How many Bitcoin confirmations does this deployment require? That is
 *     `Config::min_confirmations`, read from the contract's persistent
 *     storage. The contract has no getter for its config, and the constructor
 *     is the only writer of that field, so one read per process is enough.
 *
 *   - Which Stellar transactions acted on this position? `deposit`, `borrow`,
 *     `repay`, `repay_full` and `liquidate` events are published only by a
 *     successful call, each with the Bitcoin txid (internal byte order) as its
 *     second topic. Stellar RPC keeps events for a rolling window (about 7
 *     days on testnet), so a position older than that has no events left; its
 *     `Position` entry still proves it was registered, and that is reported
 *     without a hash rather than not at all.
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

/** The writz-lend events that name a position, by their first topic. */
export const POSITION_EVENT_KINDS = ["deposit", "borrow", "repay", "repay_full", "liquidate"] as const;
export type PositionEventKind = (typeof POSITION_EVENT_KINDS)[number];

/** What a position event says, decoded from its topics and data. */
export interface DecodedPositionEvent {
  kind: PositionEventKind;
  /** Bitcoin txid, internal byte order. */
  txid: string;
  /** `borrower` of a borrow, `repayer` of a full repay, `keeper` of a liquidation. */
  account?: string;
  /** USDC stroops of a borrow or a partial repay. */
  amount?: string;
}

/** One position event and the Stellar transaction that emitted it. */
export interface PositionEventRecord extends DecodedPositionEvent, DepositRecord {}

/** The subset of `rpc.Server` the index needs, so tests can pass a plain mock. */
export interface DepositEventsServer {
  getHealth(): Promise<{ oldestLedger: number; latestLedger: number }>;
  getEvents(
    request:
      | { filters: DepositEventFilter[]; startLedger: number; limit: number }
      | { filters: DepositEventFilter[]; cursor: string; limit: number },
  ): Promise<{
    events: { topic: unknown[]; value?: unknown; txHash: string; ledger: number; ledgerClosedAt: string }[];
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
  const decoded = decodePositionEvent({ topic });
  return decoded?.kind === "deposit" ? decoded.txid : undefined;
}

/**
 * Decodes a writz-lend position event: the kind and txid from its topics,
 * and from its data (a map, the `contractevent` default) the account and
 * amount the timeline shows. Undefined for any other event or shape.
 */
export function decodePositionEvent(event: { topic: unknown[]; value?: unknown }): DecodedPositionEvent | undefined {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { scValToNative } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  const { topic } = event;
  if (topic.length < 2) return undefined;
  const kind = scValToNative(topic[0] as never) as unknown;
  if (typeof kind !== "string" || !(POSITION_EVENT_KINDS as readonly string[]).includes(kind)) return undefined;
  const txid = scValToNative(topic[1] as never) as unknown;
  if (!(txid instanceof Uint8Array) || txid.length !== 32) return undefined;
  const out: DecodedPositionEvent = { kind: kind as PositionEventKind, txid: Buffer.from(txid).toString("hex") };
  if (event.value === undefined) return out;
  const data = scValToNative(event.value as never) as Record<string, unknown> | null;
  if (!data || typeof data !== "object") return out;
  const account = data.borrower ?? data.repayer ?? data.keeper;
  if (typeof account === "string") out.account = account;
  if (typeof data.usdc_amount === "bigint") out.amount = data.usdc_amount.toString();
  return out;
}

function positionEventsFilter(contractId: string): DepositEventFilter {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { xdr } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  return {
    type: "contract",
    contractIds: [contractId],
    // One topic filter per kind, five in all, the most one filter may hold.
    topics: POSITION_EVENT_KINDS.map((kind) => [xdr.ScVal.scvSymbol(kind).toXDR("base64"), "*"]),
  };
}

export interface PositionEventIndexOptions {
  server: DepositEventsServer;
  contractId: string;
  /** A refresh younger than this is reused instead of asking the RPC again. */
  freshForMs: number;
  now?: () => number;
  /** Defaults to the real position-event topic filter and XDR decoding. */
  filter?: DepositEventFilter;
  decode?: (event: { topic: unknown[]; value?: unknown }) => DecodedPositionEvent | undefined;
}

/**
 * In-memory index of `writz-lend` position events, keyed by the Bitcoin txid
 * in internal byte order. Per process like the proof cache; a restart
 * rebuilds it from the RPC's retention window (the routes warm it at boot).
 * GET /deposit-status reads the `deposit` event of a position, GET /timeline
 * all of them; both share one index, so one walk serves the two.
 */
export class PositionEventIndex {
  private readonly records = new Map<string, PositionEventRecord[]>();
  private cursor: string | null = null;
  private refreshedAt = -Infinity;
  private inflight: Promise<void> | null = null;
  private readonly now: () => number;
  private readonly decode: (event: { topic: unknown[]; value?: unknown }) => DecodedPositionEvent | undefined;
  private filterValue: DepositEventFilter | undefined;

  constructor(private readonly options: PositionEventIndexOptions) {
    this.now = options.now ?? Date.now;
    this.decode = options.decode ?? decodePositionEvent;
    this.filterValue = options.filter;
  }

  /** The `deposit` record for `txidInternal`, after bringing the index up to the tip. */
  async lookup(txidInternal: string): Promise<DepositRecord | undefined> {
    const deposit = (await this.history(txidInternal)).find((e) => e.kind === "deposit");
    return deposit
      ? { stellarTxHash: deposit.stellarTxHash, ledger: deposit.ledger, ledgerClosedAt: deposit.ledgerClosedAt }
      : undefined;
  }

  /** Every indexed event of the position, in ledger order, after bringing the index up to the tip. */
  async history(txidInternal: string): Promise<PositionEventRecord[]> {
    await this.refresh();
    return [...(this.records.get(txidInternal.toLowerCase()) ?? [])];
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
    this.filterValue ??= positionEventsFilter(this.options.contractId);
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
        const decoded = this.decode(event);
        if (!decoded) continue;
        const list = this.records.get(decoded.txid) ?? [];
        // A restart from the oldest retained ledger walks events it already
        // holds; a transaction emits at most one event per position.
        if (list.some((e) => e.kind === decoded.kind && e.stellarTxHash === event.txHash)) continue;
        list.push({ ...decoded, stellarTxHash: event.txHash, ledger: event.ledger, ledgerClosedAt: event.ledgerClosedAt });
        this.records.set(decoded.txid, list);
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

/** The fields of a writz-lend `Position` the timeline reads. */
export interface PositionSummary {
  /** The depositor's Stellar address; the only account that can borrow against it. */
  depositor: string;
  /** "Active", "Closed" or "Liquidated". */
  status: string;
  /** The deposit's 34-byte P2WSH scriptPubKey, hex: the output a release spends. */
  p2wshScriptPubkey: string;
}

/** The `Position` for this txid (internal byte order), or undefined when writz-lend holds none. */
export async function readPosition(
  server: LedgerEntriesServer,
  contractId: string,
  txidInternal: string,
): Promise<PositionSummary | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { xdr } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  const key = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Position"), xdr.ScVal.scvBytes(Buffer.from(txidInternal, "hex"))]);
  const pos = (await readPersistent(server, contractId, key)) as
    | { depositor?: unknown; status?: unknown; p2wsh_script_pubkey?: unknown }
    | undefined;
  if (!pos) return undefined;
  // A unit enum variant decodes as a one-element vector of its name.
  const status = Array.isArray(pos.status) ? pos.status[0] : pos.status;
  if (typeof pos.depositor !== "string" || !(pos.p2wsh_script_pubkey instanceof Uint8Array)) {
    throw new Error(`writz-lend ${contractId} holds a Position for ${txidInternal} in an unexpected shape`);
  }
  return {
    depositor: pos.depositor,
    status: typeof status === "string" ? status : "unknown",
    p2wshScriptPubkey: Buffer.from(pos.p2wsh_script_pubkey).toString("hex"),
  };
}

/** `Config::usdc_token` of the writz-lend deployment: the USDC a borrow pays out. */
export async function readUsdcToken(server: LedgerEntriesServer, contractId: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { xdr } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  const config = (await readPersistent(server, contractId, xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Config")]))) as
    | { usdc_token?: unknown }
    | undefined;
  if (typeof config?.usdc_token !== "string") {
    throw new Error(`writz-lend ${contractId} has no readable Config::usdc_token on this network`);
  }
  return config.usdc_token;
}
