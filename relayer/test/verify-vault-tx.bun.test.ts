import { describe, expect, test } from "bun:test";
import {
  Account,
  Address,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { MAX_EARN_FEE_STROOPS, VaultTxMismatchError, verifyVaultTx, type VaultAction } from "../src/defindex/verify-vault-tx";

const NET = Networks.TESTNET;
const VAULT = "CBMHGL7GGGHODEDDJ5H2LKJEFHJWBRSQUKOXMC4FKOFDZK5HBKW6PI2S";
const ASSET = "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU";
const OTHER_CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const caller = Keypair.random().publicKey();
const other = Keypair.random().publicKey();
const AMOUNT = 10_000_000n;

// Built by the DeFindex API for the testnet vault and landed on chain
// (deposit 9ea2e3eb..., withdrawal c9cb89d1..., by the deployer account).
const LIVE_CALLER = "GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT";
const LIVE_DEPOSIT_XDR =
  "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";
const LIVE_WITHDRAW_XDR =
  "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";

const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });
const addr = (a: string) => new Address(a).toScVal();
const vec = (...v: xdr.ScVal[]) => xdr.ScVal.scvVec(v);

function invocation(contract: string, fn: string, args: xdr.ScVal[], subs: xdr.SorobanAuthorizedInvocation[] = []) {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({ contractAddress: new Address(contract).toScAddress(), functionName: fn, args }),
    ),
    subInvocations: subs,
  });
}

const sourceAuth = (root: xdr.SorobanAuthorizedInvocation) =>
  new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: root,
  });

const depositArgs = (amount = AMOUNT) => [vec(i128(amount)), vec(i128(amount)), addr(caller), xdr.ScVal.scvBool(true)];
const withdrawArgs = (minOut = AMOUNT) => [i128(9_990_000n), vec(i128(minOut)), addr(caller)];
const transfer = (amount = AMOUNT, to = VAULT, token = ASSET) =>
  invocation(token, "transfer", [addr(caller), addr(to), i128(amount)]);

function build(
  action: VaultAction,
  o: { contract?: string; fn?: string; args?: xdr.ScVal[]; subs?: xdr.SorobanAuthorizedInvocation[]; ops?: xdr.Operation[]; fee?: string; source?: string } = {},
): string {
  const contract = o.contract ?? VAULT;
  const fn = o.fn ?? action;
  const args = o.args ?? (action === "deposit" ? depositArgs() : withdrawArgs());
  const subs = o.subs ?? (action === "deposit" ? [transfer()] : []);
  const b = new TransactionBuilder(new Account(o.source ?? caller, "1"), { fee: o.fee ?? "500000", networkPassphrase: NET });
  for (const op of o.ops ?? [Operation.invokeContractFunction({ contract, function: fn, args, auth: [sourceAuth(invocation(contract, fn, args, subs))] })]) {
    b.addOperation(op);
  }
  return b.setTimeout(300).build().toXDR();
}

const check = (action: VaultAction, txXdr: string, over: Record<string, unknown> = {}) =>
  verifyVaultTx({ xdr: txXdr, networkPassphrase: NET, vaultId: VAULT, assetContractId: ASSET, action, caller, amountStroops: AMOUNT, ...over });

function reasonOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(VaultTxMismatchError);
    return (e as VaultTxMismatchError).reason;
  }
  throw new Error("expected the transaction to be refused");
}

describe("relayer verifyVaultTx", () => {
  test("accepts the requested deposit and withdrawal", () => {
    expect(() => check("deposit", build("deposit"))).not.toThrow();
    expect(() => check("withdraw", build("withdraw"))).not.toThrow();
  });

  test("accepts what the DeFindex API built for the testnet vault, with and without the asset pinned", () => {
    const live = { caller: LIVE_CALLER };
    expect(() => check("deposit", LIVE_DEPOSIT_XDR, { ...live, amountStroops: 1_000_000n })).not.toThrow();
    expect(() => check("deposit", LIVE_DEPOSIT_XDR, { ...live, amountStroops: 1_000_000n, assetContractId: undefined })).not.toThrow();
    expect(() => check("withdraw", LIVE_WITHDRAW_XDR, { ...live, amountStroops: 900_000n })).not.toThrow();
  });

  test("refuses a payment, an extra operation, another contract and another function", () => {
    const pay = Operation.payment({ destination: other, asset: new Asset("USDC", other), amount: "1000000" });
    expect(reasonOf(() => check("deposit", build("deposit", { ops: [pay] })))).toBe("not_contract_call");
    const args = depositArgs();
    const call = Operation.invokeContractFunction({ contract: VAULT, function: "deposit", args, auth: [sourceAuth(invocation(VAULT, "deposit", args, [transfer()]))] });
    expect(reasonOf(() => check("deposit", build("deposit", { ops: [call, pay] })))).toBe("operation_count");
    expect(reasonOf(() => check("deposit", build("deposit", { contract: OTHER_CONTRACT })))).toBe("wrong_contract");
    const sacArgs = [addr(caller), addr(other), i128(AMOUNT)];
    expect(reasonOf(() => check("deposit", build("deposit", { contract: ASSET, fn: "transfer", args: sacArgs, subs: [] })))).toBe("wrong_contract");
    expect(reasonOf(() => check("withdraw", build("deposit")))).toBe("wrong_function");
  });

  test("refuses another amount, source, fee, auth or envelope type", () => {
    expect(reasonOf(() => check("deposit", build("deposit", { args: depositArgs(AMOUNT * 10n) })))).toBe("wrong_amount");
    expect(reasonOf(() => check("withdraw", build("withdraw", { args: withdrawArgs(AMOUNT / 2n) })))).toBe("wrong_amount");
    expect(reasonOf(() => check("deposit", build("deposit", { source: other })))).toBe("wrong_source");
    expect(reasonOf(() => check("deposit", build("deposit", { fee: (MAX_EARN_FEE_STROOPS + 1n).toString() })))).toBe("fee_too_high");
    expect(reasonOf(() => check("deposit", build("deposit", { subs: [transfer(), transfer(AMOUNT, other)] })))).toBe("wrong_auth");
    expect(reasonOf(() => check("deposit", build("deposit", { subs: [transfer(AMOUNT, VAULT, OTHER_CONTRACT)] })))).toBe("wrong_auth");
    expect(reasonOf(() => check("withdraw", build("withdraw", { subs: [transfer()] })))).toBe("wrong_auth");
    const inner = TransactionBuilder.fromXDR(build("deposit"), NET) as ReturnType<TransactionBuilder["build"]>;
    const bumped = TransactionBuilder.buildFeeBumpTransaction(Keypair.random(), "1000000", inner, NET).toXDR();
    expect(reasonOf(() => check("deposit", bumped))).toBe("fee_bump");
  });

  test("refuses everything when no vault is configured", () => {
    expect(reasonOf(() => check("deposit", build("deposit"), { vaultId: "" }))).toBe("not_configured");
  });
});
