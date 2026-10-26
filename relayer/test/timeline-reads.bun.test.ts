import { describe, expect, it } from "bun:test";
import { Address, Asset, Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { decodeDepositTxid, decodePositionEvent, readPosition } from "../src/lend/deposit-reads";
import { classifyOperation, type HorizonOperation, type ReceiveContext } from "../src/lend/receive-legs";

// The testnet deployments; only their address encoding matters here.
const LEND = "CCMSOCBVX2S645MQFFXJRHVHRWH2NY62KLOJXNDYFOJRYHIC47EO6ZZK";
const ROUTER = "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD";
const TMM = "CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const XLM = Asset.native().contractId("Test SDF Network ; September 2015");
const EURC = "CCUUDM434BMZMYWYDITHFXHDMIVTGGD6T2I5UKNX5BSLXLW7HVR4MCGZ";
const OWNER = Keypair.random().publicKey();
const OTHER = Keypair.random().publicKey();
const TXID = "6e8b2b7c864669f8d564ad3af9a50e80e4844837c7fe970f215f9f3e274db7b7";

const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const bytes = (hex: string) => xdr.ScVal.scvBytes(Buffer.from(hex, "hex"));
const addr = (a: string) => Address.fromString(a).toScVal();
const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });
const u32 = (n: number) => nativeToScVal(n, { type: "u32" });

describe("decodePositionEvent", () => {
  it("reads a borrow: kind, txid, borrower and amount", () => {
    const value = nativeToScVal(
      { borrower: Address.fromString(OWNER), usdc_amount: 10_000_000n },
      { type: { borrower: ["symbol", null], usdc_amount: ["symbol", "i128"] } },
    );
    expect(decodePositionEvent({ topic: [sym("borrow"), bytes(TXID)], value })).toEqual({
      kind: "borrow",
      txid: TXID,
      account: OWNER,
      amount: "10000000",
    });
  });

  it("reads the repayer of a full repay and the keeper of a liquidation", () => {
    const repayFull = nativeToScVal(
      { p2wsh_script_pubkey: Buffer.from("0020" + "11".repeat(32), "hex"), repayer: Address.fromString(OWNER) },
      { type: { p2wsh_script_pubkey: ["symbol", null], repayer: ["symbol", null] } },
    );
    expect(decodePositionEvent({ topic: [sym("repay_full"), bytes(TXID)], value: repayFull })).toMatchObject({
      kind: "repay_full",
      account: OWNER,
    });
    const liquidate = nativeToScVal(
      { bonus_paid: 5n, keeper: Address.fromString(OTHER) },
      { type: { bonus_paid: ["symbol", "i128"], keeper: ["symbol", null] } },
    );
    expect(decodePositionEvent({ topic: [sym("liquidate"), bytes(TXID)], value: liquidate })).toMatchObject({
      kind: "liquidate",
      account: OTHER,
    });
  });

  it("ignores events that do not name a position", () => {
    expect(decodePositionEvent({ topic: [sym("supply"), addr(OWNER)] })).toBeUndefined();
    expect(decodePositionEvent({ topic: [sym("borrow"), bytes("abcd")] })).toBeUndefined();
    expect(decodePositionEvent({ topic: [sym("borrow")] })).toBeUndefined();
    expect(decodeDepositTxid([sym("borrow"), bytes(TXID)])).toBeUndefined();
    expect(decodeDepositTxid([sym("deposit"), bytes(TXID)])).toBe(TXID);
  });
});

describe("readPosition", () => {
  it("reads the depositor, status and P2WSH script of a Position", async () => {
    const script = "0020" + "87".repeat(32);
    const val = nativeToScVal(
      {
        depositor: Address.fromString(OWNER),
        p2wsh_script_pubkey: Buffer.from(script, "hex"),
        status: [sym("Closed")],
      },
      { type: { depositor: ["symbol", null], p2wsh_script_pubkey: ["symbol", null], status: ["symbol", null] } },
    );
    const server = {
      getLedgerEntries: async (key: xdr.LedgerKey) => {
        const data = key.contractData();
        expect(data.key().toXDR("base64")).toBe(xdr.ScVal.scvVec([sym("Position"), bytes(TXID)]).toXDR("base64"));
        return {
          entries: [
            {
              val: xdr.LedgerEntryData.contractData(
                new xdr.ContractDataEntry({
                  ext: new xdr.ExtensionPoint(0),
                  contract: data.contract(),
                  key: data.key(),
                  durability: data.durability(),
                  val,
                }),
              ),
            },
          ],
        };
      },
    };
    expect(await readPosition(server as never, LEND, TXID)).toEqual({
      depositor: OWNER,
      status: "Closed",
      p2wshScriptPubkey: script,
    });
  });
});

