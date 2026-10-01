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
  /** `since` is the position's creation time, to tell whether the lookup reaches back far enough. */
  liquidation(nullifierHex: string, since: number): Promise<LiquidationLookup>;
  catchingUp(commitmentHex: string, leafIndex?: number): Promise<boolean>;
}

/** Every network read the status needs. Implementations reject when a read fails. */
export interface StatusSource {
  getCommitmentForTxid(btcTxid: string): Promise<string | null>;
  isCommitmentPending(commitmentHex: string): Promise<boolean>;
  isNullifierSpent(nullifierHex: string): Promise<boolean>;
  getOraclePrice(): Promise<bigint>;
  getBtcTipHeight(): Promise<number>;
  getBtcTx(txid: string): Promise<BtcTxView>;
  getOutspend(txid: string, vout: number): Promise<Outspend>;
  relayer: RelayerSource;
}

export const toHex32 = (decimal: string): string => BigInt(decimal).toString(16).padStart(64, "0");

const settle = <T>(p: Promise<T>): Promise<T | undefined> => p.then((v) => v, () => undefined);

const defined = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** Issues only the reads this position's stage needs; a failed read stays undefined. */
export async function readStatusInputs(
  local: LocalInputs,
  source: StatusSource,
  params: StatusParams,
): Promise<StatusInputs> {
  const p = local.position && local.position.status !== "pending" ? local.position : null;
  const pd = p ? null : local.pendingDeposit;
  const chain: ChainReads = {};
  const relayer: RelayerIndex = {};

  if (pd) {
    const [tx, tip, commitment, conf] = await Promise.all([
      settle(source.getBtcTx(pd.btcTxid)),
      settle(source.getBtcTipHeight()),
      settle(source.getCommitmentForTxid(pd.btcTxid)),
      settle(source.relayer.confirmations(pd.btcTxid)),
    ]);
    Object.assign(chain, { depositTx: tx, btcTipHeight: tip, commitmentForTxid: commitment });
    Object.assign(relayer, { confirmations: conf?.confirmations, minConfirmations: conf?.minConfirmations });
    if (commitment) chain.commitmentPending = await settle(source.isCommitmentPending(commitment));
  }

  if (p) {
    const commitmentHex = toHex32(p.commitment);
    const [spent, price, tip, outspend, pending, catchingUp] = await Promise.all([
      settle(source.isNullifierSpent(toHex32(p.nullifier))),
      BigInt(p.debtStroops) > 0n ? settle(source.getOraclePrice()) : undefined,
      settle(source.getBtcTipHeight()),
      p.txid && p.vout !== undefined ? settle(source.getOutspend(p.txid, p.vout)) : undefined,
      p.status === "registering" ? settle(source.isCommitmentPending(commitmentHex)) : undefined,
      p.leafIndex !== undefined ? settle(source.relayer.catchingUp(commitmentHex, p.leafIndex)) : undefined,
    ]);
    Object.assign(chain, {
      nullifierSpent: spent,
      oraclePriceStroops: price,
      btcTipHeight: tip,
      lockOutspend: outspend,
      commitmentPending: pending,
    });
    relayer.catchingUp = catchingUp;
    if (spent) relayer.liquidation = await settle(source.relayer.liquidation(toHex32(p.nullifier), p.createdAt));
  }

  return { local, chain: defined(chain), relayer: defined(relayer), params };
}
