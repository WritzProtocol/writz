import { Buffer } from "buffer";
import { rpc } from "@stellar/stellar-sdk";
import { Client, type Position as RawPosition, type ProtocolState } from "@/lib/contracts/writzLendGenerated";
import { config, requireContract } from "@/config";

/**
 * Helpers for the `writz-lend` contract, built on the generated bindings
 * (`writzLendGenerated.ts`). Positions are plaintext and keyed by the Bitcoin
 * deposit txid, so every read here is a plain contract call.
 */

/** Null account used only as the simulation source for read-only calls. */
export const READ_ONLY_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export const writzLendId = (): string => requireContract(config.contracts.writzLend, "writz-lend");

/** A client for `writz-lend`; `publicKey` is the transaction source for writes. */
export function writzLendClient(publicKey: string = READ_ONLY_SOURCE, contractId: string = writzLendId()): Client {
  return new Client({
    contractId,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    allowHttp: config.rpcUrl.startsWith("http://"),
    publicKey,
  });
}

// ── Txid byte order ──────────────────────────────────────────────────────

/** The contract keys positions by the internal (hashing) byte order; explorers show it reversed. */
export const internalTxid = (displayHex: string): Buffer => Buffer.from(displayHex, "hex").reverse();

export const displayTxid = (internal: Uint8Array): string => Buffer.from(internal).reverse().toString("hex");

// ── Interest, mirrored from contracts/contracts/writz-lend/src/rates.rs ──

export const INDEX_ONE = 10n ** 18n;
const BP_SCALE = 10_000n;
const U_OPTIMAL_BP = 7_500n;
const SLOPE1_BP = 800n;
const SLOPE2_BP = 20_000n;
const LEDGERS_PER_YEAR = 6_311_520n;

/** The fields of `ProtocolState` interest accrual reads. */
export type RateState = Pick<
  ProtocolState,
  "borrow_index" | "supply_index" | "index_ledger" | "total_borrowed" | "total_scaled_supply"
>;

export function totalSupplyAssets(p: Pick<RateState, "total_scaled_supply">, supplyIndex: bigint): bigint {
  return (p.total_scaled_supply * supplyIndex) / INDEX_ONE;
}

/** Annual borrow rate in basis points for a utilization, the contract's kinked model. */
export function borrowRateBp(totalBorrowed: bigint, supplyAssets: bigint): bigint {
  if (supplyAssets === 0n || totalBorrowed === 0n) return 0n;
  let u = (totalBorrowed * BP_SCALE) / supplyAssets;
  if (u > BP_SCALE) u = BP_SCALE;
  if (u <= U_OPTIMAL_BP) return (u * SLOPE1_BP) / U_OPTIMAL_BP;
  return SLOPE1_BP + ((u - U_OPTIMAL_BP) * SLOPE2_BP) / (BP_SCALE - U_OPTIMAL_BP);
}

/**
 * `rates::project`: the borrow index, supply index and total borrowed as the
 * contract would accrue them at `ledger`, without writing anything.
 */
export function projectRates(
  p: RateState,
  ledger: number,
): { borrowIndex: bigint; supplyIndex: bigint; totalBorrowed: bigint } {
  const elapsed = BigInt(Math.max(0, ledger - Number(p.index_ledger)));
  if (elapsed === 0n) return { borrowIndex: p.borrow_index, supplyIndex: p.supply_index, totalBorrowed: p.total_borrowed };
  const rate = borrowRateBp(p.total_borrowed, totalSupplyAssets(p, p.supply_index));
  const borrowIndex =
    rate > 0n ? p.borrow_index + (p.borrow_index * rate * elapsed) / (LEDGERS_PER_YEAR * BP_SCALE) : p.borrow_index;
  let supplyIndex = p.supply_index;
  let totalBorrowed = p.total_borrowed;
  if (p.total_borrowed > 0n && borrowIndex > p.borrow_index) {
    const delta = (p.total_borrowed * (borrowIndex - p.borrow_index)) / p.borrow_index;
    const lenders = delta - (delta * 1_500n) / BP_SCALE;
    totalBorrowed += delta;
    if (p.total_scaled_supply > 0n) supplyIndex += (lenders * INDEX_ONE) / p.total_scaled_supply;
  }
  return { borrowIndex, supplyIndex, totalBorrowed };
}

