import { rpc, xdr } from "@stellar/stellar-sdk";
import { config } from "@/config";
import { getBtcPriceStroops } from "@/lib/contracts/oracle";
import { getReleasePsbt, internalTxid, readPosition, writzLendId } from "@/lib/contracts/writzLend";
import type { RelayerSource, StatusSource } from "./source";
import type { BtcTxView, LiquidationLookup, Outspend } from "./types";

type Fetch = (url: string) => Promise<Response>;

/** The slice of `rpc.Server` the liquidation fallback needs. */
export interface LiquidationEventsServer {
  getHealth(): Promise<{ oldestLedger: number }>;
  getEvents(request: {
    startLedger: number;
    filters: { type: "contract"; contractIds: string[]; topics: string[][] }[];
  }): Promise<{ events: { txHash: string }[]; oldestLedgerCloseTime: string }>;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function esploraReads(apiUrl: string, get: Fetch) {
  return {
    async getBtcTipHeight(): Promise<number> {
      const res = await get(`${apiUrl}/blocks/tip/height`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const height = parseInt(await res.text(), 10);
      if (!Number.isFinite(height)) throw new Error("Bad tip height");
      return height;
    },
    async getBtcTx(txid: string): Promise<BtcTxView> {
      const res = await get(`${apiUrl}/tx/${txid}/status`);
      if (res.status === 404) return { seen: false };
      const s = await json<{ confirmed: boolean; block_height?: number }>(res);
      return { seen: true, blockHeight: s.confirmed ? (s.block_height ?? null) : null };
    },
    async getOutspend(txid: string, vout: number): Promise<Outspend> {
      const o = await json<{ spent: boolean; txid?: string; status?: { confirmed: boolean } }>(
        await get(`${apiUrl}/tx/${txid}/outspend/${vout}`),
      );
      if (!o.spent || !o.txid) return { spent: false };
      return { spent: true, txid: o.txid, confirmed: o.status?.confirmed ?? false };
    },
  };
}

function closeTimeMs(t: string): number {
  return /^\d+$/.test(t) ? Number(t) * 1000 : Date.parse(t);
}

/**
 * Client fallback until the relayer indexes Liquidate events and serves
 * `/status`: SPV-proof polling for confirmations and RPC events (retention
 * window only) for the transaction that liquidated a position.
 */
export function clientRelayerSource(deps: {
  relayerUrl: string;
  get: Fetch;
  server: () => LiquidationEventsServer;
  contractId: () => string;
}): RelayerSource {
  const relayer = () => {
    if (!deps.relayerUrl) throw new Error("NEXT_PUBLIC_RELAYER_URL is not configured");
    return deps.relayerUrl;
  };

  return {
    async confirmations(btcTxid) {
      const res = await deps.get(`${relayer()}/spv-proof/${btcTxid}`);
      if (res.status === 404) return { confirmations: 0 };
      if (res.status === 409) {
        const body = (await res.json()) as { available?: number; requested?: number };
        return { confirmations: body.available ?? 0, minConfirmations: body.requested };
      }
      const bundle = await json<{ confirmations: number }>(res);
      return { confirmations: bundle.confirmations };
    },

    async liquidation(btcTxid, since): Promise<LiquidationLookup> {
      const server = deps.server();
      const { oldestLedger } = await server.getHealth();
      // `writz-lend`'s LiquidateEvent: topics ["liquidate", txid], the txid in internal byte order.
      const topics = [
        [
          xdr.ScVal.scvSymbol("liquidate").toXDR("base64"),
          xdr.ScVal.scvBytes(internalTxid(btcTxid)).toXDR("base64"),
        ],
      ];
      const res = await server.getEvents({
        startLedger: oldestLedger,
        filters: [{ type: "contract", contractIds: [deps.contractId()], topics }],
      });
      const hit = res.events[0];
      if (hit) return { found: true, txHash: hit.txHash };
      return { found: false, complete: since >= closeTimeMs(res.oldestLedgerCloseTime) };
    },
  };
}

/** Today's reads: `writz-lend`, the oracle, Esplora, and the client relayer fallbacks. */
export function createClientStatusSource(get: Fetch = (url) => fetch(url)): StatusSource {
  return {
    getPosition: readPosition,
    hasReleasePsbt: async (txid) => (await getReleasePsbt(txid)) !== null,
    getOraclePrice: getBtcPriceStroops,
    ...esploraReads(config.bitcoin.apiUrl, get),
    relayer: clientRelayerSource({
      relayerUrl: config.services.relayerUrl,
      get,
      server: () =>
        new rpc.Server(config.rpcUrl, {
          allowHttp: config.rpcUrl.startsWith("http://"),
        }) as unknown as LiquidationEventsServer,
      contractId: writzLendId,
    }),
  };
}
