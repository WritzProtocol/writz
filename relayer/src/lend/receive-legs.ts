/**
 * How a borrow was received, read from the borrower's own Stellar operations.
 *
 * A borrow pays USDC to the borrower on Stellar. Taking it as another asset
 * (a swap through the Soroswap router into EURC, PYUSD, the USDT0 test token
 * or XLM) or on Base Sepolia (a CCTP `deposit_for_burn`)
 * is a second transaction the borrower signs afterwards, and nothing on chain
 * ties it to the position: the router and the TokenMessengerMinter know an
 * account and an amount, not a loan. So the link is made here, by a rule, and
 * the rule is stated rather than hidden:
 *
 *   A swap of USDC into one of the known swap assets, or a burn of USDC for Base Sepolia, sent by the
 *   position's owner belongs to the owner's most recent `borrow` before it,
 *   provided no `borrow` or `repay` call by the owner (on any position) came
 *   in between. If that borrow is on another position, the leg belongs to
 *   that position, not this one. If a repay came in between, the leg belongs
 *   to no position.
 *
 * Only successful transactions count (Horizon leaves failed ones out unless
 * asked), and only operations whose source is the owner: an incoming transfer
 * also appears in an account's operations.
 *
 * The limit: an owner with two loans open who borrows on one and then swaps
 * USDC that came from the other has that swap shown under the latest borrow.
 * The rule never moves a leg to a position the owner did not borrow on last,
 * and never invents one: every leg is a transaction that exists.
 *
 * Deliberately does not statically import `@stellar/stellar-sdk` at module
 * scope (see `../repay-watcher/poller.ts` for why).
 */

/** An operation of the owner that matters to the timeline. */
export type OwnerOperationKind = "borrow" | "repay" | "swap" | "burn_to_base_sepolia";

export interface OwnerOperation {
  kind: OwnerOperationKind;
  txHash: string;
  /** Unix ms, from the operation's ledger close time. */
  at: number;
  /** For a `swap`: the ticker it bought, e.g. "EURC". */
  asset?: string;
}

/** The contracts and tokens an operation is matched against. */
export interface ReceiveContext {
  owner: string;
  writzLend: string;
  soroswapRouter: string;
  tokenMessengerMinter: string;
  usdcToken: string;
  /** The assets a borrow may be swapped into: Stellar Asset Contract id to ticker. */
  swapTokens: Readonly<Record<string, string>>;
  /** CCTP domain the burn must target: Base (and Base Sepolia) is 6. */
  baseDomain: number;
}

/** The fields of a Horizon operation record this module reads. */
export interface HorizonOperation {
  paging_token: string;
  type: string;
  source_account: string;
  transaction_hash: string;
  transaction_successful?: boolean;
  created_at: string;
  function?: string;
  parameters?: { type: string; value: string }[];
}

/**
 * Names an owner's invoke-contract operation, or undefined for one the
 * timeline does not show. Arguments are checked, not only the method: a
 * swap must start at the lending pool's USDC and end at a known swap asset, a burn must
 * burn that USDC from the owner towards Base Sepolia.
 */
export function classifyOperation(op: HorizonOperation, ctx: ReceiveContext): OwnerOperation | undefined {
  if (op.type !== "invoke_host_function" || op.transaction_successful === false) return undefined;
  if (op.source_account !== ctx.owner) return undefined;
  if (op.function !== "HostFunctionTypeHostFunctionTypeInvokeContract") return undefined;
  const params = op.parameters ?? [];
  if (params.length < 2) return undefined;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { scValToNative, xdr } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
  let values: unknown[];
  try {
    values = params.map((p) => scValToNative(xdr.ScVal.fromXDR(p.value, "base64")) as unknown);
  } catch {
    return undefined;
  }
  const [contract, method, ...args] = values;
  const at = Date.parse(op.created_at);
  const leg = (kind: OwnerOperationKind): OwnerOperation => ({ kind, txHash: op.transaction_hash, at });

  if (contract === ctx.writzLend) {
    if (method === "borrow") return leg("borrow");
    if (method === "repay") return leg("repay");
    return undefined;
  }
  if (contract === ctx.soroswapRouter && method === "swap_exact_tokens_for_tokens") {
    // (amount_in, amount_out_min, path, to, deadline)
    const path = args[2];
    const end = Array.isArray(path) && path.length >= 2 && path[0] === ctx.usdcToken ? path[path.length - 1] : undefined;
    const asset = typeof end === "string" ? ctx.swapTokens[end] : undefined;
    return asset ? { ...leg("swap"), asset } : undefined;
  }
  if (contract === ctx.tokenMessengerMinter && method === "deposit_for_burn") {
    // (from, amount, destination_domain, mint_recipient, burn_token, destination_caller, max_fee, min_finality_threshold)
    const [from, , domain, , burnToken] = args;
    if (from === ctx.owner && Number(domain) === ctx.baseDomain && burnToken === ctx.usdcToken) {
      return leg("burn_to_base_sepolia");
    }
  }
  return undefined;
}

/**
 * The receive legs of one position, by the rule in the module comment.
 * `operations` are the owner's, in chain order; `borrowHashes` are the
 * Stellar transactions of this position's borrows.
 */
export function attributeReceiveLegs(
  operations: readonly OwnerOperation[],
  borrowHashes: ReadonlySet<string>,
): OwnerOperation[] {
  const legs: OwnerOperation[] = [];
  let open = false;
  for (const op of operations) {
    if (op.kind === "borrow") open = borrowHashes.has(op.txHash);
    else if (op.kind === "repay") open = false;
    else if (open) legs.push(op);
  }
  return legs;
}

const HORIZON_PAGE = 200;

/**
 * The owner's operations from `fromLedger` on, oldest first, at most
 * `maxPages` pages. `truncated` says the walk stopped before the end.
 */
export async function fetchOwnerOperations(params: {
  horizonUrl: string;
  owner: string;
  fromLedger: number;
  maxPages: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}): Promise<{ operations: HorizonOperation[]; truncated: boolean }> {
  const { horizonUrl, owner, fromLedger, maxPages, timeoutMs, fetchImpl = fetch } = params;
  // A Horizon paging token is the operation's TOID, which packs the ledger
  // into its high 32 bits; this cursor sits just before the ledger's first one.
  let cursor = (BigInt(fromLedger) << 32n).toString();
  const operations: HorizonOperation[] = [];
  for (let page = 0; page < maxPages; page++) {
    const url = `${horizonUrl.replace(/\/+$/, "")}/accounts/${owner}/operations?order=asc&limit=${HORIZON_PAGE}&cursor=${cursor}`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    // An account Horizon has never seen has no operations to attribute.
    if (res.status === 404) return { operations, truncated: false };
    if (!res.ok) throw new Error(`Horizon ${res.status} reading the operations of ${owner}`);
    const body = (await res.json()) as { _embedded?: { records?: HorizonOperation[] } };
    const records = body._embedded?.records ?? [];
    operations.push(...records);
    if (records.length < HORIZON_PAGE) return { operations, truncated: false };
    cursor = records[records.length - 1].paging_token;
  }
  return { operations, truncated: true };
}
