import { Buffer } from "buffer";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  Address,
  Asset,
  FeeBumpTransaction,
  nativeToScVal,
  scValToBigInt,
  TransactionBuilder,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";
import { config } from "@/config";
import { verifyVaultTx, VaultTxMismatchError, type VaultTxMismatchReason } from "@/lib/earn/verifyVaultTx";
import { describeIntent, intentUsdc, usdcText, type SigningIntent } from "./intent";

/**
 * The check that runs before the embedded Pollar wallet signs anything. Pollar
 * signs on its server with no window of its own, so this is what stands where
 * Freighter's approval screen would: the transaction is decoded and compared
 * with the intent the flow declared, and it is signed with no interruption
 * only when it is exactly that call.
 *
 * Every contract-call verifier checks the same things: the caller is the
 * transaction source (and any operation source), there is one operation, it
 * calls the expected contract and function with the expected arguments, the
 * single Soroban authorization is the caller's and covers exactly the
 * expected invocation tree (the root call with the same arguments, then the
 * expected sub-invocations and nothing below them), the fee is bounded, and
 * the envelope is not a fee-bump. Earn reuses `verifyVaultTx`.
 */

export type IntentMismatchReason =
  | VaultTxMismatchReason
  | "not_trustline"
  | "wrong_asset";

/** The transaction is not what its intent declared. Nothing was signed. */
export class IntentMismatchError extends Error {
  constructor(
    readonly reason: IntentMismatchReason,
    readonly detail: string,
  ) {
    super(`IntentMismatch: ${reason}: ${detail}`);
    this.name = "IntentMismatchError";
  }
}

function fail(reason: IntentMismatchReason, detail: string): never {
  throw new IntentMismatchError(reason, detail);
}

/** Contract ids and names the verifiers compare against; `signingEnv()` reads them from config. */
export interface SigningEnv {
  networkPassphrase: string;
  writzLend: string;
  usdcToken: string;
  earnVault: string;
  /** The Stellar Asset Contract of the Earn vault's asset. */
  earnAsset: string;
  router: string;
  tokenMessengerMinter: string;
  /** Circle's CCTP domain the burn goes to. */
  cctpDomain: number;
  /** Plain names for contracts the app knows, keyed by contract id. */
  names: Record<string, string>;
  /** Unix seconds now; swap deadlines are checked against it. */
  now: () => number;
}

function sacOf(code: string, issuer: string, passphrase: string): string {
  if (!code || !issuer) return "";
  try {
    return new Asset(code, issuer).contractId(passphrase);
  } catch {
    return "";
  }
}

export function signingEnv(): SigningEnv {
  const passphrase = config.networkPassphrase;
  const earnAsset = sacOf(config.earn.asset.code, config.earn.asset.issuer, passphrase);
  const names: Record<string, string> = {};
  const name = (id: string, label: string) => {
    if (id) names[id] = label;
  };
  name(config.contracts.writzLend, "the Writz lending pool");
  name(config.contracts.usdcToken, "USDC");
  name(config.earn.vaultId, "the Earn vault");
  name(earnAsset, "USDC (Blend)");
  name(config.receive.soroswapRouter, "the Soroswap router");
  name(config.receive.cctp.tokenMessengerMinter, "Circle's bridge");
  name(config.receive.xlmToken, "XLM");
  for (const a of Object.values(config.receive.swapAssets ?? {})) name(a.token, a.code);
  return {
    networkPassphrase: passphrase,
    writzLend: config.contracts.writzLend,
    usdcToken: config.contracts.usdcToken,
    earnVault: config.earn.vaultId,
    earnAsset,
    router: config.receive.soroswapRouter,
    tokenMessengerMinter: config.receive.cctp.tokenMessengerMinter,
    cctpDomain: config.receive.cctp.destination.domain,
    names,
    now: () => Math.floor(Date.now() / 1000),
  };
}

// ── Fee caps, in stroops ──────────────────────────────────────────────────

/** A classic trustline bids the base fee (100 stroops); 0.1 XLM leaves room for surge pricing. */
export const MAX_TRUSTLINE_FEE = 1_000_000n;
/**
 * Contract calls other than the deposit: 25 XLM. Measured on testnet they
 * cost 0.1 to 3.6 XLM, resource fee included.
 */
