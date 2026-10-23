import type { StatusSource } from "@/lib/status/source";
import type { MockPosition, MockWorld } from "./types";

const answer = <T>(value: T | undefined, what: string): Promise<T> =>
  value === undefined ? Promise.reject(new Error(`mock: no ${what}`)) : Promise.resolve(value);

/**
 * A `StatusSource` that answers from a scenario's fixtures, so the mock
 * harness runs the same read and derive path as the real one. A read the
 * fixture leaves out rejects, like a failed request.
 */
export function mockStatusSource(world: MockWorld): StatusSource {
  const byTxid = (txid: string): Promise<MockPosition> => {
    const hit = world.positions.find((p) => (p.local.position?.txid ?? p.local.pendingDeposit?.btcTxid) === txid);
    return hit ? Promise.resolve(hit) : Promise.reject(new Error(`mock: no position for ${txid}`));
  };
  const relayerOf = (p: MockPosition) => (world.globals.relayerUnreachable ? null : p.relayer);
  const rpc = <T>(read: () => Promise<T>): Promise<T> =>
    world.globals.rpcUnreachable ? Promise.reject(new Error("mock: Stellar RPC unreachable")) : read();

  return {
    getPosition: (txid) => rpc(async () => answer((await byTxid(txid)).chain.position, "position")),
    hasReleasePsbt: (txid) => rpc(async () => answer((await byTxid(txid)).chain.releasePsbtReady, "release")),
    getOraclePrice: () => answer(world.chain.oraclePriceStroops, "price"),
    getBtcTipHeight: () => answer(world.chain.btcTipHeight, "tip"),
    getBtcTx: async (txid) => answer((await byTxid(txid)).chain.depositTx, "deposit tx"),
    getOutspend: async (txid) => answer((await byTxid(txid)).chain.lockOutspend, "outspend"),
    relayer: {
      async confirmations(txid) {
        const r = relayerOf(await byTxid(txid));
        const confirmations = await answer(r?.confirmations, "confirmations");
        return { confirmations, minConfirmations: r?.minConfirmations };
      },
      liquidation: async (txid) => answer(relayerOf(await byTxid(txid))?.liquidation, "liquidation"),
    },
  };
}
