import { describe, expect, it, mock } from "bun:test";
import { createHash } from "crypto";
import { Address, Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { ChainPosition } from "@/lib/contracts/writzLend";
import type { Position } from "@/lib/position";
import {
  depositCallOf,
  discoverPositions,
  horizonDepositCalls,
  mergeChainPosition,
  nextIndex,
  txidOfRawTx,
  type DiscoverDeps,
  type HorizonInvokeOp,
} from "./discover";

const CONTRACT = "CCMSOCBVX2S645MQFFXJRHVHRWH2NY62KLOJXNDYFOJRYHIC47EO6ZZK";
const OWNER = Keypair.random().publicKey();
const OTHER = Keypair.random().publicKey();
const RAW_TX = Buffer.from("0200000001" + "ab".repeat(40), "hex");
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();
const TXID = Buffer.from(sha256(sha256(RAW_TX))).reverse().toString("hex");

const param = (v: xdr.ScVal, type: string) => ({ type, value: v.toXDR("base64") });

/** A Horizon `invoke_host_function` record calling `fn` on `contract` with writz-lend's deposit arguments. */
function op(over: { contract?: string; fn?: string; depositor?: string; raw?: Buffer; ok?: boolean; hash?: string } = {}): HorizonInvokeOp {
  const bytes = (b: Buffer) => param(xdr.ScVal.scvBytes(b), "Bytes");
  return {
    type: "invoke_host_function",
    transaction_successful: over.ok ?? true,
    transaction_hash: over.hash ?? "f".repeat(64),
    created_at: "2026-10-20T10:00:00Z",
    parameters: [
      param(new Address(over.contract ?? CONTRACT).toScVal(), "Address"),
      param(xdr.ScVal.scvSymbol(over.fn ?? "deposit"), "Sym"),
      param(new Address(over.depositor ?? OWNER).toScVal(), "Address"),
      bytes(Buffer.alloc(32, 1)),
      param(xdr.ScVal.scvVec([xdr.ScVal.scvBytes(Buffer.alloc(32, 2))]), "Vec"),
      param(nativeToScVal(0, { type: "u32" }), "U32"),
      bytes(over.raw ?? RAW_TX),
      bytes(Buffer.alloc(34, 3)),
      param(nativeToScVal(300_000, { type: "u32" }), "U32"),
      bytes(Buffer.alloc(33, 4)),
      bytes(Buffer.alloc(65, 5)),
    ],
  };
}

describe("txidOfRawTx", () => {
  it("is the double SHA-256 of the transaction in explorer byte order", () => {
    expect(txidOfRawTx(RAW_TX)).toBe(TXID);
  });
});

describe("depositCallOf", () => {
  it("reads the deposit txid from this wallet's writz-lend deposit call", () => {
    expect(depositCallOf(op(), CONTRACT, OWNER)).toEqual({
      txid: TXID,
      stellarTxHash: "f".repeat(64),
      at: Date.parse("2026-10-20T10:00:00Z"),
    });
  });

  it("ignores failed calls, other functions, other contracts and other depositors", () => {
    expect(depositCallOf(op({ ok: false }), CONTRACT, OWNER)).toBeNull();
    expect(depositCallOf(op({ fn: "borrow" }), CONTRACT, OWNER)).toBeNull();
    expect(depositCallOf(op({ contract: "CAQBLCAPGXXCZTJDAJLY7E4PTJYGR6CY4YWH4JSJKFXYIHW3GANP6RFM" }), CONTRACT, OWNER)).toBeNull();
    expect(depositCallOf(op({ depositor: OTHER }), CONTRACT, OWNER)).toBeNull();
    expect(depositCallOf({ ...op(), type: "payment", parameters: undefined }, CONTRACT, OWNER)).toBeNull();
  });
});

describe("horizonDepositCalls", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it("follows the pages of the account's operations and returns deposits oldest first", async () => {
    const newer = op({ raw: Buffer.from("02000000aa", "hex"), hash: "1".repeat(64) });
    const older = op({ hash: "2".repeat(64) });
    const first = [newer, ...Array.from({ length: 199 }, () => ({ ...op(), type: "payment" }))];
    const get = mock(async (url: string) =>
      url.includes("cursor=next")
        ? json({ _embedded: { records: [older] } })
        : json({ _embedded: { records: first }, _links: { next: { href: "https://horizon.test/next?cursor=next" } } }),
    );
    const calls = await horizonDepositCalls(OWNER, { horizonUrl: "https://horizon.test", contractId: CONTRACT, get });
    expect(calls.map((c) => c.stellarTxHash)).toEqual(["2".repeat(64), "1".repeat(64)]);
    expect(get.mock.calls[0][0]).toBe(`https://horizon.test/accounts/${OWNER}/operations?order=desc&limit=200`);
  });

  it("an account Horizon has never seen has no deposits", async () => {
    const calls = await horizonDepositCalls(OWNER, {
      horizonUrl: "https://horizon.test",
      contractId: CONTRACT,
      get: async () => json({ status: 404 }, 404),
    });
    expect(calls).toEqual([]);
  });
});