export const MAX_CALL_FEE = 250_000_000n;
/**
 * `writz-lend.deposit` writes the position and verifies an SPV proof, and its
 * declared resource fee is large and moves with testnet rent: 351.9 XLM
 * declared on 2026-10-25 for about 89 XLM charged (`stellarTx.test.ts`,
 * contracts/deployments/testnet.md). The cap is the fee field's own maximum,
 * about 429 XLM, so a deposit is bounded by the field and nothing tighter.
 */
export const MAX_DEPOSIT_FEE = 4_294_967_295n;
/** How far past now a swap deadline may be: the 300 seconds the swap sets, plus a minute of clock drift. */
const MAX_DEADLINE_AHEAD = 360;

// ── ScVal helpers ─────────────────────────────────────────────────────────

/** An argument check: an exact value, or a function that returns the problem or null. */
type Arg = xdr.ScVal | ((v: xdr.ScVal) => string | null);

const same = (a: xdr.ScVal, b: xdr.ScVal) => a.toXDR("base64") === b.toXDR("base64");
const addr = (s: string) => Address.fromString(s).toScVal();
const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });

function addressOf(v: xdr.ScVal): string | null {
  if (v.switch().name !== "scvAddress") return null;
  return Address.fromScVal(v).toString();
}

function i128Of(v: xdr.ScVal): bigint | null {
  if (v.switch().name !== "scvI128") return null;
  return scValToBigInt(v);
}

function bytesOf(v: xdr.ScVal): Buffer | null {
  if (v.switch().name !== "scvBytes") return null;
  return Buffer.from(v.bytes());
}

const anyContract: Arg = (v) => (addressOf(v)?.startsWith("C") ? null : "is not a contract address");
const u32Above0: Arg = (v) => (v.switch().name === "scvU32" && v.u32() > 0 ? null : "is not a ledger number");

function checkArgs(fn: string, got: xdr.ScVal[], want: Arg[]): void {
  if (got.length !== want.length) fail("wrong_arguments", `${fn} takes ${want.length} arguments, got ${got.length}`);
  want.forEach((w, i) => {
    if (typeof w === "function") {
      const problem = w(got[i]);
      if (problem) fail(problem.startsWith("amount") ? "wrong_amount" : "wrong_arguments", `${fn} argument ${i} ${problem}`);
    } else if (!same(got[i], w)) {
      fail(w.switch().name === "scvI128" ? "wrong_amount" : "wrong_arguments", `${fn} argument ${i} differs from the request`);
    }
  });
}

// ── The generic contract-call check ───────────────────────────────────────

interface SubCall {
  contract: string;
  fn: string;
  args: Arg[];
}

interface CallSpec {
  contract: string;
  fn: string;
  args: Arg[];
  /** The sub-invocations the caller's authorization covers, in order; none below them. */
  subs: SubCall[];
  maxFee: bigint;
}

function parse(envelope: string, passphrase: string): Transaction {
  let parsed: Transaction | FeeBumpTransaction;
  try {
    parsed = TransactionBuilder.fromXDR(envelope, passphrase);
  } catch {
    fail("unreadable", "not a transaction envelope");
  }
  if (parsed instanceof FeeBumpTransaction) fail("fee_bump", "a fee-bump envelope is never signed here");
  return parsed;
}

function checkEnvelope(tx: Transaction, caller: string, maxFee: bigint): void {
  if (tx.source !== caller) fail("wrong_source", "source account is not the caller");
  if (BigInt(tx.fee) > maxFee) fail("fee_too_high", `fee ${tx.fee} above ${maxFee}`);
  if (tx.operations.length !== 1) fail("operation_count", `expected one operation, got ${tx.operations.length}`);
  const source = tx.operations[0].source;
  if (source !== undefined && source !== caller) fail("wrong_source", "operation source is not the caller");
}

function contractFnOf(inv: xdr.SorobanAuthorizedInvocation): xdr.InvokeContractArgs {
  const fn = inv.function();
  if (fn.switch().name !== "sorobanAuthorizedFunctionTypeContractFn") {
    fail("wrong_auth", "authorizes something other than a contract call");
  }
  return fn.contractFn();
}

