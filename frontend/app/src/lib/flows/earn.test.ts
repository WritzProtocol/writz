import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Account, Address, Asset, Keypair, Operation, TransactionBuilder, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { config } from "@/config";
import { VaultTxMismatchError } from "@/lib/earn/verifyVaultTx";

// The vault asset the check pins deposits to, as a deployment configures it.
const ASSET = new Asset("USDC", "GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56");
Object.assign(config.earn.asset, { code: ASSET.code, issuer: ASSET.issuer });
const VAULT = config.earn.vaultId;
const ASSET_SAC = ASSET.contractId(config.networkPassphrase);

const user = Keypair.random().publicKey();
const someoneElse = Keypair.random().publicKey();
const AMOUNT = 10_000_000n;

const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });
const addr = (a: string) => new Address(a).toScVal();

function invocation(contract: string, fn: string, args: xdr.ScVal[], subs: xdr.SorobanAuthorizedInvocation[] = []) {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({ contractAddress: new Address(contract).toScAddress(), functionName: fn, args }),
    ),
    subInvocations: subs,
  });
}

function envelope(op: xdr.Operation): string {
  return new TransactionBuilder(new Account(user, "1"), { fee: "100000", networkPassphrase: config.networkPassphrase })
    .addOperation(op)
    .setTimeout(300)
    .build()
    .toXDR();
}

function contractCall(contract: string, fn: string, args: xdr.ScVal[], subs: xdr.SorobanAuthorizedInvocation[] = []) {
  return envelope(
    Operation.invokeContractFunction({
      contract,
      function: fn,
      args,
      auth: [
        new xdr.SorobanAuthorizationEntry({
          credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
          rootInvocation: invocation(contract, fn, args, subs),
        }),
      ],
    }),
  );
}

// A classic payment of the user's USDC to someone else, presented as a deposit.
const payment = envelope(Operation.payment({ destination: someoneElse, asset: ASSET, amount: "1000000" }));
// A direct call to the asset contract moving the user's USDC elsewhere.
const directTransfer = contractCall(ASSET_SAC, "transfer", [addr(user), addr(someoneElse), i128(AMOUNT * 100n)]);
// The real thing.
const depositArgs = [xdr.ScVal.scvVec([i128(AMOUNT)]), xdr.ScVal.scvVec([i128(AMOUNT)]), addr(user), xdr.ScVal.scvBool(true)];
const genuineDeposit = contractCall(VAULT, "deposit", depositArgs, [
  invocation(ASSET_SAC, "transfer", [addr(user), addr(VAULT), i128(AMOUNT)]),
]);
const genuineWithdraw = contractCall(VAULT, "withdraw", [i128(9_990_000n), xdr.ScVal.scvVec([i128(AMOUNT)]), addr(user)]);

let built: { deposit: string; withdraw: string } = { deposit: genuineDeposit, withdraw: genuineWithdraw };
mock.module("@/lib/earn/api", () => ({
  earnApi: () => ({
    buildDeposit: async () => ({ xdr: built.deposit }),
    buildWithdraw: async () => ({ xdr: built.withdraw }),
  }),
}));

const { depositToVault, withdrawFromVault } = await import("./earn");

class Stop extends Error {}
const signed: string[] = [];
const intents: unknown[] = [];
const signTransaction = async (txXdr: string, opts?: { intent?: unknown }): Promise<{ signedTxXdr: string; signerAddress: string }> => {
  signed.push(txXdr);
  intents.push(opts?.intent);
  throw new Stop("stopped before submission");
};

const flows = [
  ["depositToVault", depositToVault],
  ["withdrawFromVault", withdrawFromVault],
] as const;

beforeEach(() => {
  signed.length = 0;
  intents.length = 0;
});

describe("Earn flows check the relayer's transaction before the wallet sees it", () => {
  for (const [name, run] of flows) {
    for (const [label, bad] of [
      ["a classic USDC payment", payment],
      ["a direct asset transfer", directTransfer],
    ] as const) {
      it(`${name} refuses ${label} and never calls signTransaction`, async () => {
        built = { deposit: bad, withdraw: bad };
        const emitted: string[] = [];
        await expect(
          run({ amountStroops: AMOUNT, caller: user, signTransaction, emit: (e) => emitted.push(e.type) }),
        ).rejects.toBeInstanceOf(VaultTxMismatchError);
        expect(signed).toEqual([]);
        expect(emitted).toEqual([]);
      });
    }
  }

  it("refuses a deposit of a different amount than requested", async () => {
    built = { deposit: genuineDeposit, withdraw: genuineWithdraw };
    await expect(depositToVault({ amountStroops: AMOUNT / 2n, caller: user, signTransaction })).rejects.toBeInstanceOf(
      VaultTxMismatchError,
    );
    expect(signed).toEqual([]);
  });

  it("hands the genuine vault calls to the wallet unchanged", async () => {
    built = { deposit: genuineDeposit, withdraw: genuineWithdraw };
    await expect(depositToVault({ amountStroops: AMOUNT, caller: user, signTransaction })).rejects.toBeInstanceOf(Stop);
    await expect(withdrawFromVault({ amountStroops: AMOUNT, caller: user, signTransaction })).rejects.toBeInstanceOf(Stop);
    expect(signed).toEqual([genuineDeposit, genuineWithdraw]);
  });

  it("declares what each call is for, so the embedded wallet can check it before signing", async () => {
    built = { deposit: genuineDeposit, withdraw: genuineWithdraw };
    await expect(depositToVault({ amountStroops: AMOUNT, caller: user, signTransaction })).rejects.toBeInstanceOf(Stop);
    await expect(withdrawFromVault({ amountStroops: AMOUNT, caller: user, signTransaction })).rejects.toBeInstanceOf(Stop);
    expect(intents).toEqual([
      { kind: "earn.deposit", amount: AMOUNT },
      { kind: "earn.withdraw", amount: AMOUNT },
    ]);
  });
});
