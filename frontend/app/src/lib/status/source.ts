import type { ChainPosition } from "@/lib/contracts/writzLend";
import type {
  BtcTxView,
  ChainReads,
  LiquidationLookup,
  LocalInputs,
  Outspend,
  RelayerIndex,
  StatusInputs,
  StatusParams,
} from "./types";

/**
 * Relayer-indexed reads. The client fallback implements them
 * from today's endpoints and RPC; the relayer `/status` endpoints replace it
 * behind this same interface, with no screen changes.
 */
export interface RelayerSource {
  confirmations(btcTxid: string): Promise<{ confirmations: number; minConfirmations?: number }>;
  /** The transaction that liquidated a position; `since` is its creation time, to tell whether the lookup reaches back far enough. */
  liquidation(btcTxid: string, since: number): Promise<LiquidationLookup>;
}

/** Every network read the status needs. Implementations reject when a read fails. */
export interface StatusSource {
  /** `writz-lend.get_position(txid)`, debt accrued to the latest ledger; null when there is none. */
  getPosition(btcTxid: string): Promise<ChainPosition | null>;
  /** True once the relayer has published the co-signed release for `btcTxid`. */
  hasReleasePsbt(btcTxid: string): Promise<boolean>;
  getOraclePrice(): Promise<bigint>;
  getBtcTipHeight(): Promise<number>;
  getBtcTx(txid: string): Promise<BtcTxView>;
  getOutspend(txid: string, vout: number): Promise<Outspend>;
  relayer: RelayerSource;
}

const settle = <T>(p: Promise<T>): Promise<T | undefined> => p.then((v) => v, () => undefined);

const defined = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** Issues only the reads this position's stage needs; a failed read stays undefined. */
export async function readStatusInputs(
  local: LocalInputs,
  source: StatusSource,
  params: StatusParams,
): Promise<StatusInputs> {
  const p = local.position;
  const pd = p ? null : local.pendingDeposit;
  const chain: ChainReads = {};
  const relayer: RelayerIndex = {};

  if (pd) {
    const [tx, tip, position, conf] = await Promise.all([
      settle(source.getBtcTx(pd.btcTxid)),
      settle(source.getBtcTipHeight()),
      settle(source.getPosition(pd.btcTxid)),
      settle(source.relayer.confirmations(pd.btcTxid)),
    ]);
    Object.assign(chain, { depositTx: tx, btcTipHeight: tip, position });
    Object.assign(relayer, { confirmations: conf?.confirmations, minConfirmations: conf?.minConfirmations });
  }

  if (p) {
    const [position, tip, outspend] = await Promise.all([
      settle(source.getPosition(p.txid)),
      settle(source.getBtcTipHeight()),
      p.vout !== undefined ? settle(source.getOutspend(p.txid, p.vout)) : undefined,
    ]);
    Object.assign(chain, { position, btcTipHeight: tip, lockOutspend: outspend });
    if (position?.status === "active" && position.debtStroops > 0n) {
      chain.oraclePriceStroops = await settle(source.getOraclePrice());
    }
    if (position?.status === "closed") chain.releasePsbtReady = await settle(source.hasReleasePsbt(p.txid));
    if (position?.status === "liquidated") relayer.liquidation = await settle(source.relayer.liquidation(p.txid, p.createdAt));
  }

  return { local, chain: defined(chain), relayer: defined(relayer), params };
}
