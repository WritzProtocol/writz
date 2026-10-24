import { describe, expect, it } from "bun:test";
import {
  assertDeployTarget,
  findTargetConflicts,
  resolveDeployTarget,
  lendingEnabled,
  MAINNET_PASSPHRASE,
  TARGET_PROFILES,
  TESTNET_PASSPHRASE,
} from "./target";

/** A mainnet env with nothing wrong with it, for tests that break one thing. */
const validMainnet = {
  target: "mainnet",
  networkPassphrase: MAINNET_PASSPHRASE,
  rpcUrl: "https://mainnet.sorobanrpc.com",
  horizonUrl: "https://horizon.stellar.org",
  relayerUrl: "https://api.app.writz.xyz",
  required: {
    NEXT_PUBLIC_EARN_ASSET_ISSUER: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    NEXT_PUBLIC_EARN_VAULT_ID: "CVAULTMAINNET",
  },
  lendingOnly: {
    NEXT_PUBLIC_COMMITMENT_TREE_ID: undefined,
    NEXT_PUBLIC_WRITZ_LEND_ID: "",
  },
};

describe("resolveDeployTarget", () => {
  it("treats unset and blank as local, so a bare dev run needs no env file", () => {
    expect(resolveDeployTarget(undefined)).toBe("local");
    expect(resolveDeployTarget("")).toBe("local");
    expect(resolveDeployTarget("   ")).toBe("local");
  });

  it("accepts the three real targets", () => {
    expect(resolveDeployTarget("local")).toBe("local");
    expect(resolveDeployTarget("testnet")).toBe("testnet");
    expect(resolveDeployTarget("mainnet")).toBe("mainnet");
  });

  it("rejects an unrecognized value rather than defaulting it", () => {
    // A typo like "test" silently falling back to local would disable every
    // check below - the failure mode this whole module exists to prevent.
    expect(() => resolveDeployTarget("test")).toThrow(/NEXT_PUBLIC_WRITZ_ENV/);
    expect(() => resolveDeployTarget("production")).toThrow(/NEXT_PUBLIC_WRITZ_ENV/);
    expect(() => resolveDeployTarget("MAINNET")).toThrow(/NEXT_PUBLIC_WRITZ_ENV/);
  });
});

describe("findTargetConflicts - local", () => {
  it("checks nothing, however incomplete the env is", () => {
    expect(findTargetConflicts({ target: undefined })).toEqual([]);
    expect(
      findTargetConflicts({
        target: "local",
        networkPassphrase: MAINNET_PASSPHRASE,
        relayerUrl: "",
      }),
    ).toEqual([]);
  });
});

