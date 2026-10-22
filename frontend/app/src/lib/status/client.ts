import { rpc, xdr } from "@stellar/stellar-sdk";
import { config, requireContract } from "@/config";
import { getCommitmentForTxid, isCommitmentPending, isNullifierSpent } from "@/lib/contracts/commitmentTree";
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
 * `/status`: SPV-proof polling for confirmations, merkle-path 409 for catching
 * up, and RPC events (retention window only) for liquidations.
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

    async liquidation(nullifierHex, since): Promise<LiquidationLookup> {
      const server = deps.server();
      const { oldestLedger } = await server.getHealth();
      const topics = [
        [
          xdr.ScVal.scvSymbol("liquidate").toXDR("base64"),
          xdr.ScVal.scvBytes(Buffer.from(nullifierHex, "hex")).toXDR("base64"),
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

    async catchingUp(commitmentHex, leafIndex) {
      const qs = leafIndex === undefined ? "" : `&leafIndex=${leafIndex}`;
      const res = await deps.get(`${relayer()}/merkle-path?commitment=${commitmentHex}${qs}`);
      if (res.status === 409) return true;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return false;
    },
  };
}

/** Today's reads: contract, Esplora, and the client relayer fallbacks. */
export function createClientStatusSource(get: Fetch = (url) => fetch(url)): StatusSource {
  return {
    getCommitmentForTxid,
    isCommitmentPending,
    isNullifierSpent,
    // The contract's oracle is a stub with no getter; proofs must carry this same configured price.
    getOraclePrice: async () => BigInt(config.btcPriceStroops),
    ...esploraReads(config.bitcoin.apiUrl, get),
    relayer: clientRelayerSource({
      relayerUrl: config.services.relayerUrl,
      get,
      server: () =>
        new rpc.Server(config.rpcUrl, {
          allowHttp: config.rpcUrl.startsWith("http://"),
        }) as unknown as LiquidationEventsServer,
      contractId: () => requireContract(config.contracts.commitmentTree, "commitment-tree"),
    }),
  };
}
