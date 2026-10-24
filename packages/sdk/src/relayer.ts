import { RelayerError } from "./errors.js";
import type { EarnPosition, NetworkPreset, SpvProof } from "./types.js";

/** The part of `fetch` this client uses. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface RelayerClientOptions {
  /** Defaults to the preset's relayer. */
  network?: NetworkPreset;
  /** Overrides `network.relayerUrl`. */
  relayerUrl?: string;
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /**
   * How many times a request that the relayer marked as retryable (409
   * `light_client_behind`, 429, 503) is retried after waiting its
   * `Retry-After`. Default 2; 0 turns retries off.
   */
  maxRetries?: number;
  /** A `Retry-After` longer than this is not waited for; the error is thrown instead. Default 120. */
  maxRetryWaitSeconds?: number;
  /** For tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface GetSpvProofOptions {
  /** Minimum confirmations, 1 to 20. Default 6. */
  confirmations?: number;
  /** Overrides the client's `maxRetries` for this call. */
  maxRetries?: number;
}

/**
 * Client for the Writz relayer: proofs for `bitcoin-spv` and the Earn vault
 * routes. Works in browsers, Node and Bun (CORS is open).
 */
export class RelayerClient {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly maxRetries: number;
  private readonly maxRetryWaitSeconds: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: RelayerClientOptions = {}) {
    const url = opts.relayerUrl ?? opts.network?.relayerUrl;
    if (!url) throw new TypeError("RelayerClient needs a network preset or a relayerUrl");
    let base = url;
    while (base.endsWith("/")) base = base.slice(0, -1);
    this.baseUrl = base;
    this.fetchImpl = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.maxRetries = opts.maxRetries ?? 2;
    this.maxRetryWaitSeconds = opts.maxRetryWaitSeconds ?? 120;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /**
   * A ready-made proof for a confirmed signet transaction. `txid` is in
   * display order (as explorers show it). Pass `proof.sorobanArgs` to
   * `BitcoinSpvClient.verifyTransaction` unchanged.
   *
   * Throws `RelayerError`. A 409 `light_client_behind`, 429 or 503 is
   * retried after its `Retry-After`, up to `maxRetries` times.
   */
  async getSpvProof(txid: string, opts: GetSpvProofOptions = {}): Promise<SpvProof> {
    const q = opts.confirmations === undefined ? "" : `?confirmations=${opts.confirmations}`;
    return (await this.request("GET", `/spv-proof/${txid.toLowerCase()}${q}`, undefined, opts.maxRetries)) as SpvProof;
  }

  /** Earn vault APY as a fraction (0.0731 is 7.31%). */
  async getEarnApy(): Promise<number> {
    const body = (await this.request("GET", "/defindex/apy")) as { apy: number };
    return body.apy;
  }

  /** A Stellar account's Earn vault position. */
  async getEarnPosition(address: string): Promise<EarnPosition> {
    const body = (await this.request("GET", `/defindex/position?address=${encodeURIComponent(address)}`)) as {
      dfTokens: string;
      underlyingStroops: string;
    };
    return { dfTokens: BigInt(body.dfTokens), underlyingStroops: BigInt(body.underlyingStroops) };
  }

  /**
   * An unsigned Earn deposit for `caller` (base64 XDR). The relayer never
   * signs: the caller's wallet signs and submits it. `amountStroops` is USDC
   * with 7 decimals.
   */
  async buildEarnDeposit(caller: string, amountStroops: bigint): Promise<string> {
    return this.buildEarn("/defindex/deposit", caller, amountStroops);
  }

  /** An unsigned Earn withdrawal of `amountStroops` of USDC for `caller` (base64 XDR). */
  async buildEarnWithdraw(caller: string, amountStroops: bigint): Promise<string> {
    return this.buildEarn("/defindex/withdraw", caller, amountStroops);
  }

  private async buildEarn(path: string, caller: string, amountStroops: bigint): Promise<string> {
    if (amountStroops <= 0n) throw new RangeError("amountStroops must be positive");
    const body = (await this.request("POST", path, { caller, amountStroops: amountStroops.toString() })) as {
      xdr: string;
    };
    return body.xdr;
  }

  private async request(method: "GET" | "POST", path: string, json?: unknown, maxRetries = this.maxRetries): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers: json === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
          body: json === undefined ? undefined : JSON.stringify(json),
        });
      } catch (err) {
        throw new RelayerError(
          `relayer request failed: ${err instanceof Error ? err.message : String(err)}`,
          0,
          "network_error",
          undefined,
          undefined,
        );
      }
      const text = await res.text();
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = text;
      }
      if (res.ok) return body;

      const err = toRelayerError(res, body);
      const wait = err.retryAfterSeconds;
      if (wait === undefined || attempt >= maxRetries || wait > this.maxRetryWaitSeconds) throw err;
      await this.sleep(wait * 1000);
    }
  }
}

function toRelayerError(res: Response, body: unknown): RelayerError {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const code = typeof b.error === "string" && /^[a-z_]+$/.test(b.error) ? b.error : "http_error";
  const message = typeof b.message === "string" ? b.message : typeof b.error === "string" ? b.error : res.statusText;
  let retryAfterSeconds: number | undefined;
  if (typeof b.retryAfterSeconds === "number") {
    retryAfterSeconds = b.retryAfterSeconds;
  } else {
    const header = res.headers.get("retry-after");
    const n = header === null ? NaN : Number(header);
    if (Number.isFinite(n) && n >= 0) retryAfterSeconds = n;
  }
  return new RelayerError(`relayer ${res.status} ${code}: ${message}`, res.status, code, retryAfterSeconds, body);
}