describe("findTargetConflicts - testnet", () => {
  it("passes on a correctly configured testnet deploy", () => {
    expect(
      findTargetConflicts({
        target: "testnet",
        networkPassphrase: TESTNET_PASSPHRASE,
        rpcUrl: "https://soroban-testnet.stellar.org",
        relayerUrl: "",
      }),
    ).toEqual([]);
  });

  it("catches a testnet deploy pointed at the mainnet network", () => {
    const problems = findTargetConflicts({
      target: "testnet",
      networkPassphrase: MAINNET_PASSPHRASE,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/NEXT_PUBLIC_NETWORK_PASSPHRASE/);
  });

  it("accepts well-formed lending values", () => {
    expect(
      findTargetConflicts({
        target: "testnet",
        lendingOnly: {
          NEXT_PUBLIC_WRITZ_LEND_ID: "CCMSOCBVX2S645MQFFXJRHVHRWH2NY62KLOJXNDYFOJRYHIC47EO6ZZK",
          NEXT_PUBLIC_PROTOCOL_BTC_PUBKEY: "03d2f0699b167138988bf8d14a4655a8708066473b4c59ef40ee4ac500564fb70d",
          NEXT_PUBLIC_BITCOIN_SPV_ID: "",
        },
      }),
    ).toEqual([]);
  });

  it("refuses a protocol public key that is not a compressed key", () => {
    for (const bad of ["02ab", "04" + "11".repeat(32), "03d2f0699b16 ", "0x03" + "11".repeat(32)]) {
      const problems = findTargetConflicts({ target: "testnet", lendingOnly: { NEXT_PUBLIC_PROTOCOL_BTC_PUBKEY: bad } });
      expect(problems).toEqual([expect.stringMatching(/NEXT_PUBLIC_PROTOCOL_BTC_PUBKEY must be a 33-byte compressed public key/)]);
    }
  });

  it("refuses a lending contract id that is not a contract id", () => {
    const problems = findTargetConflicts({
      target: "testnet",
      lendingOnly: { NEXT_PUBLIC_WRITZ_LEND_ID: "GB2BSYQS3FRJ5LZSSIDF3ZCSG5MKWJT5SZ3OZO4QRCAMCR357YAVPTWT" },
    });
    expect(problems).toEqual([expect.stringMatching(/NEXT_PUBLIC_WRITZ_LEND_ID must be a Stellar contract ID/)]);
  });
});

describe("findTargetConflicts - mainnet", () => {
  it("passes on a fully configured mainnet deploy", () => {
    expect(findTargetConflicts(validMainnet)).toEqual([]);
  });

  it("refuses the testnet passphrase", () => {
    const problems = findTargetConflicts({
      ...validMainnet,
      networkPassphrase: TESTNET_PASSPHRASE,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/NEXT_PUBLIC_NETWORK_PASSPHRASE/);
  });

  it("refuses a testnet RPC endpoint", () => {
    const problems = findTargetConflicts({
      ...validMainnet,
      rpcUrl: "https://soroban-testnet.stellar.org",
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/test network/);
  });


  it("requires the relayer URL to be set and https", () => {
    expect(findTargetConflicts({ ...validMainnet, relayerUrl: "" })[0]).toMatch(
      /NEXT_PUBLIC_RELAYER_URL is not set/,
    );
    expect(
      findTargetConflicts({ ...validMainnet, relayerUrl: "http://relayer.writz.xyz" })[0],
    ).toMatch(/must be https/);
    expect(
      findTargetConflicts({ ...validMainnet, relayerUrl: "https://api.testnet.writz.xyz" })[0],
    ).toMatch(/test deployment/);
  });

  it("requires the Earn settings to be set explicitly", () => {
    const problems = findTargetConflicts({
      ...validMainnet,
      required: { NEXT_PUBLIC_EARN_ASSET_ISSUER: "", NEXT_PUBLIC_EARN_VAULT_ID: undefined },
    });
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toMatch(/NEXT_PUBLIC_EARN_ASSET_ISSUER is not set/);
    expect(problems.join("\n")).toMatch(/NEXT_PUBLIC_EARN_VAULT_ID is not set/);
  });

  it("refuses lending settings, since lending is off on mainnet", () => {
    const problems = findTargetConflicts({
      ...validMainnet,
      lendingOnly: { NEXT_PUBLIC_COMMITMENT_TREE_ID: "CTESTNET", NEXT_PUBLIC_PROTOCOL_BTC_PUBKEY: "02ab" },
    });
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toMatch(/NEXT_PUBLIC_COMMITMENT_TREE_ID is set/);
    expect(problems.join("\n")).toMatch(/NEXT_PUBLIC_PROTOCOL_BTC_PUBKEY is set/);
  });

  it("refuses testnet-only settings such as the Pollar login key", () => {
    const problems = findTargetConflicts({
      ...validMainnet,
      testnetOnly: { NEXT_PUBLIC_POLLAR_API_KEY: "pub_testnet_abc" },
    });
    expect(problems).toEqual([expect.stringMatching(/NEXT_PUBLIC_POLLAR_API_KEY is set/)]);
    expect(findTargetConflicts({ ...validMainnet, testnetOnly: { NEXT_PUBLIC_POLLAR_API_KEY: "" } })).toEqual([]);
    expect(findTargetConflicts({ target: "testnet", testnetOnly: { NEXT_PUBLIC_POLLAR_API_KEY: "pub_testnet_abc" } })).toEqual([]);
  });

  it("requires a mainnet Horizon", () => {
    expect(findTargetConflicts({ ...validMainnet, horizonUrl: undefined })[0]).toMatch(/NEXT_PUBLIC_HORIZON_URL is not set/);
    expect(
      findTargetConflicts({ ...validMainnet, horizonUrl: "https://horizon-testnet.stellar.org" })[0],
    ).toMatch(/test network/);
  });

  it("enables lending everywhere except mainnet", () => {
    expect(lendingEnabled("local")).toBe(true);
    expect(lendingEnabled("testnet")).toBe(true);
    expect(lendingEnabled("mainnet")).toBe(false);
  });

  it("reports every problem at once rather than one per failed build", () => {
    // The realistic mistake: the testnet project's variables copied into the mainnet one.
    const problems = findTargetConflicts({
      target: "mainnet",
      networkPassphrase: TESTNET_PASSPHRASE,
      rpcUrl: "https://soroban-testnet.stellar.org",
      horizonUrl: "https://horizon-testnet.stellar.org",
      relayerUrl: "",
      required: { NEXT_PUBLIC_EARN_VAULT_ID: "" },
      lendingOnly: { NEXT_PUBLIC_COMMITMENT_TREE_ID: "CTESTNET" },
    });
    // Passphrase, test RPC, test Horizon, unset relayer URL, unset vault, a lending id.
    expect(problems).toHaveLength(6);
  });
});

describe("assertDeployTarget", () => {
  it("returns the target when the env agrees with it", () => {
    expect(assertDeployTarget({ target: "testnet" })).toBe("testnet");
    expect(assertDeployTarget({})).toBe("local");
  });

  it("throws one error naming the target and listing every conflict", () => {
    expect(() =>
      assertDeployTarget({
        ...validMainnet,
        relayerUrl: "",
        rpcUrl: "https://soroban-testnet.stellar.org",
      }),
    ).toThrow(/Deploy target "mainnet" is misconfigured/);
  });
});

describe("TARGET_PROFILES", () => {
  it("gives testnet and mainnet distinct origins", () => {
    expect(TARGET_PROFILES.testnet.siteUrl).toBe("https://testnet.writz.xyz");
    expect(TARGET_PROFILES.mainnet.siteUrl).toBe("https://app.writz.xyz");
    expect(TARGET_PROFILES.testnet.siteUrl).not.toBe(TARGET_PROFILES.mainnet.siteUrl);
  });

  it("only lets mainnet run against the public network", () => {
    expect(TARGET_PROFILES.mainnet.networkPassphrase).toBe(MAINNET_PASSPHRASE);
    expect(TARGET_PROFILES.testnet.networkPassphrase).toBe(TESTNET_PASSPHRASE);
    expect(TARGET_PROFILES.local.networkPassphrase).toBe(TESTNET_PASSPHRASE);
  });

});
