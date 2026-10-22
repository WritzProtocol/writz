/**
 * Which deployment this relayer process is for.
 *
 * The relayer holds the half of the Earn configuration the browser never sees -
 * the DeFindex vault id, the API key, the signing keys - so "testnet and
 * mainnet must not share config" is enforced here rather than in the frontend.
 * Every value below is otherwise an independently-set variable on a hosting
 * dashboard, where the realistic failure is not a typo but a *copy*: cloning
 * the testnet service to make the mainnet one and forgetting to change three
 * of the twelve variables.
 *
 * Declaring `WRITZ_ENV` turns that from an invisible mistake into a refusal to
 * boot. Leaving it unset means `local`, which checks nothing - a developer
 * running `bun run dev` against a scratch .env is not who this protects.
 */

export const DEPLOY_TARGETS = ["local", "testnet", "mainnet"] as const;
export type DeployTarget = (typeof DEPLOY_TARGETS)[number];

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
export const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

/** The subset of the environment whose consistency with the target matters. */
export interface RawTargetEnv {
  target?: string | undefined;
  bitcoinNetwork?: string | undefined;
  networkPassphrase?: string | undefined;
  stellarRpcUrl?: string | undefined;
  corsOrigin?: string | undefined;
  defindexVaultId?: string | undefined;
  kmsKeyId?: string | undefined;
  protocolSigningKeyWif?: string | undefined;
  /** Lending-only settings, by variable name. Must all be unset on mainnet. */
  lending?: Record<string, string | undefined> | undefined;
}

/**
 * BTC-collateralized lending stays off on mainnet until the audit (epic #122
 * is Earn-only). It is a property of the target, not a variable, so turning
 * it on is a reviewed code change rather than a dashboard edit.
 */
export function lendingEnabled(target: DeployTarget): boolean {
  return target !== "mainnet";
}

/**
 * Parses `WRITZ_ENV`. Unset is `local`; an unrecognized value is a mistake
 * rather than a reason to fall back, since falling back would disable every
 * check that follows.
 */
export function resolveDeployTarget(raw: string | undefined): DeployTarget {
  const value = (raw ?? "").trim();
  if (!value) return "local";
  if ((DEPLOY_TARGETS as readonly string[]).includes(value)) {
    return value as DeployTarget;
  }
  throw new Error(
    `WRITZ_ENV must be one of ${DEPLOY_TARGETS.join(", ")}, got: "${raw}"`,
  );
}

/**
 * Collects every way `env` contradicts its declared target. Returns all of
 * them, not just the first - these are read off a deploy dashboard, and one
 * variable per failed boot is a miserable loop.
 */
export function findTargetConflicts(env: RawTargetEnv): string[] {
  const target = resolveDeployTarget(env.target);
  if (target === "local") return [];

  const problems: string[] = [];
  const expectedBitcoin = target === "mainnet" ? "mainnet" : "signet";
  const expectedPassphrase = target === "mainnet" ? MAINNET_PASSPHRASE : TESTNET_PASSPHRASE;

  // "testnet" is a legacy alias for "signet" in BITCOIN_NETWORK (see config.ts),
  // so normalize before comparing or a valid signet deploy reads as a conflict.
  const bitcoinNetwork = env.bitcoinNetwork?.trim();
  const normalizedBitcoin = bitcoinNetwork === "testnet" ? "signet" : bitcoinNetwork;
  if (normalizedBitcoin && normalizedBitcoin !== expectedBitcoin) {
    problems.push(
      `BITCOIN_NETWORK is "${bitcoinNetwork}", but the ${target} target runs on ${expectedBitcoin}.`,
    );
  }

  const passphrase = env.networkPassphrase?.trim();
  if (passphrase && passphrase !== expectedPassphrase) {
    problems.push(
      `STELLAR_NETWORK_PASSPHRASE is "${passphrase}", but the ${target} target runs against "${expectedPassphrase}".`,
    );
  }

  // The vault id is the one piece of Earn config that is per-network and has
  // no safe default: a relayer without it serves 500s from every /defindex
  // route, which on a real deploy target is a broken product, not a warning.
  if (!env.defindexVaultId?.trim()) {
    problems.push(
      `DEFINDEX_VAULT_ID is not set. Each target owns its own vault - the ${target} relayer must name it explicitly.`,
    );
  }

  if (target !== "mainnet") return problems;

  const stellarRpcUrl = env.stellarRpcUrl?.trim();
  if (stellarRpcUrl && /testnet|futurenet/i.test(stellarRpcUrl)) {
    problems.push(
      `STELLAR_RPC_URL points at a test network ("${stellarRpcUrl}") on the mainnet target.`,
    );
  }

  // The mainnet relayer serves Earn only, so it holds no signing key at all:
  // nothing it runs could use one, and a key it does not hold cannot leak.
  // When lending ships on mainnet this becomes "KMS_KEY_ID required, WIF
  // forbidden" again.
  if (env.protocolSigningKeyWif?.trim()) {
    problems.push(
      "PROTOCOL_SIGNING_KEY is set. It is a testnet/signet-only fallback and must be unset on the mainnet target.",
    );
  }
  if (env.kmsKeyId?.trim()) {
    problems.push(
      "KMS_KEY_ID is set. The mainnet target serves Earn only and must not hold a Bitcoin co-signing key.",
    );
  }
  for (const [name, value] of Object.entries(env.lending ?? {})) {
    if (value?.trim()) {
      problems.push(
        `${name} is set. Lending is not enabled on the mainnet target (Earn only), so it must be unset.`,
      );
    }
  }

  const corsOrigin = env.corsOrigin?.trim();
  if (!corsOrigin || corsOrigin === "*") {
    problems.push(
      'CORS_ORIGIN is "*" (or unset). The mainnet target must name its allowed origin(s) explicitly.',
    );
  }

  return problems;
}

/** Throws a single error listing every conflict, or returns the target. */
export function assertDeployTarget(env: RawTargetEnv): DeployTarget {
  const target = resolveDeployTarget(env.target);
  const problems = findTargetConflicts(env);
  if (problems.length > 0) {
    throw new Error(
      `Deploy target "${target}" is misconfigured (WRITZ_ENV):\n` +
        problems.map((p) => `  - ${p}`).join("\n"),
    );
  }
  return target;
}
