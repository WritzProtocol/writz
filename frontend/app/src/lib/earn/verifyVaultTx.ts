import { Address, FeeBumpTransaction, scValToBigInt, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";

/**
 * Checks that an Earn transaction built by the relayer (from the DeFindex API)
 * is exactly the vault call the user asked for, before the wallet is asked to
 * sign it. The relayer and the DeFindex API only build the envelope; what the
 * user signs is decided here.
 *
 * Accepted shapes, matching what the DeFindex vault contract takes and what the
 * API has built for this vault on testnet:
 *
 *   deposit(amounts_desired: Vec<i128>, amounts_min: Vec<i128>, from: Address, invest: bool)
 *     amounts_desired == [amount], 0 <= amounts_min[0] <= amount, from == caller.
 *     One auth entry: root vault.deposit(same args), with exactly one
 *     sub-invocation, asset.transfer(caller, vault, amount), and nothing below it.
 *
 *   withdraw(withdraw_shares: i128, min_amounts_out: Vec<i128>, from: Address)
 *     withdraw_shares > 0, min_amounts_out == [x] with x within 1% of amount,
 *     from == caller (the vault pays out to `from`). One auth entry: root
 *     vault.withdraw(same args) with no sub-invocations.
 *
 * Everything else is refused: a fee-bump envelope, another source account, more
 * than one operation, any operation that is not a contract call, another
 * contract or function, other arguments, extra or different auth, and a fee
 * above `MAX_EARN_FEE_STROOPS`. The relayer runs the same check
 * (relayer/src/defindex/verify-vault-tx.ts); keep the two in step.
 */

export type VaultAction = "deposit" | "withdraw";

export type VaultTxMismatchReason =
  | "not_configured"
  | "unreadable"
  | "fee_bump"
  | "wrong_source"
  | "fee_too_high"
  | "operation_count"
  | "not_contract_call"
  | "wrong_contract"
  | "wrong_function"
  | "wrong_arguments"
  | "wrong_amount"
  | "wrong_auth";

/** The transaction to sign is not the vault call that was requested. Nothing was signed. */
export class VaultTxMismatchError extends Error {
  constructor(
    readonly reason: VaultTxMismatchReason,
    readonly detail: string,
  ) {
    super(`VaultTxMismatch: ${reason}: ${detail}`);
    this.name = "VaultTxMismatchError";
  }
}

/**
 * Highest total fee an Earn transaction may bid, in stroops (10 XLM). Vault
 * deposits and withdrawals on testnet have cost between 0.004 and 3.6 XLM,
 * resource fee included.
 */
export const MAX_EARN_FEE_STROOPS = 100_000_000n;

/** Largest gap between the requested withdrawal and `min_amounts_out`, in basis points. */
const WITHDRAW_TOLERANCE_BPS = 100n;

export interface VerifyVaultTxParams {
  xdr: string;
  networkPassphrase: string;
  /** The Writz DeFindex vault. Empty refuses every transaction. */
  vaultId: string;
  /** The Stellar Asset Contract of the vault's asset. Empty refuses every deposit. */
  assetContractId: string;
  action: VaultAction;
  caller: string;
  amountStroops: bigint;
  maxFeeStroops?: bigint;
}

function fail(reason: VaultTxMismatchReason, detail: string): never {
  throw new VaultTxMismatchError(reason, detail);
}

function addressOf(v: xdr.ScVal): string | null {
  if (v.switch().name !== "scvAddress") return null;
  return Address.fromScVal(v).toString();
}

function i128Of(v: xdr.ScVal): bigint | null {
  if (v.switch().name !== "scvI128") return null;
  return scValToBigInt(v);
}

/** A vector of exactly one i128, as the single-asset vault takes amounts. */
function singleI128Vec(v: xdr.ScVal): bigint | null {
  if (v.switch().name !== "scvVec") return null;
  const items = v.vec() ?? [];
  if (items.length !== 1) return null;
  return i128Of(items[0]);
}

function sameArgs(a: xdr.ScVal[], b: xdr.ScVal[]): boolean {
  return a.length === b.length && a.every((v, i) => v.toXDR("base64") === b[i].toXDR("base64"));
}

function checkDepositArgs(args: xdr.ScVal[], caller: string, amount: bigint): void {
  if (args.length !== 4) fail("wrong_arguments", `deposit takes 4 arguments, got ${args.length}`);
  const desired = singleI128Vec(args[0]);
  const min = singleI128Vec(args[1]);
  if (desired === null || min === null) fail("wrong_arguments", "deposit amounts are not one i128 each");
  if (desired !== amount) fail("wrong_amount", `deposit of ${desired}, requested ${amount}`);
  if (min < 0n || min > desired) fail("wrong_amount", `deposit minimum ${min} outside 0..${desired}`);
  if (addressOf(args[2]) !== caller) fail("wrong_arguments", "deposit is not from the caller");
  if (args[3].switch().name !== "scvBool") fail("wrong_arguments", "deposit invest flag is not a bool");
}

function checkWithdrawArgs(args: xdr.ScVal[], caller: string, amount: bigint): void {
  if (args.length !== 3) fail("wrong_arguments", `withdraw takes 3 arguments, got ${args.length}`);
  const shares = i128Of(args[0]);
  const minOut = singleI128Vec(args[1]);
  if (shares === null || minOut === null) fail("wrong_arguments", "withdraw amounts are not i128");
  if (shares <= 0n) fail("wrong_amount", `withdraw burns ${shares} shares`);
  const gap = minOut > amount ? minOut - amount : amount - minOut;
  if (minOut <= 0n || gap * 10_000n > amount * WITHDRAW_TOLERANCE_BPS) {
    fail("wrong_amount", `withdraw minimum ${minOut}, requested ${amount}`);
  }
  if (addressOf(args[2]) !== caller) fail("wrong_arguments", "withdraw does not pay the caller");
}

function contractFnOf(inv: xdr.SorobanAuthorizedInvocation): xdr.InvokeContractArgs {
  const fn = inv.function();
  if (fn.switch().name !== "sorobanAuthorizedFunctionTypeContractFn") {
    fail("wrong_auth", "authorizes something other than a contract call");
  }
  return fn.contractFn();
}

function checkAuth(
  auth: xdr.SorobanAuthorizationEntry[],
  call: xdr.InvokeContractArgs,
  params: VerifyVaultTxParams,
): void {
  const { action, caller, vaultId, assetContractId, amountStroops } = params;
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
  if (
    Address.fromScAddress(rootFn.contractAddress()).toString() !== vaultId ||
    rootFn.functionName().toString() !== action ||
    !sameArgs(rootFn.args(), call.args())
  ) {
    fail("wrong_auth", "authorization is not for the requested vault call");
  }

  const subs = root.subInvocations();
  if (action === "withdraw") {
    if (subs.length !== 0) fail("wrong_auth", "withdraw authorizes further calls");
    return;
  }
  if (subs.length !== 1) fail("wrong_auth", `deposit authorizes ${subs.length} further calls, expected 1`);
  const transfer = contractFnOf(subs[0]);
  const args = transfer.args();
  if (
    Address.fromScAddress(transfer.contractAddress()).toString() !== assetContractId ||
    transfer.functionName().toString() !== "transfer" ||
    args.length !== 3 ||
    addressOf(args[0]) !== caller ||
    addressOf(args[1]) !== vaultId ||
    i128Of(args[2]) !== amountStroops
  ) {
    fail("wrong_auth", "deposit authorizes something other than the vault asset transfer");
  }
  if (subs[0].subInvocations().length !== 0) fail("wrong_auth", "asset transfer authorizes further calls");
}

/** Throws `VaultTxMismatchError` unless `xdr` is exactly the requested vault call; returns the parsed transaction. */
export function verifyVaultTx(params: VerifyVaultTxParams): Transaction {
  const { networkPassphrase, vaultId, assetContractId, action, caller, amountStroops } = params;
  const maxFee = params.maxFeeStroops ?? MAX_EARN_FEE_STROOPS;

  if (!vaultId) fail("not_configured", "no Earn vault is configured");
  if (action === "deposit" && !assetContractId) fail("not_configured", "no Earn asset is configured");
  if (amountStroops <= 0n) fail("wrong_amount", "requested amount is not positive");

  let parsed: Transaction | FeeBumpTransaction;
  try {
    parsed = TransactionBuilder.fromXDR(params.xdr, networkPassphrase);
  } catch {
    fail("unreadable", "not a transaction envelope");
  }
  if (parsed instanceof FeeBumpTransaction) fail("fee_bump", "a fee-bump envelope is never expected here");
  const tx = parsed;

  if (tx.source !== caller) fail("wrong_source", "source account is not the caller");
  if (BigInt(tx.fee) > maxFee) fail("fee_too_high", `fee ${tx.fee} above ${maxFee}`);
  if (tx.operations.length !== 1) fail("operation_count", `expected one operation, got ${tx.operations.length}`);

  const op = tx.operations[0];
  if (op.type !== "invokeHostFunction") fail("not_contract_call", `operation is ${op.type}`);
  if (op.source !== undefined && op.source !== caller) fail("wrong_source", "operation source is not the caller");
  if (op.func.switch().name !== "hostFunctionTypeInvokeContract") {
    fail("not_contract_call", "host function is not a contract call");
  }
  const call = op.func.invokeContract();
  if (Address.fromScAddress(call.contractAddress()).toString() !== vaultId) {
    fail("wrong_contract", "calls a contract other than the Earn vault");
  }
  const fn = call.functionName().toString();
  if (fn !== action) fail("wrong_function", `calls ${fn}, requested ${action}`);

  if (action === "deposit") checkDepositArgs(call.args(), caller, amountStroops);
  else checkWithdrawArgs(call.args(), caller, amountStroops);

  checkAuth(op.auth ?? [], call, params);
  return tx;
}
