/**
 * Blockstream Esplora API client.
 *
 * Reads are stateless GET requests; `broadcastTx` is the one POST (the
 * Signet faucet's). No API key is required.
 * Rate limits: ~10 req/s on mainnet, more permissive on testnet.
 *
 * Byte-order note:
 *   Esplora displays txids and block hashes in REVERSED (display) byte order,
 *   consistent with block explorers. The raw 80-byte block header returned by
 *   /block/{hash}/header is in native binary format - no reversal needed.
 *   The merkle proof sibling hashes returned by /tx/{txid}/merkle-proof are
 *   in INTERNAL byte order (suitable for direct use in SHA256d computation).
 */

import { withBackoff } from "./header-sync.js";

export interface TxStatus {
  confirmed: boolean;
  block_height: number | null;
  block_hash: string | null;
  block_time: number | null;
}

export interface TxInfo {
  txid: string;
  status: TxStatus;
}

/** A transaction with its outputs' scriptPubKeys, from `/tx/:txid`. */
export interface TxWithOutputs extends TxInfo {
  vout: { scriptpubkey: string; value: number }[];
}

/** Whether one output is spent, and by which transaction, from `/tx/:txid/outspends`. */
export interface Outspend {
  spent: boolean;
  txid?: string;
  vin?: number;
  status?: TxStatus;
}

/** One output of `/address/:address/utxo`, mempool included. */
export interface AddressUtxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean; block_height?: number };
}

export interface MerkleProofResponse {
  block_height: number;
  merkle: string[]; // sibling hashes in internal byte order, leaf → root
  pos: number;      // 0-based index of the transaction in the block
}

/**
 * Fetches `url` with a timeout, throwing `EsploraError` on a non-2xx
 * response. Returns the raw `Response` so callers can read the body in
 * whichever form they need (text vs. arrayBuffer). Every client method goes
 * through this one copy of the fetch/timeout/error-handling block.
 */
async function fetchWithTimeout(url: string, timeoutMs: number, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new EsploraError(res.status, url, body);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export class EsploraError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string
  ) {
    super(`Esplora ${status} at ${url}: ${body.slice(0, 120)}`);
    this.name = "EsploraError";
  }
}

/**
 * True for a failure that says the upstream is unavailable rather than that
 * the request was wrong: a 429 or 5xx answer, a network error, or a timeout.
 * Retrying (or asking another Esplora instance) can fix these; a 404 or a
 * malformed body cannot.
 */
export function isUpstreamUnavailable(e: unknown): boolean {
  if (e instanceof EsploraError) return e.status === 429 || e.status >= 500;
  return e instanceof Error && (e.name === "AbortError" || e.name === "TypeError");
}

/** Same as `isUpstreamUnavailable`, minus timeouts: retrying a request that
 * already waited the full timeout on the same host only multiplies latency. */
function isRetryableOnSameHost(e: unknown): boolean {
  return isUpstreamUnavailable(e) && !(e instanceof Error && e.name === "AbortError");
}

export interface EsploraClientOptions {
  /** Retries per host on 429, 5xx and network errors (default 0: no retry). */
  retries?: number;
  /** First backoff delay; doubles on each retry (default 250 ms). */
  retryBaseDelayMs?: number;
  /** A second Esplora instance tried once the primary is unavailable. It
   * must serve the same Esplora REST API for the same network. */
  fallbackBaseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
}