/** A position's debt at `borrowIndex`: `usdc_debt * borrow_index / debt_index`, as the contract accrues it. */
export function debtAt(p: Pick<RawPosition, "usdc_debt" | "debt_index">, borrowIndex: bigint): bigint {
  if (p.usdc_debt === 0n || p.debt_index <= 0n) return p.usdc_debt;
  return (p.usdc_debt * borrowIndex) / p.debt_index;
}

// ── Reads ────────────────────────────────────────────────────────────────

export type ChainPositionStatus = "active" | "closed" | "liquidated";

/** A `writz-lend` position as the chain holds it, with its debt brought up to the latest ledger. */
export interface ChainPosition {
  /** Bitcoin txid, display order. */
  txid: string;
  status: ChainPositionStatus;
  depositor: string;
  collateralSats: bigint;
  /** Outstanding USDC debt in stroops, interest included up to `ledger`. */
  debtStroops: bigint;
  /** The stored debt before accrual; the contract only accepts repayments up to the accrued figure. */
  storedDebtStroops: bigint;
  timelockHeight: number;
  /** The depositor's compressed Bitcoin public key, hex. */
  userPubkey: string;
  /** The deposit output's P2WSH scriptPubKey, hex. */
  scriptPubKey: string;
  /** The ledger the debt was projected to. */
  ledger: number;
}

const STATUS: Record<RawPosition["status"]["tag"], ChainPositionStatus> = {
  Active: "active",
  Closed: "closed",
  Liquidated: "liquidated",
};

/** Pure: shapes a raw `get_position` result, projecting its debt to `ledger`. */
export function toChainPosition(raw: RawPosition, proto: RateState, ledger: number): ChainPosition {
  const { borrowIndex } = projectRates(proto, ledger);
  return {
    txid: displayTxid(raw.btc_txid),
    status: STATUS[raw.status.tag],
    depositor: raw.depositor,
    collateralSats: BigInt(raw.btc_satoshis),
    debtStroops: debtAt(raw, borrowIndex),
    storedDebtStroops: raw.usdc_debt,
    timelockHeight: raw.timelock_height,
    userPubkey: Buffer.from(raw.user_pubkey).toString("hex"),
    scriptPubKey: Buffer.from(raw.p2wsh_script_pubkey).toString("hex"),
    ledger,
  };
}

function server(): rpc.Server {
  return new rpc.Server(config.rpcUrl, { allowHttp: config.rpcUrl.startsWith("http://") });
}

export async function latestLedger(): Promise<number> {
  return (await server().getLatestLedger()).sequence;
}

export async function getProtocolState(): Promise<ProtocolState> {
  return (await writzLendClient().get_protocol_state()).result;
}

/** `get_position(txid)` for a display-order txid, with its debt up to date; null when there is none. */
export async function readPosition(txidDisplay: string): Promise<ChainPosition | null> {
  const client = writzLendClient();
  const [pos, proto, ledger] = await Promise.all([
    client.get_position({ txid: internalTxid(txidDisplay) }),
    client.get_protocol_state(),
    latestLedger(),
  ]);
  return pos.result ? toChainPosition(pos.result, proto.result, ledger) : null;
}

export interface PoolState {
  /** USDC lenders hold claim to, interest included, in stroops. */
  totalSupplied: bigint;
  /** USDC borrowed across all open loans, interest included, in stroops. */
  totalBorrowed: bigint;
  /** Liquidity available to borrow (`supplied - borrowed`), in stroops. */
  available: bigint;
}

/** Pure: pool totals from a protocol state, accrued to `ledger`. */
export function poolStateAt(proto: RateState, ledger: number): PoolState {
  const { supplyIndex, totalBorrowed } = projectRates(proto, ledger);
  const totalSupplied = totalSupplyAssets(proto, supplyIndex);
  const available = totalSupplied > totalBorrowed ? totalSupplied - totalBorrowed : 0n;
  return { totalSupplied, totalBorrowed, available };
}

export async function getPoolState(): Promise<PoolState> {
  const [proto, ledger] = await Promise.all([getProtocolState(), latestLedger()]);
  return poolStateAt(proto, ledger);
}

/** The relayer's co-signed release PSBT for a repaid position, or null until it publishes one. */
export async function getReleasePsbt(txidDisplay: string): Promise<Buffer | null> {
  const { result } = await writzLendClient().get_release_psbt({ txid: internalTxid(txidDisplay) });
  return result ? Buffer.from(result) : null;
}