function checkAuth(auth: xdr.SorobanAuthorizationEntry[], call: xdr.InvokeContractArgs, caller: string, spec: CallSpec): void {
  if (auth.length !== 1) fail("wrong_auth", `expected one authorization, got ${auth.length}`);
  const [entry] = auth;
  const creds = entry.credentials();
  if (creds.switch().name === "sorobanCredentialsAddress") {
    if (Address.fromScAddress(creds.address().address()).toString() !== caller) {
      fail("wrong_auth", "authorization is for another address");
    }
  } else if (creds.switch().name !== "sorobanCredentialsSourceAccount") {
    fail("wrong_auth", "unknown authorization credentials");
  }

  const root = entry.rootInvocation();
  const rootFn = contractFnOf(root);
  const rootArgs = rootFn.args();
  const callArgs = call.args();
  if (
    Address.fromScAddress(rootFn.contractAddress()).toString() !== spec.contract ||
    rootFn.functionName().toString() !== spec.fn ||
    rootArgs.length !== callArgs.length ||
    !rootArgs.every((a, i) => same(a, callArgs[i]))
  ) {
    fail("wrong_auth", "authorization is not for the requested call");
  }

  const subs = root.subInvocations();
  if (subs.length !== spec.subs.length) {
    fail("wrong_auth", `${spec.fn} authorizes ${subs.length} further calls, expected ${spec.subs.length}`);
  }
  subs.forEach((sub, i) => {
    const want = spec.subs[i];
    const fn = contractFnOf(sub);
    if (Address.fromScAddress(fn.contractAddress()).toString() !== want.contract || fn.functionName().toString() !== want.fn) {
      fail("wrong_auth", `${spec.fn} authorizes a call other than ${want.fn}`);
    }
    try {
      checkArgs(want.fn, fn.args(), want.args);
    } catch (e) {
      if (e instanceof IntentMismatchError) fail("wrong_auth", `authorized ${e.detail}`);
      throw e;
    }
    if (sub.subInvocations().length !== 0) fail("wrong_auth", `${want.fn} authorizes further calls`);
  });
}

function verifyCall(envelope: string, caller: string, spec: CallSpec, passphrase: string): Transaction {
  if (!spec.contract) fail("not_configured", `no contract is configured for ${spec.fn}`);
  const tx = parse(envelope, passphrase);
  checkEnvelope(tx, caller, spec.maxFee);
  const op = tx.operations[0];
  if (op.type !== "invokeHostFunction") fail("not_contract_call", `operation is ${op.type}`);
  if (op.func.switch().name !== "hostFunctionTypeInvokeContract") fail("not_contract_call", "host function is not a contract call");
  const call = op.func.invokeContract();
  if (Address.fromScAddress(call.contractAddress()).toString() !== spec.contract) {
    fail("wrong_contract", `calls a contract other than the one for ${spec.fn}`);
  }
  const fn = call.functionName().toString();
  if (fn !== spec.fn) fail("wrong_function", `calls ${fn}, requested ${spec.fn}`);
  checkArgs(fn, call.args(), spec.args);
  checkAuth(op.auth ?? [], call, caller, spec);
  return tx;
}

// ── Per-intent specs ──────────────────────────────────────────────────────

/** The txid a raw Bitcoin transaction (no witness) hashes to, in the order explorers show. */
export function bitcoinTxid(raw: Uint8Array): string {
  return Buffer.from(sha256(sha256(raw))).reverse().toString("hex");
}

function internalTxid(display: string): Buffer {
  return Buffer.from(display, "hex").reverse();
}

function usdcTransfer(env: SigningEnv, from: string, to: string, amount: bigint): SubCall {
  return { contract: env.usdcToken, fn: "transfer", args: [addr(from), addr(to), i128(amount)] };
}

function amountAtMost(max: bigint): Arg {
  return (v) => {
    const n = i128Of(v);
    return n !== null && n >= 0n && n <= max ? null : `amount ${n} above ${max}`;
  };
}

function deadline(env: SigningEnv): Arg {
  return (v) => {
    if (v.switch().name !== "scvU64") return "deadline is not a u64";
    const at = Number(v.u64().toBigInt());
    const now = env.now();
    return at > now && at <= now + MAX_DEADLINE_AHEAD ? null : `deadline ${at} outside the next ${MAX_DEADLINE_AHEAD} seconds`;
  };
}

function pathArg(path: string[]): xdr.ScVal {
  return nativeToScVal(path.map((p) => Address.fromString(p)));
}

