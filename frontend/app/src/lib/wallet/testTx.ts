/**
 * Test data only: builders for the transactions the signing check reads, with
 * a fixed set of contract ids. Not imported by the app.
 */
import { Buffer } from "buffer";
import {
  Account,
  Address,
  Asset,
  Keypair,
  nativeToScVal,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import type { SigningEnv } from "./verifyIntent";

const contractId = (seed: number) => StrKey.encodeContract(Buffer.alloc(32, seed));

export const user = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
export const other = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));
export const gas = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3));
export const CALLER = user.publicKey();
export const NOW = 1_800_000_000;

export const IDS = {
  writzLend: contractId(10),
  usdc: contractId(11),
  vault: contractId(12),
  earnAsset: contractId(13),
  router: contractId(14),
  tmm: contractId(15),
  eurc: contractId(16),
  xlm: contractId(17),
  pair: contractId(18),
  stranger: contractId(19),
};

export const ENV: SigningEnv = {
  networkPassphrase: Networks.TESTNET,
  writzLend: IDS.writzLend,
  usdcToken: IDS.usdc,
  earnVault: IDS.vault,
  earnAsset: IDS.earnAsset,
  router: IDS.router,
  tokenMessengerMinter: IDS.tmm,
  cctpDomain: 6,
  names: {
    [IDS.writzLend]: "the Writz lending pool",
    [IDS.usdc]: "USDC",
    [IDS.vault]: "the Earn vault",
    [IDS.router]: "the Soroswap router",
    [IDS.tmm]: "Circle's bridge",
    [IDS.eurc]: "EURC",
    [IDS.xlm]: "XLM",
  },
  now: () => NOW,
};

export const addr = (s: string) => Address.fromString(s).toScVal();
export const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });

export interface Inv {
  contract: string;
  fn: string;
  args: xdr.ScVal[];
  subs?: Inv[];
}

export function invocation(i: Inv): xdr.SorobanAuthorizedInvocation {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(i.contract).toScAddress(),
        functionName: i.fn,
        args: i.args,
      }),
    ),
    subInvocations: (i.subs ?? []).map(invocation),
  });
}

/** An authorization entry with source-account credentials, or address credentials for `forAddress`. */
export function authEntry(root: Inv, forAddress?: string): xdr.SorobanAuthorizationEntry {
  const credentials = forAddress
    ? xdr.SorobanCredentials.sorobanCredentialsAddress(
        new xdr.SorobanAddressCredentials({
          address: Address.fromString(forAddress).toScAddress(),
          nonce: xdr.Int64.fromString("1"),
          signatureExpirationLedger: 100,
          signature: xdr.ScVal.scvVoid(),
        }),
      )
    : xdr.SorobanCredentials.sorobanCredentialsSourceAccount();
  return new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation: invocation(root) });
}

export interface CallTx {
  call: Inv;
  /** Defaults to one source-account entry over `call`. */
  auth?: xdr.SorobanAuthorizationEntry[];
  source?: string;
  opSource?: string;
  fee?: string;
  extraOp?: boolean;
}

/** A one-call transaction (or more, with `extraOp`), unsigned, as base64. */
export function callTx(t: CallTx): string {
  const builder = new TransactionBuilder(new Account(t.source ?? CALLER, "1"), {
    fee: t.fee ?? "100000",
    networkPassphrase: Networks.TESTNET,
  });
  builder.addOperation(
    Operation.invokeContractFunction({
      contract: t.call.contract,
      function: t.call.fn,
      args: t.call.args,
      auth: t.auth ?? [authEntry(t.call)],
      source: t.opSource,
    }),
  );
  if (t.extraOp) builder.addOperation(Operation.payment({ destination: other.publicKey(), asset: Asset.native(), amount: "100" }));
  return builder.setTimeout(30).build().toXDR();
}

/** `unsigned` signed by the user and wrapped in a fee-bump paid by `payer`. */
export function feeBumped(unsigned: string, payer = gas): string {
  const inner = TransactionBuilder.fromXDR(unsigned, Networks.TESTNET);
  if (!("sign" in inner) || "innerTransaction" in inner) throw new Error("not an inner transaction");
  inner.sign(user);
  const bump = TransactionBuilder.buildFeeBumpTransaction(payer, "200000", inner, Networks.TESTNET);
  bump.sign(payer);
  return bump.toXDR();
}

/** `unsigned` signed by the user only. */
export function signedByUser(unsigned: string): string {
  const tx = TransactionBuilder.fromXDR(unsigned, Networks.TESTNET);
  if ("innerTransaction" in tx) throw new Error("fee-bump");
  tx.sign(user);
  return tx.toXDR();
}