export class EsploraClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number = 10_000,
    private readonly options: EsploraClientOptions = {}
  ) {}

  /**
   * Runs one request against the primary host with backoff, then against the
   * fallback host if the primary is unavailable. Defaults (no retry, no
   * fallback) make this a single plain request, which is what the header
   * sync wants: it already wraps every call in its own backoff.
   */
  private async request<T>(path: string, read: (res: Response) => Promise<T>, init?: RequestInit): Promise<T> {
    const { retries = 0, retryBaseDelayMs = 250, fallbackBaseUrl, sleep } = this.options;
    const hosts = fallbackBaseUrl ? [this.baseUrl, fallbackBaseUrl] : [this.baseUrl];
    let lastError: unknown;
    for (const host of hosts) {
      try {
        return await withBackoff(
          async () => read(await fetchWithTimeout(`${host}${path}`, this.timeoutMs, init)),
          isRetryableOnSameHost,
          { retries, baseDelayMs: retryBaseDelayMs, ...(sleep ? { sleep } : {}) },
        );
      } catch (e) {
        if (!isUpstreamUnavailable(e)) throw e;
        lastError = e;
      }
    }
    throw lastError;
  }

  /** Fetches transaction metadata including confirmation status. */
  async getTxInfo(txid: string): Promise<TxInfo> {
    const body = await this.request(`/tx/${txid}`, (r) => r.text());
    const parsed = JSON.parse(body) as { txid: string; status: TxStatus };
    return { txid: parsed.txid, status: parsed.status };
  }

  /** Fetches the transaction's status and outputs. */
  async getTxWithOutputs(txid: string): Promise<TxWithOutputs> {
    const body = await this.request(`/tx/${txid}`, (r) => r.text());
    const parsed = JSON.parse(body) as TxWithOutputs;
    return { txid: parsed.txid, status: parsed.status, vout: parsed.vout.map((o) => ({ scriptpubkey: o.scriptpubkey, value: o.value })) };
  }

  /** Spending status of every output of the transaction, in output order. */
  async getOutspends(txid: string): Promise<Outspend[]> {
    const body = await this.request(`/tx/${txid}/outspends`, (r) => r.text());
    const parsed = JSON.parse(body) as unknown;
    if (!Array.isArray(parsed)) throw new Error(`getOutspends: expected an array, got: ${body.slice(0, 200)}`);
    return parsed as Outspend[];
  }

  /**
   * Fetches the full raw transaction bytes as a hex string.
   *
   * For SegWit transactions this includes the witness data. Use
   * `stripWitness()` from `./tx` before computing the txid.
   */
  async getRawTx(txid: string): Promise<string> {
    const arrayBuf = await this.request(`/tx/${txid}/raw`, (r) => r.arrayBuffer());
    return Buffer.from(arrayBuf).toString("hex");
  }

  /**
   * Fetches the Merkle inclusion proof for a transaction.
   *
   * Returns the sibling hashes (in internal byte order) and the 0-based
   * index of the transaction in its block.
   */
  async getMerkleProof(txid: string): Promise<MerkleProofResponse> {
    const body = await this.request(`/tx/${txid}/merkle-proof`, (r) => r.text());
    return JSON.parse(body) as MerkleProofResponse;
  }

  /**
   * Returns the block hash (display/reversed hex) at the given block height.
   */
  async getBlockHashAtHeight(height: number): Promise<string> {
    return this.request(`/block-height/${height}`, (r) => r.text());
  }

  /**
   * Returns the raw 80-byte block header as a hex string.
   *
   * The header is in native Bitcoin binary format (no byte reversal):
   *   bytes 0–3:   version (LE i32)
   *   bytes 4–35:  prev_block_hash (internal byte order)
   *   bytes 36–67: merkle_root    (internal byte order)
   *   bytes 68–71: time           (LE u32)
   *   bytes 72–75: bits           (compact difficulty)
   *   bytes 76–79: nonce          (LE u32)
   */
  async getBlockHeader(blockHash: string): Promise<string> {
    return this.request(`/block/${blockHash}/header`, (r) => r.text());
  }

  /** Returns the current tip block height. */
  async getTipHeight(): Promise<number> {
    const body = await this.request(`/blocks/tip/height`, (r) => r.text());
    const height = parseInt(body.trim(), 10);
    if (Number.isNaN(height)) {
      // A malformed response (e.g. an HTML error page from a misconfigured
      // proxy in front of the Esplora instance) would otherwise silently
      // propagate NaN into downstream height arithmetic instead of failing
      // loudly here, where the actual bad response body is still available.
      throw new Error(`getTipHeight: could not parse a block height from response: ${body.slice(0, 200)}`);
    }
    return height;
  }

  /** Unspent outputs of `address`, confirmed and in the mempool. */
  async getAddressUtxos(address: string): Promise<AddressUtxo[]> {
    const body = await this.request(`/address/${encodeURIComponent(address)}/utxo`, (r) => r.text());
    const parsed = JSON.parse(body) as unknown;
    if (!Array.isArray(parsed)) throw new Error(`getAddressUtxos: expected an array, got: ${body.slice(0, 200)}`);
    return parsed as AddressUtxo[];
  }

  /**
   * Fee estimates in sat/vbyte, keyed by confirmation target in blocks
   * (`{ "1": 2.1, "6": 1.0, ... }`).
   */
  async getFeeEstimates(): Promise<Record<string, number>> {
    const body = await this.request(`/fee-estimates`, (r) => r.text());
    return JSON.parse(body) as Record<string, number>;
  }

  /**
   * Broadcasts a raw transaction and returns its txid. Rebroadcasting a
   * transaction the node already has is harmless, so the fallback host may be
   * tried after an unavailable primary.
   */
  async broadcastTx(txHex: string): Promise<string> {
    const body = await this.request(`/tx`, (r) => r.text(), {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: txHex,
    });
    return body.trim();
  }
}