function writzLendSpec(intent: SigningIntent, caller: string, env: SigningEnv): CallSpec | null {
  const pool = env.writzLend;
  switch (intent.kind) {
    case "writz-lend.deposit":
      return {
        contract: pool,
        fn: "deposit",
        args: [
          addr(caller),
          (v) => (bytesOf(v)?.length === 32 ? null : "block hash is not 32 bytes"),
          (v) => (v.switch().name === "scvVec" ? null : "merkle proof is not a list"),
          (v) => (v.switch().name === "scvU32" ? null : "transaction index is not a u32"),
          (v) => {
            const raw = bytesOf(v);
            if (!raw) return "raw transaction is not bytes";
            return bitcoinTxid(raw) === intent.btcTxid.toLowerCase() ? null : "proves a different Bitcoin transaction";
          },
          (v) => (bytesOf(v)?.length === 34 ? null : "output script is not P2WSH"),
          (v) => (v.switch().name === "scvU32" ? null : "timelock is not a u32"),
          (v) => (bytesOf(v)?.length === 33 ? null : "Bitcoin key is not 33 bytes"),
          (v) => (bytesOf(v)?.length === 65 ? null : "key signature is not 65 bytes"),
        ],
        subs: [],
        maxFee: MAX_DEPOSIT_FEE,
      };
    case "writz-lend.borrow":
      return {
        contract: pool,
        fn: "borrow",
        args: [addr(caller), nativeToScVal(internalTxid(intent.txid)), i128(intent.amount)],
        subs: [],
        maxFee: MAX_CALL_FEE,
      };
    case "writz-lend.repay":
      return {
        contract: pool,
        fn: "repay",
        args: [addr(caller), nativeToScVal(internalTxid(intent.txid)), i128(intent.amount)],
        subs: [usdcTransfer(env, caller, pool, intent.amount)],
        maxFee: MAX_CALL_FEE,
      };
    case "writz-lend.supply":
      return {
        contract: pool,
        fn: "supply_usdc",
        args: [addr(caller), i128(intent.amount)],
        subs: [usdcTransfer(env, caller, pool, intent.amount)],
        maxFee: MAX_CALL_FEE,
      };
    case "writz-lend.withdraw":
      return {
        contract: pool,
        fn: "withdraw_supply",
        args: [addr(caller), i128(intent.amount)],
        subs: [],
        maxFee: MAX_CALL_FEE,
      };
    default:
      return null;
  }
}

function receiveSpec(intent: SigningIntent, caller: string, env: SigningEnv): CallSpec | null {
  switch (intent.kind) {
    case "swap.exact-in":
      return {
        contract: env.router,
        fn: "swap_exact_tokens_for_tokens",
        args: [i128(intent.amountIn), i128(intent.minOut), pathArg(intent.path), addr(caller), deadline(env)],
        // The router pulls the input from the caller into the pair it routes through.
        subs: [{ contract: intent.path[0] ?? "", fn: "transfer", args: [addr(caller), anyContract, i128(intent.amountIn)] }],
        maxFee: MAX_CALL_FEE,
      };
    case "swap.exact-out":
      return {
        contract: env.router,
        fn: "swap_tokens_for_exact_tokens",
        args: [i128(intent.amountOut), i128(intent.maxIn), pathArg(intent.path), addr(caller), deadline(env)],
        subs: [{ contract: intent.path[0] ?? "", fn: "transfer", args: [addr(caller), anyContract, amountAtMost(intent.maxIn)] }],
        maxFee: MAX_CALL_FEE,
      };
    case "cctp.approve":
      return {
        contract: env.usdcToken,
        fn: "approve",
        args: [addr(caller), addr(env.tokenMessengerMinter), i128(intent.amount), u32Above0],
        subs: [],
        maxFee: MAX_CALL_FEE,
      };
    case "cctp.burn": {
      const recipient = Buffer.concat([Buffer.alloc(12), Buffer.from(intent.recipient.replace(/^0x/, ""), "hex")]);
      return {
        contract: env.tokenMessengerMinter,
        fn: "deposit_for_burn",
        args: [
          addr(caller),
          i128(intent.amount),
          nativeToScVal(env.cctpDomain, { type: "u32" }),
          nativeToScVal(recipient),
          addr(env.usdcToken),
          nativeToScVal(Buffer.alloc(32)),
          i128(intent.maxFee),
          nativeToScVal(2000, { type: "u32" }),
        ],
        subs: [],
        maxFee: MAX_CALL_FEE,
      };
    }
    default:
      return null;
  }
}

