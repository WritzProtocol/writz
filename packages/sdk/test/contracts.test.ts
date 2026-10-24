import { describe, expect, test } from "bun:test";
import { Account, Keypair, TransactionBuilder, nativeToScVal, scValToNative, xdr, type Transaction } from "@stellar/stellar-sdk";
import { readFileSync } from "node:fs";
import {
  BitcoinSpvClient,
  ContractError,
  SPV_ERRORS,
  WRITZ_LEND_ERRORS,
  WritzLendClient,
  contractErrorCode,
  hexToBytes,
  reverseHex,
  testnet,
  verifyTransactionArgs,
  type RpcServer,
} from "../src/index.js";

/** A fake RPC server: records the invoked call and answers with `retval` or `error`. */
function fakeServer(answer: { retval?: xdr.ScVal; error?: string }) {
  const calls: { fn: string; args: xdr.ScVal[]; contract: string }[] = [];
  const record = (tx: Transaction) => {
    const op = tx.operations[0] as unknown as { func: xdr.HostFunction };
    const inv = op.func.invokeContract();
    calls.push({
      fn: inv.functionName().toString(),
      args: inv.args(),
      contract: scValToNative(xdr.ScVal.scvAddress(inv.contractAddress())) as string,
    });
  };
  const server = {
    async simulateTransaction(tx: Transaction) {
      record(tx);
      if (answer.error) return { error: answer.error, events: [], id: "1", latestLedger: 1, _parsed: true };
      return { result: { retval: answer.retval!, auth: [] }, events: [], id: "1", latestLedger: 1, _parsed: true };
    },
    async getAccount(id: string) {
      return new Account(id, "41");
    },
    async prepareTransaction(tx: Transaction) {
      record(tx);
      if (answer.error) throw new Error(answer.error);
      return tx;
    },
  } as unknown as RpcServer;
  return { server, calls };
}

const H = (b: string) => b.repeat(32);
const scBytes = (hex: string) => nativeToScVal(hexToBytes(hex));
const scStruct = (fields: Record<string, xdr.ScVal>) =>
  xdr.ScVal.scvMap(
    Object.keys(fields)
      .sort()
      .map((k) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: fields[k]! })),
  );

const ARGS = {
  block_hash: H("9e"),
  merkle_proof: [H("f3"), H("01")],
  tx_index: 1,
  raw_tx: "0200000001",
  min_confirmations: 6,
};

describe("verify_transaction arguments", () => {
  test("encode in contract order with the right types", () => {
    const [bh, proof, idx, raw, conf] = verifyTransactionArgs(ARGS);
    expect(bh!.switch().name).toBe("scvBytes");
    expect(proof!.vec()!.length).toBe(2);
    expect(idx!.switch().name).toBe("scvU32");
    expect(idx!.u32()).toBe(1);
    expect(Buffer.from(raw!.bytes()).toString("hex")).toBe("0200000001");
    expect(conf!.u32()).toBe(6);
  });

  test("reject malformed input before any RPC call", () => {
    expect(() => verifyTransactionArgs({ ...ARGS, block_hash: "abc" })).toThrow(TypeError);
    expect(() => verifyTransactionArgs({ ...ARGS, merkle_proof: ["zz"] })).toThrow(TypeError);
    expect(() => verifyTransactionArgs({ ...ARGS, min_confirmations: 0 })).toThrow(RangeError);
  });
});

