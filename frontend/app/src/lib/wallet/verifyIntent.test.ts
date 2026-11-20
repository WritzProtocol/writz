import { describe, expect, test } from "bun:test";
import { Buffer } from "buffer";
import { Account, Address, Asset, nativeToScVal, Networks, Operation, scValToBigInt, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { LIVE_ASSET, LIVE_CALLER, LIVE_DEPOSIT, LIVE_VAULT, LIVE_WITHDRAW } from "@/lib/earn/vaultTxFixtures";
import type { SigningIntent } from "./intent";
import {
  bitcoinTxid,
  checkIntent,
  describeRequest,
  describeTx,
  MAX_CALL_FEE,
  MAX_DEPOSIT_FEE,
  MAX_TRUSTLINE_FEE,
} from "./verifyIntent";
import { addr, authEntry, CALLER, callTx, ENV, feeBumped, i128, IDS, NOW, other, type Inv } from "./testTx";

const TXID = "a1".repeat(32);
const internal = () => nativeToScVal(Buffer.from(TXID, "hex").reverse());
const RAW = Buffer.from("0200000001" + "ab".repeat(60), "hex");
const bytes = (n: number) => nativeToScVal(Buffer.alloc(n, 7));
const u32 = (n: number) => nativeToScVal(n, { type: "u32" });
const u64 = (n: number) => nativeToScVal(BigInt(n), { type: "u64" });
const path = (p: string[]) => nativeToScVal(p.map((id) => Address.fromString(id)));
const RECIPIENT = "0x" + "12".repeat(20);

interface Case {
  name: string;
  intent: SigningIntent;
  call: Inv;
  /** Index of the amount argument, for the wrong-amount mutation. */
  amountAt: number;
  maxFee: bigint;
}

const transfer = (token: string, to: string, amount: bigint): Inv => ({
  contract: token,
  fn: "transfer",
  args: [addr(CALLER), addr(to), i128(amount)],
});

const CASES: Case[] = [
  {
    name: "writz-lend.borrow",
    intent: { kind: "writz-lend.borrow", txid: TXID, amount: 200_0000000n },
    call: { contract: IDS.writzLend, fn: "borrow", args: [addr(CALLER), internal(), i128(200_0000000n)] },
    amountAt: 2,
    maxFee: MAX_CALL_FEE,
  },
  {
    name: "writz-lend.repay",
    intent: { kind: "writz-lend.repay", txid: TXID, amount: 50_0000000n },
    call: {
      contract: IDS.writzLend,
      fn: "repay",
      args: [addr(CALLER), internal(), i128(50_0000000n)],
      subs: [transfer(IDS.usdc, IDS.writzLend, 50_0000000n)],
    },
    amountAt: 2,
    maxFee: MAX_CALL_FEE,
  },
  {
    name: "writz-lend.repay (close)",
    intent: { kind: "writz-lend.repay", txid: TXID, amount: 0n },
    call: {
      contract: IDS.writzLend,
      fn: "repay",
      args: [addr(CALLER), internal(), i128(0n)],
      subs: [transfer(IDS.usdc, IDS.writzLend, 0n)],
    },
    amountAt: 2,
    maxFee: MAX_CALL_FEE,
  },
  {
    name: "writz-lend.supply",
    intent: { kind: "writz-lend.supply", amount: 100_0000000n },
    call: {
      contract: IDS.writzLend,
      fn: "supply_usdc",
      args: [addr(CALLER), i128(100_0000000n)],
      subs: [transfer(IDS.usdc, IDS.writzLend, 100_0000000n)],
    },
    amountAt: 1,
    maxFee: MAX_CALL_FEE,
  },
  {
    name: "writz-lend.withdraw",
    intent: { kind: "writz-lend.withdraw", amount: 100_0000000n },
    call: { contract: IDS.writzLend, fn: "withdraw_supply", args: [addr(CALLER), i128(100_0000000n)] },
    amountAt: 1,
    maxFee: MAX_CALL_FEE,
  },
  {
    name: "writz-lend.deposit",
    intent: { kind: "writz-lend.deposit", btcTxid: bitcoinTxid(RAW) },
    call: {
      contract: IDS.writzLend,
      fn: "deposit",
      args: [addr(CALLER), bytes(32), nativeToScVal([Buffer.alloc(32, 1)]), u32(3), nativeToScVal(RAW), bytes(34), u32(330_000), bytes(33), bytes(65)],
    },
    amountAt: 4,
    maxFee: MAX_DEPOSIT_FEE,
  },
  {
    name: "swap.exact-in",
    intent: { kind: "swap.exact-in", amountIn: 50_0000000n, minOut: 45_0000000n, path: [IDS.usdc, IDS.eurc] },
    call: {
      contract: IDS.router,
      fn: "swap_exact_tokens_for_tokens",
      args: [i128(50_0000000n), i128(45_0000000n), path([IDS.usdc, IDS.eurc]), addr(CALLER), u64(NOW + 300)],
      subs: [transfer(IDS.usdc, IDS.pair, 50_0000000n)],
    },
    amountAt: 0,
    maxFee: MAX_CALL_FEE,
  },
  {
    name: "swap.exact-out",
    intent: { kind: "swap.exact-out", amountOut: 3_0000000n, maxIn: 25_0000000n, path: [IDS.xlm, IDS.usdc] },
    call: {
      contract: IDS.router,
      fn: "swap_tokens_for_exact_tokens",
      args: [i128(3_0000000n), i128(25_0000000n), path([IDS.xlm, IDS.usdc]), addr(CALLER), u64(NOW + 300)],
      subs: [transfer(IDS.xlm, IDS.pair, 24_0000000n)],
    },
    amountAt: 0,
    maxFee: MAX_CALL_FEE,
  },
  {
    name: "cctp.approve",
    intent: { kind: "cctp.approve", amount: 50_0000000n },
    call: { contract: IDS.usdc, fn: "approve", args: [addr(CALLER), addr(IDS.tmm), i128(50_0000000n), u32(1_000)] },
    amountAt: 2,
    maxFee: MAX_CALL_FEE,
  },
  {
    name: "cctp.burn",
    intent: { kind: "cctp.burn", amount: 50_0000000n, maxFee: 5000n, recipient: RECIPIENT },
    call: {
      contract: IDS.tmm,
      fn: "deposit_for_burn",
      args: [
        addr(CALLER),
        i128(50_0000000n),
        u32(6),
        nativeToScVal(Buffer.concat([Buffer.alloc(12), Buffer.from("12".repeat(20), "hex")])),
        addr(IDS.usdc),
        nativeToScVal(Buffer.alloc(32)),
        i128(5000n),
        u32(2000),
      ],
    },
    amountAt: 1,
    maxFee: MAX_CALL_FEE,
  },
];

const check = (envelope: string, intent: SigningIntent | undefined, caller = CALLER) => checkIntent(envelope, intent, caller, ENV);

/** `call` with the argument at `i` replaced, in the operation and the authorization alike. */
function withArg(call: Inv, i: number, v: xdr.ScVal): Inv {
  const args = [...call.args];
  args[i] = v;
  return { ...call, args };
}

function bumpAmount(v: xdr.ScVal): xdr.ScVal {
  if (v.switch().name === "scvI128") return i128(scValToBigInt(v) + 1n);
  return nativeToScVal(Buffer.from("0100000001" + "cd".repeat(60), "hex"));
}

describe.each(CASES)("checkIntent: $name", (c: Case) => {
  test("accepts exactly the requested call, with source-account or caller-address authorization", () => {
    expect(check(callTx({ call: c.call }), c.intent).status).toBe("match");
    expect(check(callTx({ call: c.call, auth: [authEntry(c.call, CALLER)] }), c.intent).status).toBe("match");
  });

  const mismatch = (envelope: string, reason?: string) => {
    const v = check(envelope, c.intent);
    expect(v.status).toBe("mismatch");
    if (reason && v.status === "mismatch") expect(v.reason).toBe(reason as never);
  };

  test("refuses another contract", () => mismatch(callTx({ call: { ...c.call, contract: IDS.stranger } }), "wrong_contract"));
  test("refuses another function", () => mismatch(callTx({ call: { ...c.call, fn: "transfer_all" } }), "wrong_function"));
  test("refuses another amount", () => {
    const v = check(callTx({ call: withArg(c.call, c.amountAt, bumpAmount(c.call.args[c.amountAt])) }), c.intent);
    expect(v.status).toBe("mismatch");
  });
  test("refuses another first argument (the account the call acts for)", () => {
    if (c.call.args[0].switch().name !== "scvAddress") return;
    mismatch(callTx({ call: withArg(c.call, 0, addr(other.publicKey())) }), "wrong_arguments");
  });
  test("refuses another source account", () => mismatch(callTx({ call: c.call, source: other.publicKey() }), "wrong_source"));
  test("refuses another operation source", () => mismatch(callTx({ call: c.call, opSource: other.publicKey() }), "wrong_source"));
  test("refuses an extra operation", () => mismatch(callTx({ call: c.call, extraOp: true }), "operation_count"));
  test("refuses an extra authorization entry", () =>
    mismatch(callTx({ call: c.call, auth: [authEntry(c.call), authEntry(transfer(IDS.usdc, IDS.stranger, 1n))] }), "wrong_auth"));
  test("refuses no authorization", () => mismatch(callTx({ call: c.call, auth: [] }), "wrong_auth"));
  test("refuses an extra sub-invocation", () => {
    const auth = authEntry({ ...c.call, subs: [...(c.call.subs ?? []), transfer(IDS.usdc, IDS.stranger, 1n)] });
    mismatch(callTx({ call: c.call, auth: [auth] }), "wrong_auth");
  });
  test("refuses a call nested below the expected tree", () => {
    const subs = c.call.subs?.length
      ? c.call.subs.map((s: Inv) => ({ ...s, subs: [transfer(IDS.usdc, IDS.stranger, 1n)] }))
      : [transfer(IDS.usdc, IDS.stranger, 1n)];
    mismatch(callTx({ call: c.call, auth: [authEntry({ ...c.call, subs })] }), "wrong_auth");
  });
  test("refuses authorization for another address", () =>
    mismatch(callTx({ call: c.call, auth: [authEntry(c.call, other.publicKey())] }), "wrong_auth"));
  test("refuses authorization over other arguments than the call", () => {
    const auth = authEntry(withArg(c.call, c.amountAt, bumpAmount(c.call.args[c.amountAt])));
    mismatch(callTx({ call: c.call, auth: [auth] }), "wrong_auth");
  });
  test("refuses a fee-bump envelope", () => mismatch(feeBumped(callTx({ call: c.call })), "fee_bump"));
  test("accepts the fee cap and refuses one stroop above it", () => {
    expect(check(callTx({ call: c.call, fee: c.maxFee.toString() }), c.intent).status).toBe("match");
    // The deposit's cap is the fee field's own maximum, so nothing above it can be built.
    if (c.maxFee < 4_294_967_295n) mismatch(callTx({ call: c.call, fee: (c.maxFee + 1n).toString() }), "fee_too_high");
  });
  test("refuses an unreadable envelope", () => mismatch("not-xdr", "unreadable"));
});

describe("checkIntent: specific arguments", () => {
  const [, repay] = CASES;
  const swapIn = CASES.find((c) => c.name === "swap.exact-in")!;
  const swapOut = CASES.find((c) => c.name === "swap.exact-out")!;
  const deposit = CASES.find((c) => c.name === "writz-lend.deposit")!;

  test("repay: the USDC transfer must go from the caller to the pool, for the amount", () => {
    const sub = (s: Inv) => authEntry({ ...repay.call, subs: [s] });
    for (const s of [
      transfer(IDS.usdc, IDS.stranger, 50_0000000n),
      transfer(IDS.usdc, IDS.writzLend, 50_0000001n),
      transfer(IDS.eurc, IDS.writzLend, 50_0000000n),
      { ...transfer(IDS.usdc, IDS.writzLend, 50_0000000n), fn: "burn" },
    ]) {
      expect(check(callTx({ call: repay.call, auth: [sub(s)] }), repay.intent).status).toBe("mismatch");
    }
  });

  test("swap: refuses a deadline in the past or far ahead, and another recipient", () => {
    for (const at of [NOW - 1, NOW + 3_600]) {
      expect(check(callTx({ call: withArg(swapIn.call, 4, u64(at)) }), swapIn.intent).status).toBe("mismatch");
    }
    expect(check(callTx({ call: withArg(swapIn.call, 3, addr(other.publicKey())) }), swapIn.intent).status).toBe("mismatch");
    expect(check(callTx({ call: withArg(swapIn.call, 2, path([IDS.usdc, IDS.stranger])) }), swapIn.intent).status).toBe("mismatch");
  });

  test("swap exact-out: the input pulled may not exceed the maximum", () => {
    const over = authEntry({ ...swapOut.call, subs: [transfer(IDS.xlm, IDS.pair, 25_0000001n)] });
    expect(check(callTx({ call: swapOut.call, auth: [over] }), swapOut.intent).status).toBe("mismatch");
    const exact = authEntry({ ...swapOut.call, subs: [transfer(IDS.xlm, IDS.pair, 25_0000000n)] });
    expect(check(callTx({ call: swapOut.call, auth: [exact] }), swapOut.intent).status).toBe("match");
  });

  test("deposit: the raw transaction must be the declared Bitcoin deposit", () => {
    const v = check(callTx({ call: deposit.call }), { kind: "writz-lend.deposit", btcTxid: "00".repeat(32) });
    expect(v.status).toBe("mismatch");
    if (v.status === "mismatch") expect(v.detail).toMatch(/different Bitcoin transaction/);
  });

  test("bitcoinTxid is the reversed double SHA-256 of the transaction", () => {
    // The genesis coinbase, txid 4a5e1e4b...
    const genesis = Buffer.from(
      "01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000",
      "hex",
    );
    expect(bitcoinTxid(genesis)).toBe("4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b");
  });

  test("a contract that is not configured refuses rather than matches", () => {
    const v = checkIntent(callTx({ call: repay.call }), repay.intent, CALLER, { ...ENV, writzLend: "" });
    expect(v.status).toBe("mismatch");
  });
});

function trustTx(opts: { asset?: Asset; limit?: string; source?: string; fee?: string; extra?: boolean; op?: "payment" } = {}): string {
  const b = new TransactionBuilder(new Account(opts.source ?? CALLER, "1"), { fee: opts.fee ?? "100", networkPassphrase: Networks.TESTNET });
  if (opts.op === "payment") {
    b.addOperation(Operation.payment({ destination: other.publicKey(), asset: Asset.native(), amount: "1" }));
  } else {
    b.addOperation(Operation.changeTrust({ asset: opts.asset ?? USDC, limit: opts.limit }));
  }
  if (opts.extra) b.addOperation(Operation.setOptions({ signer: { ed25519PublicKey: other.publicKey(), weight: 1 } }));
  return b.setTimeout(30).build().toXDR();
}
const USDC = new Asset("USDC", other.publicKey());
const TRUST: SigningIntent = { kind: "trustline", asset: { code: "USDC", issuer: other.publicKey() } };

describe("checkIntent: trustline", () => {
  test("accepts one changeTrust from the caller to exactly that asset", () => {
    expect(check(trustTx(), TRUST)).toEqual({ status: "match", intent: TRUST, usdc: null });
  });
  test("refuses another asset, another issuer, a removal, an extra operation, another source, a payment and a high fee", () => {
    for (const envelope of [
      trustTx({ asset: new Asset("EURC", other.publicKey()) }),
      trustTx({ asset: new Asset("USDC", CALLER) }),
      trustTx({ limit: "0" }),
      trustTx({ extra: true }),
      trustTx({ source: other.publicKey() }),
      trustTx({ op: "payment" }),
      trustTx({ fee: (MAX_TRUSTLINE_FEE + 1n).toString() }),
      feeBumped(trustTx()),
    ]) {
      expect(check(envelope, TRUST).status).toBe("mismatch");
    }
  });
});

describe("checkIntent: Earn reuses verifyVaultTx", () => {
  const env = { ...ENV, earnVault: LIVE_VAULT, earnAsset: LIVE_ASSET };
  test("accepts the deposit and withdrawal the DeFindex API built", () => {
    expect(checkIntent(LIVE_DEPOSIT.xdr, { kind: "earn.deposit", amount: LIVE_DEPOSIT.amountStroops }, LIVE_CALLER, env).status).toBe("match");
    expect(checkIntent(LIVE_WITHDRAW.xdr, { kind: "earn.withdraw", amount: LIVE_WITHDRAW.amountStroops }, LIVE_CALLER, env).status).toBe("match");
  });
  test("refuses another amount, the other action and another caller", () => {
    expect(checkIntent(LIVE_DEPOSIT.xdr, { kind: "earn.deposit", amount: 2n }, LIVE_CALLER, env).status).toBe("mismatch");
    expect(checkIntent(LIVE_DEPOSIT.xdr, { kind: "earn.withdraw", amount: LIVE_DEPOSIT.amountStroops }, LIVE_CALLER, env).status).toBe("mismatch");
    expect(checkIntent(LIVE_DEPOSIT.xdr, { kind: "earn.deposit", amount: LIVE_DEPOSIT.amountStroops }, CALLER, env).status).toBe("mismatch");
  });
});

describe("checkIntent: unknown", () => {
  test("no intent, or one this build does not know, is unknown rather than a match", () => {
    const envelope = callTx({ call: CASES[0].call });
    expect(check(envelope, undefined)).toEqual({ status: "unknown" });
    expect(check(envelope, { kind: "airdrop.claim" } as unknown as SigningIntent)).toEqual({ status: "unknown" });
  });
});

describe("describeTx", () => {
  test("says what a transfer, an approval and a known call would do, in plain words", () => {
    const send = callTx({ call: transfer(IDS.usdc, other.publicKey(), 500_0000000n) });
    expect(describeTx(send, CALLER, ENV)).toEqual([`Send 500.00 USDC to ${other.publicKey().slice(0, 4)}…${other.publicKey().slice(-4)}`]);
    const approve = callTx({ call: { contract: IDS.usdc, fn: "approve", args: [addr(CALLER), addr(IDS.stranger), i128(1n), u32(9)] } });
    expect(describeTx(approve, CALLER, ENV)[0]).toMatch(/^Let C\w+…\w+ spend 0.0000001 USDC from your wallet$/);
    expect(describeTx(callTx({ call: CASES[0].call }), CALLER, ENV)).toEqual(["Borrow 200.00 USDC"]);
    expect(describeTx(callTx({ call: { contract: IDS.stranger, fn: "drain", args: [] } }), CALLER, ENV)[0]).toMatch(/^Call drain on contract C/);
  });

  test("flags another source, extra operations, extra authorizations and a high fee", () => {
    const lines = describeTx(
      callTx({
        call: CASES[0].call,
        source: other.publicKey(),
        extraOp: true,
        fee: "200000000",
        auth: [authEntry(CASES[0].call), authEntry(CASES[0].call)],
      }),
      CALLER,
      ENV,
    );
    expect(lines[0]).toMatch(/^Act for account G.*, not yours$/);
    expect(lines.some((l) => /approve other contract calls/.test(l))).toBe(true);
    expect(lines.some((l) => /fee of up to 40.00 XLM/.test(l))).toBe(true);
  });

  test("names classic operations a user would not expect", () => {
    expect(describeTx(trustTx({ limit: "0" }), CALLER, ENV)).toEqual(["Remove USDC from your wallet"]);
    expect(describeTx(trustTx({ extra: true }), CALLER, ENV)[1]).toBe("Change who can sign for your account, or its settings");
    expect(describeTx("garbage", CALLER, ENV)).toEqual(["Something Writz can't read"]);
  });
});

describe("describeRequest", () => {
  test("puts the outcome first with the amount", () => {
    expect(describeRequest({ kind: "earn.deposit", amount: 10_0000000n }, ENV)).toBe("Deposit 10.00 USDC into the Earn vault");
    expect(describeRequest({ kind: "writz-lend.repay", txid: TXID, amount: 0n }, ENV)).toBe("Close your loan so your BTC can be released");
    expect(describeRequest({ kind: "writz-lend.repay", txid: TXID, amount: 5n }, ENV)).toBe("Repay 0.0000005 USDC on your loan");
    expect(describeRequest(CASES.find((c) => c.name === "swap.exact-in")!.intent, ENV)).toBe("Swap 50.00 USDC for at least 45.00 EURC");
    expect(describeRequest({ kind: "trustline", asset: { code: "USDC", issuer: CALLER } }, ENV)).toBe("Add USDC to your wallet");
  });
});