/** The largest trustline limit, what `changeTrust` sets when no limit is given. */
const MAX_LIMIT = "922337203685.4775807";

/** The trustline intent: one `changeTrust` from the caller to exactly that asset, with the default (maximum) limit. */
function verifyTrustline(envelope: string, caller: string, asset: { code: string; issuer: string }, passphrase: string): void {
  const tx = parse(envelope, passphrase);
  checkEnvelope(tx, caller, MAX_TRUSTLINE_FEE);
  const op = tx.operations[0];
  if (op.type !== "changeTrust") fail("not_trustline", `operation is ${op.type}`);
  const line = op.line;
  if (!(line instanceof Asset) || line.getCode() !== asset.code || line.getIssuer() !== asset.issuer) {
    fail("wrong_asset", "adds a different asset");
  }
  if (op.limit !== MAX_LIMIT) fail("wrong_amount", `trustline limit ${op.limit}, expected the default`);
}

export type IntentVerdict =
  | { status: "match"; intent: SigningIntent; usdc: bigint | null }
  | { status: "mismatch"; intent: SigningIntent; reason: IntentMismatchReason; detail: string }
  | { status: "unknown" };

/**
 * Checks `envelope` against `intent` for `caller`. "match" signs with no
 * interruption, "mismatch" is blocked, "unknown" (no intent, or one this
 * build does not know) asks the user.
 */
export function checkIntent(
  envelope: string,
  intent: SigningIntent | undefined,
  caller: string,
  env: SigningEnv = signingEnv(),
): IntentVerdict {
  if (!intent || typeof intent !== "object" || !KNOWN.has(intent.kind)) return { status: "unknown" };
  try {
    if (intent.kind === "earn.deposit" || intent.kind === "earn.withdraw") {
      verifyVaultTx({
        xdr: envelope,
        networkPassphrase: env.networkPassphrase,
        vaultId: env.earnVault,
        assetContractId: env.earnAsset,
        action: intent.kind === "earn.deposit" ? "deposit" : "withdraw",
        caller,
        amountStroops: intent.amount,
      });
    } else if (intent.kind === "trustline") {
      verifyTrustline(envelope, caller, intent.asset, env.networkPassphrase);
    } else {
      const spec = writzLendSpec(intent, caller, env) ?? receiveSpec(intent, caller, env);
      if (!spec) return { status: "unknown" };
      verifyCall(envelope, caller, spec, env.networkPassphrase);
    }
  } catch (e) {
    if (e instanceof IntentMismatchError || e instanceof VaultTxMismatchError) {
      return { status: "mismatch", intent, reason: e.reason, detail: e.detail };
    }
    return { status: "mismatch", intent, reason: "unreadable", detail: e instanceof Error ? e.message : String(e) };
  }
  return { status: "match", intent, usdc: intentUsdc(intent) };
}

const KNOWN = new Set<string>([
  "earn.deposit",
  "earn.withdraw",
  "trustline",
  "writz-lend.deposit",
  "writz-lend.borrow",
  "writz-lend.repay",
  "writz-lend.supply",
  "writz-lend.withdraw",
  "swap.exact-in",
  "swap.exact-out",
  "cctp.approve",
  "cctp.burn",
] satisfies SigningIntent["kind"][]);

// ── Plain-language description of what a transaction does ─────────────────

