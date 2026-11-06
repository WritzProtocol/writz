import { config } from "@/config";

// Esplora answers only feed the screens (the light client proves Bitcoin state on chain),
// so serving them from whichever public provider answers changes no trust.

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface EsploraClientOptions {
  /** Request URLs are written against the first. */
  providers: string[];
  /** Per-attempt timeout. */
  timeoutMs?: number;
  tipTtlMs?: number;
  fetch?: Fetch;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_TIP_TTL_MS = 10_000;
const TIP_PATH = "/blocks/tip/height";

const retryable = (res: Response) => res.status === 429 || res.status >= 500;

export function createEsploraFetch(opts: EsploraClientOptions): Fetch {
  const providers = [...new Set(opts.providers.filter(Boolean))];
  const base = providers[0] ?? "";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tipTtlMs = opts.tipTtlMs ?? DEFAULT_TIP_TTL_MS;
  const doFetch: Fetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const now = opts.now ?? Date.now;

  // A blocked host should cost one timeout, not one per request.
  let healthy = 0;
  const inFlight = new Map<string, Promise<Response>>();
  let tip: { at: number; res: Promise<Response> } | null = null;

  async function attempt(path: string, init?: RequestInit): Promise<Response> {
    let lastError: unknown = new Error("No Esplora provider configured");
    for (let i = 0; i < providers.length; i++) {
      const idx = (healthy + i) % providers.length;
      const signal = init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs);
      try {
        const res = await doFetch(providers[idx] + path, { ...init, signal });
        if (retryable(res) && i < providers.length - 1) {
          lastError = new Error(`HTTP ${res.status}`);
          continue;
        }
        healthy = idx;
        return res;
      } catch (e) {
        if (init?.signal?.aborted) throw e;
        lastError = e;
      }
    }
    throw lastError;
  }

  function shared(key: string, run: () => Promise<Response>): Promise<Response> {
    const pending = inFlight.get(key);
    if (pending) return pending.then((r) => r.clone());
    const p = run().finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p.then((r) => r.clone());
  }

  return (url, init) => {
    if (!base || !url.startsWith(base)) return doFetch(url, init);
    const path = url.slice(base.length);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET" || init?.signal) return attempt(path, init);
    if (path === TIP_PATH) {
      if (!tip || now() - tip.at > tipTtlMs) {
        const res = attempt(path).then((r) => {
          if (!r.ok) tip = null;
          return r;
        });
        res.catch(() => (tip = null));
        tip = { at: now(), res };
      }
      return tip.res.then((r) => r.clone());
    }
    return shared(path, () => attempt(path));
  };
}

const MEMPOOL_API = config.bitcoin.network === "mainnet" ? "https://mempool.space/api" : `https://mempool.space/${config.bitcoin.network}/api`;

export const esploraFetch: Fetch = createEsploraFetch({
  providers: [config.bitcoin.apiUrl, config.bitcoin.fallbackApiUrl, MEMPOOL_API],
});
