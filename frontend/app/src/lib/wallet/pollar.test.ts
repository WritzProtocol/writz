import { describe, expect, it } from "bun:test";
import type { PollarClient } from "@pollar/core";
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { PollarSignError, signMessageWithPollar, signTransactionWithPollar, wantsSponsorship } from "./pollar";

const user = Keypair.random();
const gas = Keypair.random();

function build(op: xdr.Operation): ReturnType<TransactionBuilder["build"]> {
  return new TransactionBuilder(new Account(user.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(op)
    .setTimeout(30)
    .build();
}

const invoke = () =>
  build(Operation.invokeContractFunction({ contract: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC", function: "borrow", args: [] }));
const trust = () => build(Operation.changeTrust({ asset: new Asset("USDC", Keypair.random().publicKey()) }));
const proof = () => build(Operation.manageData({ name: "writz_insert", value: Buffer.alloc(32) }));

function feeBumped(inner: ReturnType<typeof build>): string {
  inner.sign(user);
  const bump = TransactionBuilder.buildFeeBumpTransaction(gas, "200", inner, Networks.TESTNET);
  bump.sign(gas);
  return bump.toXDR();
}

function fakeClient(signTx: PollarClient["signTx"], signMessage?: (m: string) => Promise<unknown>): PollarClient {
  return { signTx, stellar: { sep53: { signMessage } } } as unknown as PollarClient;
}

describe("wantsSponsorship", () => {
  it("sponsors contract calls and trustlines", () => {
    expect(wantsSponsorship(invoke().toXDR())).toBe(true);
    expect(wantsSponsorship(trust().toXDR())).toBe(true);
  });

  it("never sponsors an envelope with no contract call or trustline", () => {
    expect(wantsSponsorship(proof().toXDR())).toBe(false);
  });

  it("refuses an envelope that is already fee-bumped", () => {
    expect(() => wantsSponsorship(feeBumped(invoke()))).toThrow(/fee-bump/);
  });
});

describe("signTransactionWithPollar", () => {
  it("asks for sponsorship on a contract call and reports the fee-bumped envelope", async () => {
    const calls: unknown[] = [];
    const tx = invoke();
    const client = fakeClient(async (x, opts) => {
      calls.push(opts);
      return { status: "signed", signedXdr: feeBumped(TransactionBuilder.fromXDR(x, Networks.TESTNET) as typeof tx) };
    });
    const r = await signTransactionWithPollar(client, tx.toXDR(), user.publicKey());
    expect(calls).toEqual([{ skipSponsorship: false }]);
    expect(r.sponsored).toBe(true);
    expect(r.signerAddress).toBe(user.publicKey());
  });

  it("skips sponsorship for a manageData envelope and returns it signed by the user only", async () => {
    const calls: unknown[] = [];
    const client = fakeClient(async (x, opts) => {
      calls.push(opts);
      const t = TransactionBuilder.fromXDR(x, Networks.TESTNET) as ReturnType<typeof build>;
      t.sign(user);
      return { status: "signed", signedXdr: t.toXDR() };
    });
    const r = await signTransactionWithPollar(client, proof().toXDR(), user.publicKey());
    expect(calls).toEqual([{ skipSponsorship: true }]);
    expect(r.sponsored).toBe(false);
  });

  it("turns an error outcome into a thrown error with Pollar's code", async () => {
    const client = fakeClient(async () => ({ status: "error", code: "SDK_WALLET_NOT_READY", details: "not on ledger" }));
    const err = await signTransactionWithPollar(client, invoke().toXDR(), user.publicKey()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PollarSignError);
    expect((err as PollarSignError).code).toBe("SDK_WALLET_NOT_READY");
    expect((err as Error).message).toBe("not on ledger");
  });
});

describe("signMessageWithPollar", () => {
  it("returns the SEP-53 signature as is", async () => {
    const client = fakeClient(
      async () => ({ status: "error" }),
      async () => ({ status: "signed", signature: "c2ln", signerAddress: user.publicKey(), scheme: "sep53" }),
    );
    expect(await signMessageWithPollar(client, "hello")).toBe("c2ln");
  });

  it("throws when Pollar does not sign", async () => {
    const client = fakeClient(
      async () => ({ status: "error" }),
      async () => ({ status: "error", code: "SDK_SMART_WALLET", details: "no classic key" }),
    );
    await expect(signMessageWithPollar(client, "hello")).rejects.toThrow("no classic key");
  });
});