describe("BitcoinSpvClient", () => {
  test("verifyTransaction decodes the result and adds the display txid", async () => {
    const txid = "b118b7cc60c2bb03b3898f9bfb2605882251ff45ec9d71cce89a81a1547bef1f";
    const { server, calls } = fakeServer({
      retval: scStruct({
        txid: scBytes(txid),
        block_hash: scBytes(H("9e")),
        block_height: nativeToScVal(327600, { type: "u32" }),
        confirmations: nativeToScVal(71, { type: "u32" }),
      }),
    });
    const spv = new BitcoinSpvClient({ network: testnet, server });
    const r = await spv.verifyTransaction(ARGS, 3);
    expect(r).toEqual({
      txid,
      txidDisplay: "1fef7b54a1819ae8cc719dec45ff5122880526fb9b8f89b303bbc260ccb718b1",
      blockHash: H("9e"),
      blockHeight: 327600,
      confirmations: 71,
    });
    expect(calls[0]!.fn).toBe("verify_transaction");
    expect(calls[0]!.contract).toBe(testnet.contracts.bitcoinSpv);
    expect(calls[0]!.args[4]!.u32()).toBe(3);
  });

  test("a contract error becomes a ContractError with its name", async () => {
    const { server } = fakeServer({ error: "HostError: Error(Contract, #22)\n\nEvent log..." });
    const err = await new BitcoinSpvClient({ network: testnet, server }).verifyTransaction(ARGS).catch((e) => e);
    expect(err).toBeInstanceOf(ContractError);
    expect(err.code).toBe(22);
    expect(err.errorName).toBe("HeaderNotFound");
    expect(err.contract).toBe("bitcoin-spv");
  });

  test("getBestTip decodes, and returns null before the checkpoint", async () => {
    const tip = scStruct({
      hash: scBytes(H("47")),
      height: nativeToScVal(327752, { type: "u32" }),
      chainwork: nativeToScVal(448158907748n, { type: "u256" }),
    });
    expect(await new BitcoinSpvClient({ network: testnet, server: fakeServer({ retval: tip }).server }).getBestTip()).toEqual({
      hash: H("47"),
      height: 327752,
      chainwork: 448158907748n,
    });
    const none = fakeServer({ retval: xdr.ScVal.scvVoid() }).server;
    expect(await new BitcoinSpvClient({ network: testnet, server: none }).getBestTip()).toBeNull();
  });

  test("contractId can be overridden", async () => {
    const other = "CAQBLCAPGXXCZTJDAJLY7E4PTJYGR6CY4YWH4JSJKFXYIHW3GANP6RFM";
    const { server, calls } = fakeServer({ retval: xdr.ScVal.scvVoid() });
    await new BitcoinSpvClient({ network: testnet, server, contractId: other }).getCanonicalHash(5);
    expect(calls[0]!.contract).toBe(other);
    expect(calls[0]!.args[0]!.u32()).toBe(5);
  });
});

