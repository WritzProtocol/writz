import { Buffer } from "buffer";
import { scValToNative, xdr } from "@stellar/stellar-sdk";
import { sha256 } from "@noble/hashes/sha2.js";
import { config } from "@/config";
import { readPosition, writzLendId, type ChainPosition } from "@/lib/contracts/writzLend";
import { pendingDeposits } from "@/lib/flow/pendingDeposit";
import { listPositions, savePosition, type Position } from "@/lib/position";

/**
 * Finds a wallet's `writz-lend` loans from the chain, so they are the same on
 * every device. The contract has no owner index and its `deposit` event does
 * not name the depositor, so the list comes from the wallet's own history:
 * Horizon keeps every `deposit` call the account made to `writz-lend`, with
 * its arguments. Each call's raw Bitcoin transaction hashes to the deposit
 * txid, and `get_position` confirms the position and that this wallet owns
 * it. Loans already on this device are refreshed the same way.
 */

/** One `deposit` call this wallet made to `writz-lend`. */
export interface DepositCall {
  /** Bitcoin deposit txid, display order. */
  txid: string;
  /** Stellar transaction that made the call. */
  stellarTxHash: string;
  /** When the call landed, Unix ms. */
  at: number;
}

/** The fields of a Horizon `invoke_host_function` operation record this reads. */
export interface HorizonInvokeOp {
  type: string;
  transaction_successful?: boolean;
  transaction_hash: string;
  created_at: string;
  parameters?: { type: string; value: string }[];
}

/** `writz-lend.deposit` arguments, in order, after the contract address and function name. */
const DEPOSITOR_ARG = 0;
const RAW_TX_ARG = 4;

/** Display-order txid of a raw Bitcoin transaction (non-witness serialization). */
export function txidOfRawTx(raw: Uint8Array): string {
  return Buffer.from(sha256(sha256(raw))).reverse().toString("hex");
}

const native = (b64: string): unknown => scValToNative(xdr.ScVal.fromXDR(b64, "base64"));

/** Pure: the deposit a Horizon operation record made for `owner`, or null when it is anything else. */
export function depositCallOf(op: HorizonInvokeOp, contractId: string, owner: string): DepositCall | null {
  if (op.type !== "invoke_host_function" || op.transaction_successful === false) return null;
  const params = op.parameters ?? [];
  if (params.length < 2 + RAW_TX_ARG + 1) return null;
  try {
    if (native(params[0].value) !== contractId || native(params[1].value) !== "deposit") return null;
    const args = params.slice(2);
    if (native(args[DEPOSITOR_ARG].value) !== owner) return null;
    const raw = native(args[RAW_TX_ARG].value);
    if (!(raw instanceof Uint8Array)) return null;
    return { txid: txidOfRawTx(raw), stellarTxHash: op.transaction_hash, at: Date.parse(op.created_at) };
  } catch {
    return null;
  }
}

/** Horizon pages read per scan. 200 operations each; deposits are rare, so this reaches far back. */
const MAX_PAGES = 25;

/** Every `deposit` call `owner` made to `contractId`, oldest first. */
export async function horizonDepositCalls(
  owner: string,
  opts: { horizonUrl: string; contractId: string; get?: (url: string) => Promise<Response> },
): Promise<DepositCall[]> {
  const get = opts.get ?? ((url: string) => fetch(url));
  const calls: DepositCall[] = [];
  let url: string | null = `${opts.horizonUrl}/accounts/${owner}/operations?order=desc&limit=200`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const res = await get(url);
    // An account that does not exist yet has made no deposits.
    if (res.status === 404) break;
    if (!res.ok) throw new Error(`Horizon error ${res.status}`);
    const body = (await res.json()) as {
      _embedded?: { records?: HorizonInvokeOp[] };
      _links?: { next?: { href?: string } };
    };
    const records = body._embedded?.records ?? [];
    for (const op of records) {
      const call = depositCallOf(op, opts.contractId, owner);
      if (call) calls.push(call);
    }
    url = records.length === 200 ? (body._links?.next?.href ?? null) : null;
  }
  return calls.reverse();
}

/** The output of a Bitcoin transaction paying `scriptPubKeyHex`, from Esplora. */
export async function findVout(txid: string, scriptPubKeyHex: string): Promise<number | undefined> {
  const res = await fetch(`${config.bitcoin.apiUrl}/tx/${txid}`).catch(() => null);
  if (!res?.ok) return undefined;
  const tx = (await res.json()) as { vout: { scriptpubkey: string }[] };
  const vout = tx.vout.findIndex((o) => o.scriptpubkey.toLowerCase() === scriptPubKeyHex.toLowerCase());
  return vout === -1 ? undefined : vout;
}

