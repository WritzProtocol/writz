import { describe, expect, test } from "bun:test";
import type { PollarClient } from "@pollar/core";
import { Account, Asset, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import type { SigningIntent } from "./intent";
import { SignatureRejectedError } from "./rejection";
import { checkSignedEnvelope, createSignTransaction, SignedTxMismatchError, signWithIntentCheck, type KitSigner, type SignResult } from "./sign";
import { SigningReviews, type SigningReview } from "./signingReview";
import { addr, CALLER, callTx, ENV, feeBumped, i128, IDS, other, signedByUser, user } from "./testTx";

const AMOUNT = 100_0000000n;
const SUPPLY = {
  contract: IDS.writzLend,
  fn: "supply_usdc",
  args: [addr(CALLER), i128(AMOUNT)],
  subs: [{ contract: IDS.usdc, fn: "transfer", args: [addr(CALLER), addr(IDS.writzLend), i128(AMOUNT)] }],
};
const INTENT: SigningIntent = { kind: "writz-lend.supply", amount: AMOUNT };
const GOOD = callTx({ call: SUPPLY });
const STEAL = callTx({
  call: { contract: IDS.usdc, fn: "transfer", args: [addr(CALLER), addr(other.publicKey()), i128(5_000_0000000n)] },
});

/** A fake Pollar: records each call and signs the way the real one does (sponsored calls come back fee-bumped). */
function fakePollar(answer: (xdr: string) => string = (x) => feeBumped(x)) {
  const calls: string[] = [];
  const sign = async (xdr: string): Promise<SignResult> => {
    calls.push(xdr);
    return { signedTxXdr: answer(xdr), signerAddress: CALLER };
  };
  return { calls, sign };
}

/** Answers the next review with `answer` once it appears, and records it. */
function answering(reviews: SigningReviews, answer: "sign" | "cancel") {
  const seen: SigningReview[] = [];
  reviews.subscribe(() => {
    const r = reviews.get();
    if (r && !seen.includes(r)) {
      seen.push(r);
      queueMicrotask(() => reviews.answer(r.id, answer));
    }
  });
  return seen;
}

const run = (xdr: string, intent: SigningIntent | undefined, reviews: SigningReviews, pollar = fakePollar(), confirmAboveUsdc: bigint | null = null) =>
  signWithIntentCheck({ xdr, intent, caller: CALLER, env: ENV, reviews, confirmAboveUsdc, sign: () => pollar.sign(xdr) });

describe("signWithIntentCheck (the embedded Pollar wallet)", () => {
  test("a transaction that matches its intent is signed with no review", async () => {
    const reviews = new SigningReviews();
    let shown = 0;
    reviews.subscribe(() => shown++);
    const pollar = fakePollar();
    const r = await run(GOOD, INTENT, reviews, pollar);
    expect(pollar.calls).toEqual([GOOD]);
    expect(shown).toBe(0);
    expect(reviews.get()).toBeNull();
    expect(r.signerAddress).toBe(CALLER);
  });

  test("a mismatch is shown with what was asked and what it would do, and Pollar is never asked", async () => {
    const reviews = new SigningReviews();
    const seen = answering(reviews, "sign");
    const pollar = fakePollar();
    const err = await run(STEAL, INTENT, reviews, pollar).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SignatureRejectedError);
    expect((err as SignatureRejectedError).walletName).toBe("Pollar");
    expect(pollar.calls).toEqual([]);
    expect(seen).toHaveLength(1);
    expect(seen[0].mode).toBe("mismatch");
    expect(seen[0].asked).toBe("Supply 100.00 USDC to the lending pool");
    expect(seen[0].actual[0]).toMatch(/^Send 5,000.00 USDC to G/);
    expect(seen[0].detail).toMatch(/^wrong_contract/);
  });

  test("a mismatch cannot be signed even if the store is answered with sign", async () => {
    const reviews = new SigningReviews();
    const pending = run(STEAL, INTENT, reviews);
    await Promise.resolve();
    reviews.answer(reviews.get()!.id, "sign");
    expect(await pending.catch((e: unknown) => e)).toBeInstanceOf(SignatureRejectedError);
  });

  test("no intent shows the unknown review; Cancel rejects the way a declined wallet does", async () => {
    const reviews = new SigningReviews();
    const seen = answering(reviews, "cancel");
    const pollar = fakePollar();
    const err = await run(GOOD, undefined, reviews, pollar).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SignatureRejectedError);
    expect(seen[0].mode).toBe("unknown");
    expect(seen[0].asked).toBeNull();
    expect(pollar.calls).toEqual([]);
  });

  test("Sign anyway on an unknown transaction signs it", async () => {
    const reviews = new SigningReviews();
    answering(reviews, "sign");
    const pollar = fakePollar();
    await run(GOOD, undefined, reviews, pollar);
    expect(pollar.calls).toEqual([GOOD]);
  });

  test("two signing calls at once both wait for their own answer; the second is not reported as declined", async () => {
    const reviews = new SigningReviews();
    const a = fakePollar();
    const b = fakePollar();
    const first = run(GOOD, undefined, reviews, a);
    const second = run(GOOD, undefined, reviews, b);
    await Promise.resolve();
    const shown = reviews.get()!;
    expect(reviews.queued()).toBe(1);
    reviews.answer(shown.id, "sign");
    await first;
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(0);
    reviews.answer(reviews.get()!.id, "sign");
    await second;
    expect(b.calls).toHaveLength(1);
  });

  test("above the large-amount limit a matching transaction asks to confirm; Confirm signs, Cancel rejects", async () => {
    const confirm = new SigningReviews();
    const seen = answering(confirm, "sign");
    const pollar = fakePollar();
    await run(GOOD, INTENT, confirm, pollar, AMOUNT - 1n);
    expect(seen[0].mode).toBe("large");
    expect(seen[0].limit).toBe(AMOUNT - 1n);
    expect(seen[0].asked).toBe("Supply 100.00 USDC to the lending pool");
    expect(pollar.calls).toHaveLength(1);

    const cancel = new SigningReviews();
    answering(cancel, "cancel");
    const declined = fakePollar();
    expect(await run(GOOD, INTENT, cancel, declined, AMOUNT - 1n).catch((e: unknown) => e)).toBeInstanceOf(SignatureRejectedError);
    expect(declined.calls).toEqual([]);
  });

  test("at or below the limit, or with the limit off, nothing is asked", async () => {
    for (const limit of [AMOUNT, AMOUNT + 1n, null]) {
      const reviews = new SigningReviews();
      let shown = 0;
      reviews.subscribe(() => shown++);
      await run(GOOD, INTENT, reviews, fakePollar(), limit);
      expect(shown).toBe(0);
    }
  });

  test("an intent with no USDC (a trustline) never asks for the large amount", async () => {
    const reviews = new SigningReviews();
    let shown = 0;
    reviews.subscribe(() => shown++);
    const trust = new TransactionBuilder(new Account(CALLER, "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.changeTrust({ asset: new Asset("USDC", other.publicKey()) }))
      .setTimeout(30)
      .build()
      .toXDR();
    await run(trust, { kind: "trustline", asset: { code: "USDC", issuer: other.publicKey() } }, reviews, fakePollar((x) => signedByUser(x)), 1n);
    expect(shown).toBe(0);
  });

  test("what Pollar hands back must be the transaction checked", async () => {
    const swapped = fakePollar(() => feeBumped(callTx({ call: SUPPLY, fee: "100001" })));
    // A different inner transaction that still matches the intent is accepted (Pollar may re-bid the fee).
    await run(GOOD, INTENT, new SigningReviews(), swapped);

    const stolen = fakePollar(() => feeBumped(STEAL));
    expect(await run(GOOD, INTENT, new SigningReviews(), stolen).catch((e: unknown) => e)).toBeInstanceOf(SignedTxMismatchError);

    const userPays = fakePollar((x) => feeBumped(x, user));
    expect(await run(GOOD, INTENT, new SigningReviews(), userPays).catch((e: unknown) => e)).toBeInstanceOf(SignedTxMismatchError);
  });
});

describe("checkSignedEnvelope", () => {
  const base = { unsignedXdr: GOOD, intent: INTENT, caller: CALLER, env: ENV };
  test("accepts the same transaction signed by the user, or fee-bumped by the gas wallet", () => {
    expect(checkSignedEnvelope({ ...base, signedXdr: signedByUser(GOOD) })).toBeNull();
    expect(checkSignedEnvelope({ ...base, signedXdr: feeBumped(GOOD) })).toBeNull();
  });
  test("refuses another transaction, a fee-bump paid by the user and an unreadable envelope", () => {
    expect(checkSignedEnvelope({ ...base, signedXdr: signedByUser(STEAL) })).toMatch(/signed transaction/);
    expect(checkSignedEnvelope({ ...base, signedXdr: feeBumped(GOOD, user) })).toMatch(/paid by the user/);
    expect(checkSignedEnvelope({ ...base, signedXdr: "x" })).toMatch(/can't be read/);
    expect(checkSignedEnvelope({ ...base, intent: undefined, signedXdr: signedByUser(callTx({ call: SUPPLY, fee: "100001" })) })).toMatch(
      /not the one reviewed/,
    );
  });
});

function fakeKit(calls: unknown[]): KitSigner {
  return {
    getAddress: async () => ({ address: CALLER }),
    getNetwork: async () => ({ networkPassphrase: Networks.TESTNET }),
    signTransaction: async (xdr, opts) => {
      calls.push({ xdr, opts });
      return { signedTxXdr: signedByUser(xdr), signerAddress: CALLER };
    },
  };
}

const FUNDED = { balances: [{ asset_type: "native", balance: "1000.0000000" }], subentry_count: 0 };

function deps(backend: "kit" | "pollar", over: Partial<Parameters<typeof createSignTransaction>[0]> = {}) {
  const reviews = new SigningReviews();
  const kitCalls: unknown[] = [];
  const pollarCalls: unknown[] = [];
  const client = {
    signTx: async (xdr: string, opts: unknown) => {
      pollarCalls.push({ xdr, opts });
      return { status: "signed", signedXdr: feeBumped(xdr) };
    },
  } as unknown as PollarClient;
  const sign = createSignTransaction({
    backend,
    networkPassphrase: Networks.TESTNET,
    kit: () => fakeKit(kitCalls),
    kitWalletName: () => "Freighter",
    pollar: () => ({ client, signer: CALLER }),
    loadAccount: async () => FUNDED,
    reviews,
    confirmAboveUsdc: 1n,
    env: () => ENV,
    ...over,
  });
  return { sign, reviews, kitCalls, pollarCalls };
}

describe("createSignTransaction (WalletProvider's signTransaction)", () => {
  test("Pollar: a matching call is signed with sponsorship, after the check", async () => {
    const d = deps("pollar", { confirmAboveUsdc: null });
    let shown = 0;
    d.reviews.subscribe(() => shown++);
    const r = await d.sign(GOOD, { intent: INTENT });
    expect(d.pollarCalls).toEqual([{ xdr: GOOD, opts: { skipSponsorship: false } }]);
    expect(shown).toBe(0);
    expect(TransactionBuilder.fromXDR(r.signedTxXdr, Networks.TESTNET)).toHaveProperty("innerTransaction");
  });

  test("Pollar: a mismatch never reaches Pollar's signTx", async () => {
    const d = deps("pollar");
    answering(d.reviews, "cancel");
    expect(await d.sign(STEAL, { intent: INTENT }).catch((e: unknown) => e)).toBeInstanceOf(SignatureRejectedError);
    expect(d.pollarCalls).toEqual([]);
  });

  test("Pollar: the intent survives the contract bindings' own options", async () => {
    const d = deps("pollar", { confirmAboveUsdc: null });
    await d.sign(GOOD, { networkPassphrase: Networks.TESTNET, intent: INTENT });
    expect(d.pollarCalls).toHaveLength(1);
  });

  test("kit: unchanged; the wallet's own window decides, no check and no review, whatever the intent says", async () => {
    const d = deps("kit");
    let shown = 0;
    d.reviews.subscribe(() => shown++);
    const r = await d.sign(STEAL, { intent: INTENT });
    expect(d.kitCalls).toEqual([{ xdr: STEAL, opts: { address: CALLER, networkPassphrase: Networks.TESTNET } }]);
    expect(shown).toBe(0);
    expect(r.signerAddress).toBe(CALLER);
  });

  test("kit: a declined window is still a SignatureRejectedError with the wallet's name", async () => {
    const d = deps("kit", {
      kit: () => ({ ...fakeKit([]), signTransaction: async () => Promise.reject({ code: -4, message: "User declined access" }) }),
    });
    const err = await d.sign(GOOD).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SignatureRejectedError);
    expect((err as SignatureRejectedError).walletName).toBe("Freighter");
  });
});