describe("WritzLendClient", () => {
  const lender = Keypair.random().publicKey();

  test("decodes protocol state", async () => {
    const { server } = fakeServer({
      retval: scStruct({
        total_scaled_supply: nativeToScVal(10_000_000_000n, { type: "i128" }),
        supply_index: nativeToScVal(10n ** 18n, { type: "i128" }),
        total_borrowed: nativeToScVal(0n, { type: "i128" }),
        reserve_usdc: nativeToScVal(0n, { type: "i128" }),
        borrow_index: nativeToScVal(10n ** 18n, { type: "i128" }),
        index_ledger: nativeToScVal(5352956, { type: "u32" }),
        last_keeper_heartbeat: nativeToScVal(1792788367n, { type: "u64" }),
      }),
    });
    const s = await new WritzLendClient({ network: testnet, server }).getProtocolState();
    expect(s.totalScaledSupply).toBe(10_000_000_000n);
    expect(s.supplyIndex).toBe(10n ** 18n);
    expect(s.indexLedger).toBe(5352956);
  });

  test("decodes a position and its enum status", async () => {
    const { server, calls } = fakeServer({
      retval: scStruct({
        btc_txid: scBytes(H("aa")),
        btc_satoshis: nativeToScVal(100_000n, { type: "u64" }),
        usdc_debt: nativeToScVal(5n, { type: "i128" }),
        p2wsh_script_pubkey: scBytes("0020" + H("bb")),
        timelock_height: nativeToScVal(400000, { type: "u32" }),
        last_update_ledger: nativeToScVal(1, { type: "u32" }),
        debt_index: nativeToScVal(10n ** 18n, { type: "i128" }),
        depositor: nativeToScVal(lender, { type: "address" }),
        status: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Active")]),
        user_pubkey: scBytes("02" + H("cc")),
      }),
    });
    const p = await new WritzLendClient({ network: testnet, server }).getPosition(H("aa"));
    expect(p!.status).toBe("Active");
    expect(p!.depositor).toBe(lender);
    expect(p!.btcSatoshis).toBe(100_000n);
    expect(calls[0]!.contract).toBe(testnet.contracts.writzLend);
  });

  test("builds supply_usdc and withdraw_supply for the supplier", async () => {
    for (const [method, fn] of [
      ["buildSupplyUsdc", "supply_usdc"],
      ["buildWithdrawSupply", "withdraw_supply"],
    ] as const) {
      const { server, calls } = fakeServer({ retval: xdr.ScVal.scvVoid() });
      const xdrOut = await new WritzLendClient({ network: testnet, server })[method](lender, 10_000_000n);
      const tx = TransactionBuilder.fromXDR(xdrOut, testnet.networkPassphrase) as Transaction;
      expect(tx.source).toBe(lender);
      expect(calls[0]!.fn).toBe(fn);
      expect(scValToNative(calls[0]!.args[0]!)).toBe(lender);
      expect(scValToNative(calls[0]!.args[1]!)).toBe(10_000_000n);
    }
  });

  test("a failing build surfaces the lend error name", async () => {
    const { server } = fakeServer({ error: "simulation failed: HostError: Error(Contract, #13)" });
    const err = await new WritzLendClient({ network: testnet, server }).buildWithdrawSupply(lender, 1n).catch((e) => e);
    expect(err.code).toBe(13);
    expect(err.errorName).toBe("InsufficientSupply");
  });

  test("rejects a non-positive amount", async () => {
    const { server } = fakeServer({});
    await expect(new WritzLendClient({ network: testnet, server }).buildSupplyUsdc(lender, 0n)).rejects.toThrow(RangeError);
  });
});

describe("helpers", () => {
  test("reverseHex converts between display and internal order", () => {
    expect(reverseHex("0102ff")).toBe("ff0201");
    expect(reverseHex(reverseHex(H("ab") + ""))).toBe(H("ab"));
  });

  test("contractErrorCode reads Error(Contract, #N)", () => {
    expect(contractErrorCode("HostError: Error(Contract, #24)")).toBe(24);
    expect(contractErrorCode("timeout")).toBeUndefined();
  });

  test("the testnet preset is complete", () => {
    expect(testnet.networkPassphrase).toBe("Test SDF Network ; September 2015");
    for (const id of Object.values(testnet.contracts)) expect(id).toMatch(/^C[A-Z2-7]{55}$/);
    expect(testnet.relayerUrl).toMatch(/^https:\/\//);
    expect(testnet.spvCheckpointHeight).toBeGreaterThan(0);
  });
});


/** `Name = N,` pairs of a `#[contracterror]` enum in a contract's error.rs. */
function rustErrorCodes(contract: string): Record<number, string> {
  const src = readFileSync(new URL(`../../../contracts/contracts/${contract}/src/error.rs`, import.meta.url), "utf8");
  const codes: Record<number, string> = {};
  for (const m of src.matchAll(/^\s*([A-Z][A-Za-z0-9]*)\s*=\s*(\d+),/gm)) codes[Number(m[2])] = m[1]!;
  return codes;
}

describe("error tables", () => {
  test("SPV_ERRORS matches the bitcoin-spv error enum", () => {
    expect({ ...SPV_ERRORS }).toEqual(rustErrorCodes("bitcoin-spv"));
  });

  test("WRITZ_LEND_ERRORS matches the writz-lend error enum", () => {
    expect({ ...WRITZ_LEND_ERRORS }).toEqual(rustErrorCodes("writz-lend"));
    expect(WRITZ_LEND_ERRORS[27]).toBe("InvalidDepositParams");
  });

  test("a constructor rejection names InvalidDepositParams", () => {
    expect(new ContractError("writz-lend", "__constructor", 27, "").message).toBe(
      "writz-lend.__constructor failed with #27 InvalidDepositParams",
    );
  });
});
