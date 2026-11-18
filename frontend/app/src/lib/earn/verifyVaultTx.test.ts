import { describe, expect, it } from "bun:test";
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
import { MAX_EARN_FEE_STROOPS, VaultTxMismatchError, verifyVaultTx, type VaultAction } from "./verifyVaultTx";
import { LIVE_ASSET, LIVE_CALLER, LIVE_DEPOSIT, LIVE_VAULT, LIVE_WITHDRAW } from "./vaultTxFixtures";

const NET = Networks.TESTNET;
const caller = Keypair.random().publicKey();
const other = Keypair.random().publicKey();
const VAULT = LIVE_VAULT;
const ASSET = LIVE_ASSET;
const OTHER_CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const AMOUNT = 10_000_000n;

const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });
const addr = (a: string) => new Address(a).toScVal();
const vec = (...v: xdr.ScVal[]) => xdr.ScVal.scvVec(v);

function invocation(
  contract: string,
  fn: string,
  args: xdr.ScVal[],
  subs: xdr.SorobanAuthorizedInvocation[] = [],
): xdr.SorobanAuthorizedInvocation {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(contract).toScAddress(),
        functionName: fn,
        args,
      }),
    ),
    subInvocations: subs,
  });
}

function sourceAuth(root: xdr.SorobanAuthorizedInvocation): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: root,
  });
}

const depositArgs = (amount = AMOUNT, from = caller) => [vec(i128(amount)), vec(i128(amount)), addr(from), xdr.ScVal.scvBool(true)];
const withdrawArgs = (minOut = AMOUNT, from = caller) => [i128(9_990_000n), vec(i128(minOut)), addr(from)];
const transferInv = (amount = AMOUNT, to = VAULT, token = ASSET) =>
  invocation(token, "transfer", [addr(caller), addr(to), i128(amount)]);

interface Build {
  source?: string;
  fee?: string;
  contract?: string;
  fn?: string;
  args?: xdr.ScVal[];
  auth?: xdr.SorobanAuthorizationEntry[];
  extraOps?: xdr.Operation[];
  ops?: xdr.Operation[];
}

function build(action: VaultAction, b: Build = {}): string {
  const fn = b.fn ?? action;
  const args = b.args ?? (action === "deposit" ? depositArgs() : withdrawArgs());
  const contract = b.contract ?? VAULT;
  const auth =
    b.auth ?? [sourceAuth(invocation(contract, fn, args, action === "deposit" ? [transferInv()] : []))];
  const builder = new TransactionBuilder(new Account(b.source ?? caller, "1"), {
    fee: b.fee ?? "500000",
    networkPassphrase: NET,
  });
  const ops = b.ops ?? [Operation.invokeContractFunction({ contract, function: fn, args, auth }), ...(b.extraOps ?? [])];
  for (const op of ops) builder.addOperation(op);
  return builder.setTimeout(300).build().toXDR();
}

const params = (action: VaultAction, txXdr: string, over: Partial<Parameters<typeof verifyVaultTx>[0]> = {}) => ({
  xdr: txXdr,
  networkPassphrase: NET,
  vaultId: VAULT,
  assetContractId: ASSET,
  action,
  caller,
  amountStroops: AMOUNT,
  ...over,
});

function reasonOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(VaultTxMismatchError);
    expect((e as Error).message).toStartWith("VaultTxMismatch: ");
    return (e as VaultTxMismatchError).reason;
  }
  throw new Error("expected the transaction to be refused");
}

