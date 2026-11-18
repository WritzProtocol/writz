import type { xdr } from "@stellar/stellar-sdk";

/**
 * Checks that a transaction the DeFindex API built is exactly the vault call
 * the route was asked for, before the relayer hands it to the browser.
 *
 * The app runs the same check before the wallet signs
 * (frontend/app/src/lib/earn/verifyVaultTx.ts) and is where it matters most;
 * this copy stops a wrong envelope one step earlier. Keep the two in step.
 *
 *   deposit(amounts_desired: Vec<i128>, amounts_min: Vec<i128>, from: Address, invest: bool)
 *     amounts_desired == [amount], 0 <= amounts_min[0] <= amount, from == caller.
 *     One auth entry: root vault.deposit(same args), with exactly one
 *     sub-invocation, transfer(caller, vault, amount), and nothing below it.
 *     The relayer has no setting for the vault's asset, so the token contract
 *     of that transfer is pinned only when `assetContractId` is given; the app
 *     always pins it.
 *
 *   withdraw(withdraw_shares: i128, min_amounts_out: Vec<i128>, from: Address)
 *     withdraw_shares > 0, min_amounts_out == [x] with x within 1% of amount,
 *     from == caller. One auth entry: root vault.withdraw(same args), no
 *     sub-invocations.
 *
 * Refused besides: a fee-bump envelope, another source account, more than one
 * operation, anything but a contract call, and a fee above
 * MAX_EARN_FEE_STROOPS.
 *
 * The SDK is required lazily, like the other Soroban readers here, so jest
 * suites that import the route never load it.
 */

export type VaultAction = "deposit" | "withdraw";

export class VaultTxMismatchError extends Error {
  constructor(
    readonly reason: string,
    readonly detail: string,
  ) {
    super(`VaultTxMismatch: ${reason}: ${detail}`);
    this.name = "VaultTxMismatchError";
  }
}

/** Highest total fee an Earn transaction may bid, in stroops (10 XLM). */
export const MAX_EARN_FEE_STROOPS = 100_000_000n;

const WITHDRAW_TOLERANCE_BPS = 100n;

export interface VerifyVaultTxParams {
  xdr: string;
  networkPassphrase: string;
  vaultId: string;
  /** The vault asset's contract; when absent the deposit transfer's token is not pinned. */
  assetContractId?: string;
  action: VaultAction;
  caller: string;
  amountStroops: bigint;
  maxFeeStroops?: bigint;
}

function sdk(): typeof import("@stellar/stellar-sdk") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
}

function fail(reason: string, detail: string): never {
  throw new VaultTxMismatchError(reason, detail);
}

export function verifyVaultTx(params: VerifyVaultTxParams): void {
  const { Address, FeeBumpTransaction, TransactionBuilder, scValToBigInt } = sdk();
  const { networkPassphrase, vaultId, assetContractId, action, caller, amountStroops } = params;
  const maxFee = params.maxFeeStroops ?? MAX_EARN_FEE_STROOPS;

  const addressOf = (v: xdr.ScVal): string | null =>
    v.switch().name === "scvAddress" ? Address.fromScVal(v).toString() : null;
  const i128Of = (v: xdr.ScVal): bigint | null => (v.switch().name === "scvI128" ? scValToBigInt(v) : null);
  const singleI128Vec = (v: xdr.ScVal): bigint | null => {
    if (v.switch().name !== "scvVec") return null;
    const items = v.vec() ?? [];
    return items.length === 1 ? i128Of(items[0]) : null;
  };
  const contractOf = (a: xdr.ScAddress): string => Address.fromScAddress(a).toString();

  if (!vaultId) fail("not_configured", "no vault is configured");
  if (amountStroops <= 0n) fail("wrong_amount", "requested amount is not positive");

  let parsed: ReturnType<typeof TransactionBuilder.fromXDR>;
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
  if (contractOf(call.contractAddress()) !== vaultId) fail("wrong_contract", "calls a contract other than the vault");
  const fn = call.functionName().toString();
  if (fn !== action) fail("wrong_function", `calls ${fn}, requested ${action}`);

  const args = call.args();
  if (action === "deposit") {
    if (args.length !== 4) fail("wrong_arguments", `deposit takes 4 arguments, got ${args.length}`);
    const desired = singleI128Vec(args[0]);
    const min = singleI128Vec(args[1]);
    if (desired === null || min === null) fail("wrong_arguments", "deposit amounts are not one i128 each");
    if (desired !== amountStroops) fail("wrong_amount", `deposit of ${desired}, requested ${amountStroops}`);
    if (min < 0n || min > desired) fail("wrong_amount", `deposit minimum ${min} outside 0..${desired}`);
    if (addressOf(args[2]) !== caller) fail("wrong_arguments", "deposit is not from the caller");
    if (args[3].switch().name !== "scvBool") fail("wrong_arguments", "deposit invest flag is not a bool");
  } else {
    if (args.length !== 3) fail("wrong_arguments", `withdraw takes 3 arguments, got ${args.length}`);
    const shares = i128Of(args[0]);
    const minOut = singleI128Vec(args[1]);
    if (shares === null || minOut === null) fail("wrong_arguments", "withdraw amounts are not i128");
    if (shares <= 0n) fail("wrong_amount", `withdraw burns ${shares} shares`);
    const gap = minOut > amountStroops ? minOut - amountStroops : amountStroops - minOut;
    if (minOut <= 0n || gap * 10_000n > amountStroops * WITHDRAW_TOLERANCE_BPS) {
      fail("wrong_amount", `withdraw minimum ${minOut}, requested ${amountStroops}`);
    }
    if (addressOf(args[2]) !== caller) fail("wrong_arguments", "withdraw does not pay the caller");
  }

  const auth = op.auth ?? [];
  if (auth.length !== 1) fail("wrong_auth", `expected one authorization, got ${auth.length}`);
  const creds = auth[0].credentials();
  if (creds.switch().name === "sorobanCredentialsAddress") {
    if (contractOf(creds.address().address()) !== caller) fail("wrong_auth", "authorization is for another address");
  } else if (creds.switch().name !== "sorobanCredentialsSourceAccount") {
    fail("wrong_auth", "unknown authorization credentials");
  }

  const contractFnOf = (inv: xdr.SorobanAuthorizedInvocation): xdr.InvokeContractArgs => {
    const f = inv.function();
    if (f.switch().name !== "sorobanAuthorizedFunctionTypeContractFn") {
      fail("wrong_auth", "authorizes something other than a contract call");
    }
    return f.contractFn();
  };
  const root = auth[0].rootInvocation();
  const rootFn = contractFnOf(root);
  const rootArgs = rootFn.args();
  if (
    contractOf(rootFn.contractAddress()) !== vaultId ||
    rootFn.functionName().toString() !== action ||
    rootArgs.length !== args.length ||
    !rootArgs.every((v, i) => v.toXDR("base64") === args[i].toXDR("base64"))
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
  const tArgs = transfer.args();
  if (
    (assetContractId !== undefined && contractOf(transfer.contractAddress()) !== assetContractId) ||
    transfer.functionName().toString() !== "transfer" ||
    tArgs.length !== 3 ||
    addressOf(tArgs[0]) !== caller ||
    addressOf(tArgs[1]) !== vaultId ||
    i128Of(tArgs[2]) !== amountStroops
  ) {
    fail("wrong_auth", "deposit authorizes something other than the vault asset transfer");
  }
  if (subs[0].subInvocations().length !== 0) fail("wrong_auth", "asset transfer authorizes further calls");
}
