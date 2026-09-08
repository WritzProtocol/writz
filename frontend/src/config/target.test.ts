import { describe, expect, it } from "bun:test";
import {
  assertDeployTarget,
  findTargetConflicts,
  resolveDeployTarget,
  MAINNET_PASSPHRASE,
  TARGET_PROFILES,
  TESTNET_PASSPHRASE,
} from "./target";

/** A mainnet env with nothing wrong with it, for tests that break one thing. */
const validMainnet = {
  target: "mainnet",
  networkPassphrase: MAINNET_PASSPHRASE,
  rpcUrl: "https://mainnet.sorobanrpc.com",
  earnMock: "",
  relayerUrl: "https://relayer.writz.xyz",
  contracts: {
    NEXT_PUBLIC_COMMITMENT_TREE_ID: "CMAINNET1",
    NEXT_PUBLIC_PRIVATE_LEND_ID: "CMAINNET2",
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
        earnMock: "1",
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
        earnMock: "1",
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

  it("still allows the Earn mock and an unset relayer while the epic is in progress", () => {
    expect(
      findTargetConflicts({ target: "testnet", earnMock: "1", relayerUrl: undefined }),
    ).toEqual([]);
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

  it("refuses the Earn mock, which would show a balance that does not exist", () => {
    const problems = findTargetConflicts({ ...validMainnet, earnMock: "1" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/NEXT_PUBLIC_EARN_MOCK/);
  });

  it("requires the relayer URL to be set and https", () => {
    expect(findTargetConflicts({ ...validMainnet, relayerUrl: "" })[0]).toMatch(
      /NEXT_PUBLIC_RELAYER_URL is not set/,
    );
    expect(
      findTargetConflicts({ ...validMainnet, relayerUrl: "http://relayer.writz.xyz" })[0],
    ).toMatch(/must be https/);
  });

  it("requires every contract address to be set explicitly", () => {
    const problems = findTargetConflicts({
      ...validMainnet,
      contracts: {
        NEXT_PUBLIC_COMMITMENT_TREE_ID: "CMAINNET1",
        NEXT_PUBLIC_PRIVATE_LEND_ID: "",
        NEXT_PUBLIC_ZK_VERIFIER_ID: undefined,
      },
    });
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toMatch(/NEXT_PUBLIC_PRIVATE_LEND_ID/);
    expect(problems.join("\n")).toMatch(/NEXT_PUBLIC_ZK_VERIFIER_ID/);
  });

  it("reports every problem at once rather than one per failed build", () => {
    const problems = findTargetConflicts({
      target: "mainnet",
      networkPassphrase: TESTNET_PASSPHRASE,
      rpcUrl: "https://soroban-testnet.stellar.org",
      earnMock: "1",
      relayerUrl: "",
      contracts: { NEXT_PUBLIC_COMMITMENT_TREE_ID: "" },
    });
    expect(problems).toHaveLength(5);
  });
});

describe("assertDeployTarget", () => {
  it("returns the target when the env agrees with it", () => {
    expect(assertDeployTarget({ target: "testnet" })).toBe("testnet");
    expect(assertDeployTarget({})).toBe("local");
  });

  it("throws one error naming the target and listing every conflict", () => {
    expect(() =>
      assertDeployTarget({ ...validMainnet, earnMock: "1", relayerUrl: "" }),
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

  it("forbids the Earn mock on mainnet only", () => {
    expect(TARGET_PROFILES.mainnet.allowsEarnMock).toBe(false);
    expect(TARGET_PROFILES.testnet.allowsEarnMock).toBe(true);
    expect(TARGET_PROFILES.local.allowsEarnMock).toBe(true);
  });
});
