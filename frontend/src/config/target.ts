/**
 * Which deployment this build is for.
 *
 * Every other config value in this app is a flat, independently-set
 * `NEXT_PUBLIC_*` variable, which means nothing stops a mainnet build from
 * silently shipping with testnet contract IDs, the testnet Soroban RPC, or the
 * Earn mock left switched on. This module makes the deploy target itself an
 * explicit input (`NEXT_PUBLIC_WRITZ_ENV`) and then refuses to build a target
 * whose surrounding config contradicts it.
 *
 * The check is deliberately a *contradiction* check, not a completeness check
 * for `local`: a developer with no env file at all still gets a working build
 * (see `config.ts`'s empty-string contract defaults, which surface a clear
 * error at read time instead). It is `testnet` and `mainnet` - the two real
 * deploy targets - that must be internally consistent, because there nobody is
 * watching a terminal when it goes wrong.
 */

export const DEPLOY_TARGETS = ["local", "testnet", "mainnet"] as const;
export type DeployTarget = (typeof DEPLOY_TARGETS)[number];

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
export const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

export interface TargetProfile {
  /** The Stellar network this target is defined to run against. */
  networkPassphrase: string;
  /** Canonical public origin, used as the `metadataBase` default. */
  siteUrl: string;
  /**
   * Whether the Earn in-memory mock may be enabled. Only ever true off
   * mainnet: a mocked run submits no transaction, so serving it from the
   * production origin would show users a balance that does not exist.
   */
  allowsEarnMock: boolean;
}

/**
 * Per-target invariants. `mainnet` maps to `app.writz.xyz`, which is reserved
 * for Milestone 2 and intentionally not deployed yet (see epic #107) - it is
 * defined here so that the day it is provisioned, it cannot inherit testnet's
 * configuration by omission.
 */
export const TARGET_PROFILES: Record<DeployTarget, TargetProfile> = {
  // "local" is also what an unset NEXT_PUBLIC_WRITZ_ENV resolves to, which
  // includes the existing marketing build served from the apex domain. Its
  // siteUrl therefore stays writz.xyz - the value that was hardcoded here
  // before targets existed - so adding this module changes no live metadata.
  local: {
    networkPassphrase: TESTNET_PASSPHRASE,
    siteUrl: "https://writz.xyz",
    allowsEarnMock: true,
  },
  testnet: {
    networkPassphrase: TESTNET_PASSPHRASE,
    siteUrl: "https://testnet.writz.xyz",
    allowsEarnMock: true,
  },
  mainnet: {
    networkPassphrase: MAINNET_PASSPHRASE,
    siteUrl: "https://app.writz.xyz",
    allowsEarnMock: false,
  },
};

/** The raw environment this module validates. Passed in rather than read from
 * `process.env` directly so the rules are testable without mutating globals. */
export interface RawTargetEnv {
  target?: string | undefined;
  networkPassphrase?: string | undefined;
  rpcUrl?: string | undefined;
  earnMock?: string | undefined;
  relayerUrl?: string | undefined;
  contracts?: Record<string, string | undefined> | undefined;
}

/**
 * Parses `NEXT_PUBLIC_WRITZ_ENV`. Unset means `local`: a bare `bun run dev`
 * with no env file is a normal thing to do, and the deploy targets set this
 * explicitly. An unrecognized value is always a mistake, never a default.
 */
export function resolveDeployTarget(raw: string | undefined): DeployTarget {
  const value = (raw ?? "").trim();
  if (!value) return "local";
  if ((DEPLOY_TARGETS as readonly string[]).includes(value)) {
    return value as DeployTarget;
  }
  throw new Error(
    `NEXT_PUBLIC_WRITZ_ENV must be one of ${DEPLOY_TARGETS.join(", ")}, got: "${raw}"`,
  );
}

/**
 * Collects every way `env` contradicts its own declared target.
 *
 * Returns all of them rather than throwing on the first, because these are
 * read from a deploy dashboard: fixing one variable per failed build is a
 * miserable loop, and the whole list is knowable in one pass.
 */
export function findTargetConflicts(env: RawTargetEnv): string[] {
  const target = resolveDeployTarget(env.target);
  if (target === "local") return [];

  const profile = TARGET_PROFILES[target];
  const problems: string[] = [];

  const passphrase = env.networkPassphrase?.trim();
  if (passphrase && passphrase !== profile.networkPassphrase) {
    problems.push(
      `NEXT_PUBLIC_NETWORK_PASSPHRASE is "${passphrase}", but the ${target} target runs against "${profile.networkPassphrase}".`,
    );
  }

  if (!profile.allowsEarnMock && env.earnMock === "1") {
    problems.push(
      `NEXT_PUBLIC_EARN_MOCK is on, which the ${target} target forbids - a mocked Earn run submits no transaction and would show a balance that does not exist.`,
    );
  }

  // Beyond this point the rules are mainnet-only. Testnet is allowed to run
  // with pieces missing while the epic is still being built out; mainnet is
  // not allowed to inherit anything by omission.
  if (target !== "mainnet") return problems;

  const rpcUrl = env.rpcUrl?.trim();
  if (rpcUrl && /testnet|futurenet/i.test(rpcUrl)) {
    problems.push(
      `NEXT_PUBLIC_SOROBAN_RPC_URL points at a test network ("${rpcUrl}") on the mainnet target.`,
    );
  }

  const relayerUrl = env.relayerUrl?.trim();
  if (!relayerUrl) {
    problems.push(
      "NEXT_PUBLIC_RELAYER_URL is not set. The mainnet target must name its own relayer explicitly rather than fall back to an empty default.",
    );
  } else if (!relayerUrl.startsWith("https://")) {
    problems.push(`NEXT_PUBLIC_RELAYER_URL must be https on the mainnet target, got: "${relayerUrl}"`);
  }

  for (const [name, value] of Object.entries(env.contracts ?? {})) {
    if (!value?.trim()) {
      problems.push(
        `${name} is not set. Every contract address must be set explicitly on the mainnet target.`,
      );
    }
  }

  return problems;
}

/** Throws a single error listing every conflict, or returns the target. */
export function assertDeployTarget(env: RawTargetEnv): DeployTarget {
  const target = resolveDeployTarget(env.target);
  const problems = findTargetConflicts(env);
  if (problems.length > 0) {
    throw new Error(
      `Deploy target "${target}" is misconfigured (NEXT_PUBLIC_WRITZ_ENV):\n` +
        problems.map((p) => `  - ${p}`).join("\n"),
    );
  }
  return target;
}
