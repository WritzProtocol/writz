import { toHex32, type StatusSource } from "@/lib/status/source";
import type { MockPosition, MockWorld } from "./types";

const answer = <T>(value: T | undefined, what: string): Promise<T> =>
  value === undefined ? Promise.reject(new Error(`mock: no ${what}`)) : Promise.resolve(value);

/**
 * A `StatusSource` that answers from a scenario's fixtures, so the mock
 * harness runs the same read and derive path as the real one. A read the
 * fixture leaves out rejects, like a failed request.
 */
export function mockStatusSource(world: MockWorld): StatusSource {
  const find = (match: (p: MockPosition) => boolean, what: string): Promise<MockPosition> => {
    const hit = world.positions.find(match);
    return hit ? Promise.resolve(hit) : Promise.reject(new Error(`mock: no position for ${what}`));
  };
  const byTxid = (txid: string) =>
    find((p) => (p.local.position?.txid ?? p.local.pendingDeposit?.btcTxid) === txid, txid);
  const byCommitment = (hex: string) =>
    find(
      (p) =>
        p.chain.commitmentForTxid === hex ||
        [p.local.position?.commitment, p.local.pendingDeposit?.commitment].some((c) => c && toHex32(c) === hex),
      hex,
    );
  const byNullifier = (hex: string) =>
    find((p) => Boolean(p.local.position && toHex32(p.local.position.nullifier) === hex), hex);
  const relayerOf = (p: MockPosition) => (world.globals.relayerUnreachable ? null : p.relayer);
  const rpc = <T>(read: () => Promise<T>): Promise<T> =>
    world.globals.rpcUnreachable ? Promise.reject(new Error("mock: Stellar RPC unreachable")) : read();

  return {
    getCommitmentForTxid: (txid) =>
      rpc(async () => answer((await byTxid(txid)).chain.commitmentForTxid, "commitment")),
    isCommitmentPending: (hex) =>
      rpc(async () => answer((await byCommitment(hex)).chain.commitmentPending, "pending flag")),
    isNullifierSpent: (hex) => rpc(async () => answer((await byNullifier(hex)).chain.nullifierSpent, "nullifier")),
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
      liquidation: async (hex) => answer(relayerOf(await byNullifier(hex))?.liquidation, "liquidation"),
      catchingUp: async (hex) => {
        if (world.globals.relayerCatchingUp) return true;
        return answer(relayerOf(await byCommitment(hex))?.catchingUp, "catching up");
      },
    },
  };
}
