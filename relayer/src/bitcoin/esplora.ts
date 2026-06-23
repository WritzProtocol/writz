/**
 * Blockstream Esplora API client.
 *
 * All endpoints are stateless GET requests. No API key is required.
 * Rate limits: ~10 req/s on mainnet, more permissive on testnet.
 *
 * Byte-order note:
 *   Esplora displays txids and block hashes in REVERSED (display) byte order,
 *   consistent with block explorers. The raw 80-byte block header returned by
 *   /block/{hash}/header is in native binary format — no reversal needed.
 *   The merkle proof sibling hashes returned by /tx/{txid}/merkle-proof are
 *   in INTERNAL byte order (suitable for direct use in SHA256d computation).
 */

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

export interface MerkleProofResponse {
  block_height: number;
  merkle: string[]; // sibling hashes in internal byte order, leaf → root
  pos: number;      // 0-based index of the transaction in the block
}

/** Thin wrapper that adds timeout and basic error normalisation. */
async function get(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new EsploraError(res.status, url, body);
    }
    return res.text();
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

export class EsploraClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number = 10_000
  ) {}

  /** Fetches transaction metadata including confirmation status. */
  async getTxInfo(txid: string): Promise<TxInfo> {
    const body = await get(`${this.baseUrl}/tx/${txid}`, this.timeoutMs);
    const parsed = JSON.parse(body) as { txid: string; status: TxStatus };
    return { txid: parsed.txid, status: parsed.status };
  }

  /**
   * Fetches the full raw transaction bytes as a hex string.
   *
   * For SegWit transactions this includes the witness data. Use
   * `stripWitness()` from `./tx` before computing the txid.
   */
  async getRawTx(txid: string): Promise<string> {
    const url = `${this.baseUrl}/tx/${txid}/raw`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new EsploraError(res.status, url, body);
      }
      const arrayBuf = await res.arrayBuffer();
      return Buffer.from(arrayBuf).toString("hex");
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fetches the Merkle inclusion proof for a transaction.
   *
   * Returns the sibling hashes (in internal byte order) and the 0-based
   * index of the transaction in its block.
   */
  async getMerkleProof(txid: string): Promise<MerkleProofResponse> {
    const body = await get(`${this.baseUrl}/tx/${txid}/merkle-proof`, this.timeoutMs);
    return JSON.parse(body) as MerkleProofResponse;
  }

  /**
   * Returns the block hash (display/reversed hex) at the given block height.
   */
  async getBlockHashAtHeight(height: number): Promise<string> {
    return get(`${this.baseUrl}/block-height/${height}`, this.timeoutMs);
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
    return get(`${this.baseUrl}/block/${blockHash}/header`, this.timeoutMs);
  }

  /** Returns the current tip block height. */
  async getTipHeight(): Promise<number> {
    const body = await get(`${this.baseUrl}/blocks/tip/height`, this.timeoutMs);
    return parseInt(body.trim(), 10);
  }
}