function short(id: string): string {
  return id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

export function tokenNamer(env: SigningEnv) {
  return (id: string): string => env.names[id]?.replace(/^the /, "") ?? `token ${short(id)}`;
}

function who(env: SigningEnv, caller: string, id: string | null): string {
  if (!id) return "an unknown address";
  if (id === caller) return "you";
  return env.names[id] ?? short(id);
}

function describeCall(call: xdr.InvokeContractArgs, caller: string, env: SigningEnv): string {
  const contract = Address.fromScAddress(call.contractAddress()).toString();
  const fn = call.functionName().toString();
  const args = call.args();
  const known = env.names[contract];
  const token = known ? known.replace(/^the /, "") : null;
  const amount = (v: xdr.ScVal | undefined) => {
    const n = v ? i128Of(v) : null;
    return n === null ? "an amount of" : usdcText(n);
  };
  if (fn === "transfer" && args.length === 3) {
    return `Send ${amount(args[2])} ${token ?? `of token ${short(contract)}`} to ${who(env, caller, addressOf(args[1]))}`;
  }
  if (fn === "approve" && args.length === 4) {
    return `Let ${who(env, caller, addressOf(args[1]))} spend ${amount(args[2])} ${token ?? `of token ${short(contract)}`} from your wallet`;
  }
  if (contract === env.earnVault && (fn === "deposit" || fn === "withdraw")) {
    return fn === "deposit" ? "Deposit into the Earn vault" : "Withdraw from the Earn vault";
  }
  if (contract === env.writzLend) {
    const plain: Record<string, string> = {
      borrow: `Borrow ${amount(args[2])} USDC`,
      repay: `Repay ${amount(args[2])} USDC`,
      supply_usdc: `Supply ${amount(args[1])} USDC to the lending pool`,
      withdraw_supply: `Withdraw ${amount(args[1])} USDC from the lending pool`,
      deposit: "Register a Bitcoin deposit",
    };
    if (plain[fn]) return plain[fn];
  }
  return `Call ${fn} on ${known ?? `contract ${short(contract)}`}`;
}

function describeOp(op: Transaction["operations"][number], caller: string, env: SigningEnv): string {
  switch (op.type) {
    case "invokeHostFunction":
      return op.func.switch().name === "hostFunctionTypeInvokeContract"
        ? describeCall(op.func.invokeContract(), caller, env)
        : "Deploy or upload contract code";
    case "changeTrust": {
      const code = op.line instanceof Asset ? op.line.getCode() : "a liquidity pool share";
      return Number(op.limit) === 0 ? `Remove ${code} from your wallet` : `Add ${code} to your wallet`;
    }
    case "payment":
      return `Send ${op.amount} ${op.asset.isNative() ? "XLM" : op.asset.getCode()} to ${who(env, caller, op.destination)}`;
    case "pathPaymentStrictSend":
    case "pathPaymentStrictReceive":
      return `Swap and send to ${who(env, caller, op.destination)}`;
    case "createAccount":
      return `Fund account ${short(op.destination)} with ${op.startingBalance} XLM`;
    case "accountMerge":
      return `Close your account and send all its XLM to ${who(env, caller, op.destination)}`;
    case "setOptions":
      return "Change who can sign for your account, or its settings";
    case "manageSellOffer":
    case "manageBuyOffer":
    case "createPassiveSellOffer":
      return "Place a trade offer on the Stellar exchange";
    default:
      return `Change your account (${op.type})`;
  }
}

/** Up to five plain lines saying what `envelope` would do; never throws. */
export function describeTx(envelope: string, caller: string, env: SigningEnv = signingEnv()): string[] {
  let parsed: Transaction | FeeBumpTransaction;
  try {
    parsed = TransactionBuilder.fromXDR(envelope, env.networkPassphrase);
  } catch {
    return ["Something Writz can't read"];
  }
  const tx = parsed instanceof FeeBumpTransaction ? parsed.innerTransaction : parsed;
  const lines: string[] = [];
  try {
    if (tx.source !== caller) lines.push(`Act for account ${short(tx.source)}, not yours`);
    const ops = tx.operations;
    for (const op of ops.slice(0, 2)) lines.push(describeOp(op, caller, env));
    if (ops.length > 2) lines.push(`and ${ops.length - 2} more ${ops.length - 2 === 1 ? "action" : "actions"}`);
    const auth = ops.flatMap((op) => (op.type === "invokeHostFunction" ? (op.auth ?? []) : []));
    const subs = auth.reduce((n, a) => n + countSubs(a.rootInvocation()), 0);
    if (auth.length > 1 || subs > 2) lines.push("and approve other contract calls in your name");
    const fee = BigInt(parsed.fee);
    if (fee > 10_000_000n) lines.push(`with a fee of up to ${usdcText(fee)} XLM`);
  } catch {
    lines.push("Something Writz can't read");
  }
  return lines.slice(0, 5);
}

function countSubs(inv: xdr.SorobanAuthorizedInvocation): number {
  return inv.subInvocations().reduce((n, s) => n + 1 + countSubs(s), 0);
}

/** What was asked, in plain words, for the confirmation component. */
export function describeRequest(intent: SigningIntent, env: SigningEnv = signingEnv()): string {
  return describeIntent(intent, tokenNamer(env));
}