describe("verifyVaultTx accepts the requested vault call", () => {
  it("accepts a deposit of the requested amount from the caller", () => {
    const tx = verifyVaultTx(params("deposit", build("deposit")));
    expect(tx.source).toBe(caller);
  });

  it("accepts a withdrawal of the requested amount to the caller", () => {
    expect(verifyVaultTx(params("withdraw", build("withdraw"))).source).toBe(caller);
  });

  it("accepts a withdrawal whose minimum out is within 1% of the request", () => {
    expect(() => verifyVaultTx(params("withdraw", build("withdraw", { args: withdrawArgs(AMOUNT + 10n) })))).not.toThrow();
  });

  it("accepts the deposit and withdrawal the DeFindex API built for the testnet vault", () => {
    const live = { caller: LIVE_CALLER, vaultId: LIVE_VAULT, assetContractId: LIVE_ASSET };
    expect(() =>
      verifyVaultTx(params("deposit", LIVE_DEPOSIT.xdr, { ...live, amountStroops: LIVE_DEPOSIT.amountStroops })),
    ).not.toThrow();
    expect(() =>
      verifyVaultTx(params("withdraw", LIVE_WITHDRAW.xdr, { ...live, amountStroops: LIVE_WITHDRAW.amountStroops })),
    ).not.toThrow();
  });

  it("accepts the SAC of the configured classic asset", () => {
    const usdc = new Asset("USDC", "GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56");
    expect(usdc.contractId(NET)).toBe(LIVE_ASSET);
  });
});