const chain = (txid: string, over: Partial<ChainPosition> = {}): ChainPosition => ({
  txid,
  status: "active",
  depositor: OWNER,
  collateralSats: 5_000_000n,
  debtStroops: 0n,
  storedDebtStroops: 0n,
  timelockHeight: 300_000,
  userPubkey: "02" + "11".repeat(32),
  scriptPubKey: "0020" + "22".repeat(32),
  ledger: 1_000,
  ...over,
});

function deps(over: Partial<DiscoverDeps> & { onChain?: Record<string, ChainPosition | null>; local?: Position[] } = {}) {
  const saved = new Map<string, Position>((over.local ?? []).map((p) => [p.id, p]));
  const d: DiscoverDeps = {
    depositCalls: async () => [],
    readPosition: async (txid) => over.onChain?.[txid] ?? null,
    findVout: async () => 1,
    list: () => [...saved.values()],
    save: (p) => void saved.set(p.id, p),
    pending: () => null,
    ...over,
  };
  return { d, saved };
}

const txid = (n: number) => n.toString(16).padStart(2, "0").repeat(32);

describe("discoverPositions", () => {
  it("rebuilds loans from the wallet's deposits, numbered in deposit order, with the chain's figures", async () => {
    const { d, saved } = deps({
      depositCalls: async () => [
        { txid: txid(1), stellarTxHash: "a".repeat(64), at: 1_000 },
        { txid: txid(2), stellarTxHash: "b".repeat(64), at: 2_000 },
      ],
      onChain: { [txid(1)]: chain(txid(1), { status: "closed" }), [txid(2)]: chain(txid(2), { debtStroops: 42n }) },
    });
    expect(await discoverPositions(OWNER, d)).toEqual({ found: 2, scanned: 2 });
    expect(saved.get(txid(1))).toMatchObject({ index: 0, status: "closed", vout: 1, stellarTxHash: "a".repeat(64), createdAt: 1_000 });
    expect(saved.get(txid(2))).toMatchObject({ index: 1, debtStroops: "42", btcPubkey: "02" + "11".repeat(32), timelockHeight: 300_000 });
  });

  it("skips a position another wallet deposited", async () => {
    const { d, saved } = deps({
      depositCalls: async () => [{ txid: txid(1), stellarTxHash: "a".repeat(64), at: 1 }],
      onChain: { [txid(1)]: chain(txid(1), { depositor: OTHER }) },
    });
    expect((await discoverPositions(OWNER, d)).found).toBe(0);
    expect(saved.size).toBe(0);
  });

  it("keeps a loan's number and its release, and refreshes the rest from the chain", async () => {
    const known: Position = {
      id: txid(3),
      owner: OWNER,
      txid: txid(3),
      collateralSats: "5000000",
      debtStroops: "100",
      index: 4,
      status: "released",
      createdAt: 5,
      vout: 0,
      releaseTxid: "e".repeat(64),
    };
    const { d, saved } = deps({ local: [known], onChain: { [txid(3)]: chain(txid(3), { status: "closed" }) } });
    await discoverPositions(OWNER, d);
    expect(saved.get(txid(3))).toMatchObject({ index: 4, status: "released", debtStroops: "0", vout: 0, releaseTxid: "e".repeat(64) });
  });

  it("does not drop a known loan when the chain read lags", async () => {
    const known: Position = { id: txid(4), owner: OWNER, txid: txid(4), collateralSats: "1", debtStroops: "0", index: 0, status: "active", createdAt: 0 };
    const { d, saved } = deps({ local: [known] });
    expect((await discoverPositions(OWNER, d)).found).toBe(1);
    expect(saved.get(txid(4))).toEqual(known);
  });

  it("gives a deposit in progress the number it reserved, and new loans the next free one", async () => {
    const { d, saved } = deps({
      depositCalls: async () => [
        { txid: txid(5), stellarTxHash: "a".repeat(64), at: 1 },
        { txid: txid(6), stellarTxHash: "b".repeat(64), at: 2 },
      ],
      onChain: { [txid(5)]: chain(txid(5)), [txid(6)]: chain(txid(6)) },
      pending: () => ({ txid: txid(6), index: 0 }),
    });
    await discoverPositions(OWNER, d);
    expect(saved.get(txid(6))?.index).toBe(0);
    expect(saved.get(txid(5))?.index).toBe(1);
  });
});

describe("helpers", () => {
  it("nextIndex fills the lowest gap", () => {
    expect(nextIndex([])).toBe(0);
    expect(nextIndex([0, 1, 3])).toBe(2);
  });

  it("a liquidation on chain overrides a local release hint", () => {
    const prior = { status: "released" } as Position;
    expect(mergeChainPosition(chain(txid(1), { status: "liquidated" }), prior, { owner: OWNER, index: 0, createdAt: 0 }).status).toBe(
      "liquidated",
    );
  });
});
