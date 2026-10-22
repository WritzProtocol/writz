import { describe, expect, it } from "bun:test";
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  AccountUnfundedError,
  assertFunds,
  assertNetwork,
  LowXlmError,
  networkName,
  preflightSign,
  requiredXlm,
  spendableXlm,
  toStroops,
  WrongNetworkError,
  type AccountSnapshot,
} from "./precheck";

const XLM = 10_000_000n;

function account(balance: string, subentries = 0, extra: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    balances: [{ asset_type: "native", balance, selling_liabilities: "0.0000000" }],
    subentry_count: subentries,
    ...extra,
  };
}

function txXdr(fee: string, ops: "payment" | "trust" = "payment"): string {
  const source = new Account(Keypair.random().publicKey(), "1");
  const issuer = Keypair.random().publicKey();
  const op =
    ops === "trust"
      ? Operation.changeTrust({ asset: new Asset("USDC", issuer) })
      : Operation.payment({ destination: issuer, asset: Asset.native(), amount: "1" });
  return new TransactionBuilder(source, { fee, networkPassphrase: Networks.TESTNET })
    .addOperation(op)
    .setTimeout(30)
    .build()
    .toXDR();
}

describe("spendableXlm", () => {
  it("subtracts the base reserve, subentries and selling liabilities", () => {
    expect(spendableXlm(account("10.0000000"))).toBe(9n * XLM);
    expect(spendableXlm(account("10.0000000", 2))).toBe(8n * XLM);
    expect(
      spendableXlm({
        balances: [{ asset_type: "native", balance: "10.0000000", selling_liabilities: "1.5000000" }],
        subentry_count: 0,
      }),
    ).toBe(75n * (XLM / 10n));
  });

  it("counts sponsorships", () => {
    expect(spendableXlm(account("10.0000000", 0, { num_sponsoring: 2, num_sponsored: 0 }))).toBe(8n * XLM);
    expect(spendableXlm(account("10.0000000", 2, { num_sponsored: 2 }))).toBe(9n * XLM);
  });

  it("never goes negative", () => {
    expect(spendableXlm(account("0.5000000", 3))).toBe(0n);
  });

  it("parses decimal balances exactly", () => {
    expect(toStroops("12.5")).toBe(125_000_000n);
    expect(toStroops("0.0000001")).toBe(1n);
  });
});

describe("requiredXlm", () => {
  it("is the transaction's maximum fee", () => {
    expect(requiredXlm(txXdr("12345"), Networks.TESTNET)).toBe(12_345n);
  });

  it("adds a base reserve for a new trustline", () => {
    expect(requiredXlm(txXdr("100", "trust"), Networks.TESTNET)).toBe(100n + XLM / 2n);
  });
});

describe("assertNetwork", () => {
  it("throws when the wallet is on another network", () => {
    expect(() => assertNetwork(Networks.PUBLIC, Networks.TESTNET, "Freighter")).toThrow(WrongNetworkError);
  });

  it("passes on a match or when the wallet can't report its network", () => {
    expect(() => assertNetwork(Networks.TESTNET, Networks.TESTNET)).not.toThrow();
    expect(() => assertNetwork(null, Networks.TESTNET)).not.toThrow();
  });

  it("names networks for the user", () => {
    expect(networkName(Networks.TESTNET)).toBe("Stellar testnet");
    expect(networkName(Networks.PUBLIC)).toBe("Stellar mainnet");
    expect(networkName("Standalone Network ; February 2017")).toBe("another network");
  });
});

describe("assertFunds", () => {
  it("throws AccountUnfundedError for a missing account", () => {
    expect(() => assertFunds(null, 100n)).toThrow(AccountUnfundedError);
  });

  it("throws LowXlmError when spendable XLM is below what the transaction needs", () => {
    expect(() => assertFunds(account("1.0000000"), XLM)).toThrow(LowXlmError);
    expect(() => assertFunds(account("2.0000000"), XLM)).not.toThrow();
  });
});

describe("preflightSign", () => {
  const xdr = txXdr("100");

  it("stops a wrong network before loading the account", async () => {
    let loaded = false;
    const e = await preflightSign({
      xdr,
      expectedPassphrase: Networks.TESTNET,
      walletName: "Freighter",
      getWalletPassphrase: async () => Networks.PUBLIC,
      loadAccount: async () => {
        loaded = true;
        return account("100");
      },
    }).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(WrongNetworkError);
    expect(loaded).toBe(false);
  });

  it("reports an unfunded account", async () => {
    const e = await preflightSign({
      xdr,
      expectedPassphrase: Networks.TESTNET,
      getWalletPassphrase: async () => Networks.TESTNET,
      loadAccount: async () => null,
    }).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(AccountUnfundedError);
  });

  it("skips checks it cannot read instead of blocking the signature", async () => {
    await preflightSign({
      xdr,
      expectedPassphrase: Networks.TESTNET,
      getWalletPassphrase: async () => {
        throw { code: -3, message: 'Lobstr does not support the "getNetwork" function' };
      },
      loadAccount: async () => {
        throw new Error("Horizon down");
      },
    });
  });
});