describe("verifyVaultTx refuses anything else", () => {
  it("refuses a classic USDC payment", () => {
    const pay = Operation.payment({ destination: other, asset: new Asset("USDC", other), amount: "1000000" });
    expect(reasonOf(() => verifyVaultTx(params("deposit", build("deposit", { ops: [pay] }))))).toBe("not_contract_call");
  });

  it("refuses a vault call with an extra operation", () => {
    const pay = Operation.payment({ destination: other, asset: Asset.native(), amount: "1" });
    expect(reasonOf(() => verifyVaultTx(params("deposit", build("deposit", { extraOps: [pay] }))))).toBe(
      "operation_count",
    );
  });

  it("refuses a call to another contract", () => {
    expect(reasonOf(() => verifyVaultTx(params("deposit", build("deposit", { contract: OTHER_CONTRACT }))))).toBe(
      "wrong_contract",
    );
  });

  it("refuses a direct transfer on the asset contract", () => {
    const args = [addr(caller), addr(other), i128(AMOUNT)];
    const tx = build("deposit", {
      contract: ASSET,
      fn: "transfer",
      args,
      auth: [sourceAuth(invocation(ASSET, "transfer", args))],
    });
    expect(reasonOf(() => verifyVaultTx(params("deposit", tx)))).toBe("wrong_contract");
  });

  it("refuses another vault function", () => {
    expect(reasonOf(() => verifyVaultTx(params("deposit", build("deposit", { fn: "withdraw", args: withdrawArgs() }))))).toBe(
      "wrong_function",
    );
    expect(reasonOf(() => verifyVaultTx(params("withdraw", build("deposit"))))).toBe("wrong_function");
  });

  it("refuses a deposit of another amount", () => {
    expect(reasonOf(() => verifyVaultTx(params("deposit", build("deposit", { args: depositArgs(AMOUNT * 100n) }))))).toBe(
      "wrong_amount",
    );
  });

  it("refuses a withdrawal whose minimum out is far from the request", () => {
    expect(reasonOf(() => verifyVaultTx(params("withdraw", build("withdraw", { args: withdrawArgs(AMOUNT / 2n) }))))).toBe(
      "wrong_amount",
    );
  });

  it("refuses a deposit from, or a withdrawal to, another address", () => {
    expect(reasonOf(() => verifyVaultTx(params("deposit", build("deposit", { args: depositArgs(AMOUNT, other) }))))).toBe(
      "wrong_arguments",
    );
    expect(reasonOf(() => verifyVaultTx(params("withdraw", build("withdraw", { args: withdrawArgs(AMOUNT, other) }))))).toBe(
      "wrong_arguments",
    );
  });

  it("refuses another source account", () => {
    expect(reasonOf(() => verifyVaultTx(params("deposit", build("deposit", { source: other }))))).toBe("wrong_source");
  });

  it("refuses an operation with another source account", () => {
    const args = depositArgs();
    const op = Operation.invokeContractFunction({
      contract: VAULT,
      function: "deposit",
      args,
      auth: [sourceAuth(invocation(VAULT, "deposit", args, [transferInv()]))],
      source: other,
    });
    expect(reasonOf(() => verifyVaultTx(params("deposit", build("deposit", { ops: [op] }))))).toBe("wrong_source");
  });

  it("refuses an authorization with an unexpected sub-invocation", () => {
    const args = depositArgs();
    const secondTransfer = invocation(ASSET, "transfer", [addr(caller), addr(other), i128(AMOUNT * 100n)]);
    const extra = build("deposit", { auth: [sourceAuth(invocation(VAULT, "deposit", args, [transferInv(), secondTransfer]))] });
    expect(reasonOf(() => verifyVaultTx(params("deposit", extra)))).toBe("wrong_auth");

    const elsewhere = build("deposit", { auth: [sourceAuth(invocation(VAULT, "deposit", args, [transferInv(AMOUNT, other)]))] });
    expect(reasonOf(() => verifyVaultTx(params("deposit", elsewhere)))).toBe("wrong_auth");

    const otherToken = build("deposit", {
      auth: [sourceAuth(invocation(VAULT, "deposit", args, [transferInv(AMOUNT, VAULT, OTHER_CONTRACT)]))],
    });
    expect(reasonOf(() => verifyVaultTx(params("deposit", otherToken)))).toBe("wrong_auth");

    const wArgs = withdrawArgs();
    const withdrawWithTransfer = build("withdraw", {
      auth: [sourceAuth(invocation(VAULT, "withdraw", wArgs, [transferInv()]))],
    });
    expect(reasonOf(() => verifyVaultTx(params("withdraw", withdrawWithTransfer)))).toBe("wrong_auth");
  });

  it("refuses an authorization for other arguments than the call, or a second authorization", () => {
    const args = depositArgs();
    const mismatched = build("deposit", {
      args,
      auth: [sourceAuth(invocation(VAULT, "deposit", depositArgs(AMOUNT * 2n), [transferInv(AMOUNT * 2n)]))],
    });
    expect(reasonOf(() => verifyVaultTx(params("deposit", mismatched)))).toBe("wrong_auth");

    const two = build("deposit", {
      auth: [
        sourceAuth(invocation(VAULT, "deposit", args, [transferInv()])),
        sourceAuth(invocation(ASSET, "transfer", [addr(caller), addr(other), i128(AMOUNT)])),
      ],
    });
    expect(reasonOf(() => verifyVaultTx(params("deposit", two)))).toBe("wrong_auth");
  });

  it("refuses an authorization signed for another address", () => {
    const args = depositArgs();
    const entry = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
        new xdr.SorobanAddressCredentials({
          address: new Address(other).toScAddress(),
          nonce: xdr.Int64.fromString("1"),
          signatureExpirationLedger: 100,
          signature: xdr.ScVal.scvVoid(),
        }),
      ),
      rootInvocation: invocation(VAULT, "deposit", args, [transferInv()]),
    });
    expect(reasonOf(() => verifyVaultTx(params("deposit", build("deposit", { auth: [entry] }))))).toBe("wrong_auth");
  });

  it("refuses a fee-bump envelope", () => {
    const inner = TransactionBuilder.fromXDR(build("deposit"), NET) as ReturnType<TransactionBuilder["build"]>;
    const bumped = TransactionBuilder.buildFeeBumpTransaction(Keypair.random(), "1000000", inner, NET).toXDR();
    expect(reasonOf(() => verifyVaultTx(params("deposit", bumped)))).toBe("fee_bump");
  });

  it("refuses a fee above the cap", () => {
    const fee = (MAX_EARN_FEE_STROOPS + 1n).toString();
    expect(reasonOf(() => verifyVaultTx(params("deposit", build("deposit", { fee }))))).toBe("fee_too_high");
  });

  it("refuses everything when no vault is configured", () => {
    expect(reasonOf(() => verifyVaultTx(params("deposit", build("deposit"), { vaultId: "" })))).toBe("not_configured");
    expect(reasonOf(() => verifyVaultTx(params("withdraw", build("withdraw"), { vaultId: "" })))).toBe("not_configured");
    expect(reasonOf(() => verifyVaultTx(params("deposit", build("deposit"), { assetContractId: "" })))).toBe(
      "not_configured",
    );
  });

  it("refuses something that is not a transaction", () => {
    expect(reasonOf(() => verifyVaultTx(params("deposit", "AAAA")))).toBe("unreadable");
  });
});
