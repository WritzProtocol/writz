import { describe, expect, it } from "bun:test";
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { decodeDepositTxid, positionExists, readMinConfirmations } from "../src/lend/deposit-reads";

// The writz-lend testnet deployment; only its address encoding matters here.
const LEND = "CCMSOCBVX2S645MQFFXJRHVHRWH2NY62KLOJXNDYFOJRYHIC47EO6ZZK";
const TXID_INTERNAL = "6e8b2b7c864669f8d564ad3af9a50e80e4844837c7fe970f215f9f3e274db7b7";

const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const bytes = (hex: string) => xdr.ScVal.scvBytes(Buffer.from(hex, "hex"));

/** A server that answers getLedgerEntries from a map keyed by the XDR of the ledger key. */
function ledger(entries: Map<string, xdr.ScVal>) {
  const requested: string[] = [];
  return {
    requested,
    getLedgerEntries: async (...keys: unknown[]) => {
      const out = [];
      for (const k of keys as xdr.LedgerKey[]) {
        const data = k.contractData();
        requested.push(data.key().toXDR("base64"));
        expect(Address.fromScAddress(data.contract()).toString()).toBe(LEND);
        expect(data.durability().name).toBe("persistent");
        const val = entries.get(data.key().toXDR("base64"));
        if (!val) continue;
        out.push({
          val: xdr.LedgerEntryData.contractData(
            new xdr.ContractDataEntry({
              ext: new xdr.ExtensionPoint(0),
              contract: data.contract(),
              key: data.key(),
              durability: data.durability(),
              val,
            }),
          ),
        });
      }
      return { entries: out };
    },
  };
}

describe("decodeDepositTxid", () => {
  it("reads the txid topic of a writz-lend deposit event, in internal byte order", () => {
    expect(decodeDepositTxid([sym("deposit"), bytes(TXID_INTERNAL)])).toBe(TXID_INTERNAL);
  });

  it("ignores other events and other shapes", () => {
    expect(decodeDepositTxid([sym("borrow"), bytes(TXID_INTERNAL)])).toBeUndefined();
    expect(decodeDepositTxid([sym("deposit")])).toBeUndefined();
    expect(decodeDepositTxid([sym("deposit"), bytes("abcd")])).toBeUndefined();
  });
});

describe("writz-lend storage reads", () => {
  const configKey = xdr.ScVal.scvVec([sym("Config")]).toXDR("base64");
  const positionKey = xdr.ScVal.scvVec([sym("Position"), bytes(TXID_INTERNAL)]).toXDR("base64");

  it("reads min_confirmations from Config", async () => {
    const config = nativeToScVal(
      { min_confirmations: 1, min_deposit_satoshis: 5000n },
      { type: { min_confirmations: ["symbol", "u32"], min_deposit_satoshis: ["symbol", "u64"] } },
    );
    const server = ledger(new Map([[configKey, config]]));
    expect(await readMinConfirmations(server, LEND)).toBe(1);
  });

  it("refuses a missing Config rather than inventing a minimum", async () => {
    await expect(readMinConfirmations(ledger(new Map()), LEND)).rejects.toThrow("min_confirmations");
  });

  it("finds a Position by its internal-order txid", async () => {
    const server = ledger(new Map([[positionKey, nativeToScVal({ btc_satoshis: 10000n })]]));
    expect(await positionExists(server, LEND, TXID_INTERNAL)).toBe(true);
    expect(server.requested).toEqual([positionKey]);
    expect(await positionExists(server, LEND, "00".repeat(32))).toBe(false);
  });
});