const CTX: ReceiveContext = {
  owner: OWNER,
  writzLend: LEND,
  soroswapRouter: ROUTER,
  tokenMessengerMinter: TMM,
  usdcToken: USDC,
  swapTokens: { [XLM]: "XLM", [EURC]: "EURC" },
  baseDomain: 6,
};

/** A Horizon invoke-contract operation record, parameters encoded as Horizon encodes them. */
function op(contract: string, method: string, args: xdr.ScVal[], overrides: Partial<HorizonOperation> = {}): HorizonOperation {
  return {
    paging_token: "1",
    type: "invoke_host_function",
    source_account: OWNER,
    transaction_hash: "ab".repeat(32),
    transaction_successful: true,
    created_at: "2026-10-24T12:30:00Z",
    function: "HostFunctionTypeHostFunctionTypeInvokeContract",
    parameters: [addr(contract), sym(method), ...args].map((v) => ({ type: "x", value: v.toXDR("base64") })),
    ...overrides,
  };
}

const path = (...tokens: string[]) => xdr.ScVal.scvVec(tokens.map(addr));
const swap = (p: xdr.ScVal) => op(ROUTER, "swap_exact_tokens_for_tokens", [i128(10n), i128(1n), p, addr(OWNER), nativeToScVal(9n, { type: "u64" })]);
const burn = (from: string, domain: number, token: string) =>
  op(TMM, "deposit_for_burn", [addr(from), i128(10n), u32(domain), bytes("00".repeat(32)), addr(token), bytes("00".repeat(32)), i128(1n), u32(2000)]);

describe("classifyOperation", () => {
  it("names the owner's writz-lend borrow and repay calls", () => {
    expect(classifyOperation(op(LEND, "borrow", [addr(OWNER), bytes(TXID), i128(1n)]), CTX)).toEqual({
      kind: "borrow",
      txHash: "ab".repeat(32),
      at: Date.parse("2026-10-24T12:30:00Z"),
    });
    expect(classifyOperation(op(LEND, "repay", [addr(OWNER), bytes(TXID), i128(1n)]), CTX)?.kind).toBe("repay");
    expect(classifyOperation(op(LEND, "deposit", []), CTX)).toBeUndefined();
  });

  it("takes a swap from the pool's USDC to a known swap asset, and no other path", () => {
    expect(classifyOperation(swap(path(USDC, XLM)), CTX)).toMatchObject({ kind: "swap", asset: "XLM" });
    expect(classifyOperation(swap(path(USDC, EURC)), CTX)).toMatchObject({ kind: "swap", asset: "EURC" });
    expect(classifyOperation(swap(path(USDC, LEND)), CTX)).toBeUndefined();
    expect(classifyOperation(swap(path(XLM, USDC)), CTX)).toBeUndefined();
    expect(classifyOperation(swap(path(TMM, XLM)), CTX)).toBeUndefined();
  });

  it("takes a burn of the pool's USDC from the owner towards Base, and no other", () => {
    expect(classifyOperation(burn(OWNER, 6, USDC), CTX)?.kind).toBe("burn_to_base_sepolia");
    expect(classifyOperation(burn(OWNER, 0, USDC), CTX)).toBeUndefined();
    expect(classifyOperation(burn(OTHER, 6, USDC), CTX)).toBeUndefined();
    expect(classifyOperation(burn(OWNER, 6, XLM), CTX)).toBeUndefined();
  });

  it("ignores operations another account sent, failed ones and other kinds", () => {
    expect(classifyOperation({ ...swap(path(USDC, XLM)), source_account: OTHER }, CTX)).toBeUndefined();
    expect(classifyOperation({ ...swap(path(USDC, XLM)), transaction_successful: false }, CTX)).toBeUndefined();
    expect(classifyOperation({ ...swap(path(USDC, XLM)), type: "create_account" }, CTX)).toBeUndefined();
    expect(classifyOperation(op(ROUTER, "router_get_amounts_out", []), CTX)).toBeUndefined();
  });
});