/** The local status hint a chain position implies; a release this device sent is kept. */
function localStatus(chain: ChainPosition, prior?: Position): Position["status"] {
  if (chain.status === "liquidated") return "liquidated";
  if (prior?.status === "released") return "released";
  return chain.status;
}

/** Pure: a local record brought up to date with its chain position. */
export function mergeChainPosition(
  chain: ChainPosition,
  prior: Position | undefined,
  fresh: { owner: string; index: number; createdAt: number; stellarTxHash?: string; vout?: number },
): Position {
  return {
    ...prior,
    id: chain.txid,
    txid: chain.txid,
    owner: fresh.owner,
    index: prior?.index ?? fresh.index,
    createdAt: prior?.createdAt ?? fresh.createdAt,
    collateralSats: chain.collateralSats.toString(),
    debtStroops: chain.debtStroops.toString(),
    status: localStatus(chain, prior),
    btcPubkey: chain.userPubkey,
    timelockHeight: chain.timelockHeight,
    vout: prior?.vout ?? fresh.vout,
    stellarTxHash: prior?.stellarTxHash ?? fresh.stellarTxHash,
  };
}

/** The lowest loan index not used by `used`. */
export function nextIndex(used: Iterable<number>): number {
  const taken = new Set(used);
  let i = 0;
  while (taken.has(i)) i++;
  return i;
}

export interface DiscoverDeps {
  depositCalls(owner: string): Promise<DepositCall[]>;
  readPosition(txid: string): Promise<ChainPosition | null>;
  findVout(txid: string, scriptPubKeyHex: string): Promise<number | undefined>;
  list(owner: string): Position[];
  save(position: Position): void;
  /** The deposit in progress and the loan index it reserved, if any. */
  pending(owner: string): { txid: string; index: number } | null;
}

export const discoverDeps: DiscoverDeps = {
  depositCalls: (owner) =>
    horizonDepositCalls(owner, { horizonUrl: config.horizonUrl, contractId: writzLendId() }),
  readPosition,
  findVout,
  list: listPositions,
  save: savePosition,
  pending(owner) {
    const pd = pendingDeposits.load(owner);
    return pd ? { txid: pd.btcTxid, index: pd.positionIndex } : null;
  },
};

/** Reads one loan from the chain and saves it locally. Returns null when the chain has no position for this wallet. */
export async function syncPosition(
  owner: string,
  txid: string,
  extra: { stellarTxHash?: string; createdAt?: number; index?: number } = {},
  deps: DiscoverDeps = discoverDeps,
): Promise<Position | null> {
  const chain = await deps.readPosition(txid);
  if (!chain || chain.depositor !== owner) return null;
  const local = deps.list(owner);
  const prior = local.find((p) => p.id === txid);
  const vout = prior?.vout ?? (await deps.findVout(txid, chain.scriptPubKey).catch(() => undefined));
  const pending = deps.pending(owner);
  const index =
    prior?.index ??
    extra.index ??
    (pending?.txid === txid ? pending.index : nextIndex([...local.map((p) => p.index), ...(pending ? [pending.index] : [])]));
  const position = mergeChainPosition(chain, prior, {
    owner,
    index,
    createdAt: extra.createdAt ?? Date.now(),
    stellarTxHash: extra.stellarTxHash,
    vout,
  });
  deps.save(position);
  return position;
}

export interface DiscoverResult {
  /** Loans this wallet has on `writz-lend`, local and found. */
  found: number;
  /** Deposit calls read from the wallet's history. */
  scanned: number;
}

/**
 * Rebuilds this wallet's loans from the chain: every deposit in its history
 * plus every loan already on this device, each confirmed with `get_position`.
 * New loans are numbered in the order they were deposited.
 */
export async function discoverPositions(owner: string, deps: DiscoverDeps = discoverDeps): Promise<DiscoverResult> {
  const calls = await deps.depositCalls(owner);
  const known = new Set(deps.list(owner).map((p) => p.id));
  const txids = [...new Set([...known, ...calls.map((c) => c.txid)])];
  let found = 0;
  for (const txid of txids) {
    const call = calls.find((c) => c.txid === txid);
    const position = await syncPosition(owner, txid, { stellarTxHash: call?.stellarTxHash, createdAt: call?.at }, deps);
    if (position) found++;
    // A loan this device knows but the chain does not answer for stays as it is: a lagging read is not a missing loan.
    else if (known.has(txid)) found++;
  }
  return { found, scanned: calls.length };
}
