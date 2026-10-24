import { assertDeployTarget, type DeployTarget } from "./deploy-target.js";

export type BitcoinNetwork = "mainnet" | "signet";

function getEnv(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return val;
}

export interface Config {
  /** Validated deploy target ("local" | "testnet" | "mainnet"), from WRITZ_ENV. */
  target: DeployTarget;
  port: number;
  bitcoinNetwork: BitcoinNetwork;
  esploraBaseUrl: string;
  corsOrigin: string;
  defaultConfirmations: number;
  maxConfirmations: number;
  requestTimeoutMs: number;
  /** Optional second Esplora base URL for the proof route, tried when the
   * primary answers 429/5xx or is unreachable. Must serve the same API for
   * the same network. Unset: no fallback. */
  esploraFallbackUrl: string | undefined;
  /** Retries per Esplora host on 429/5xx/network errors (proof route only;
   * the header sync keeps its own backoff). */
  esploraRetries: number;
  /** Reverse-proxy hops Express trusts for the client IP (`trust proxy`).
   * 1 on Railway: its edge is the one hop in front of the service. */
  trustProxyHops: number;
  /** Per-IP request budget for GET /spv-proof per window. */
  spvProofRateLimit: number;
  spvProofRateWindowMs: number;
  /** Proof cache size (entries) and lifetime for deeply confirmed proofs. */
  spvProofCacheMaxEntries: number;
  spvProofCacheTtlMs: number;
  // Stellar / Soroban
  stellarRpcUrl: string;
  networkPassphrase: string;
  commitmentTreeId: string;
  adminSecret: string | undefined;
  // Repay watcher
  writzLendId: string;
  relayerSecret: string | undefined;
  kmsKeyId: string | undefined;
  /** WIF-encoded protocol signing key - testnet/signet-only fallback used
   * when `kmsKeyId` isn't set. See `resolveProtocolSigner` in
   * `@writz/bitcoin-script` for why this is refused on mainnet. */
  protocolSigningKeyWif: string | undefined;
  /** Fee (satoshis) subtracted from the release amount. Dynamic fee
   * estimation is out of scope for now; a fixed, operator-tunable rate is
   * sufficient. */
  releaseFeeSat: number;
  /** How often (ms) the repay watcher polls Soroban RPC for new events. */
  repayWatcherPollIntervalMs: number;
  // DeFindex (Earn)
  /** DeFindex API key (`sk_...`), from console.defindex.io. Used by the
   * `defindex` router for both reads and (eventually) tx-building. */
  defindexApiKey: string | undefined;
  /** DeFindex API base URL. */
  defindexApiUrl: string;
  /** Writz's own DeFindex vault contract ID (testnet:
   * CBMHGL7GGGHODEDDJ5H2LKJEFHJWBRSQUKOXMC4FKOFDZK5HBKW6PI2S, see
   * contracts/deployments/defindex-vault-testnet.md). One vault per
   * network; reads and writes always target this one - never a request
   * parameter. Empty until set; routes that need it 500 clearly rather
   * than the process crashing at boot. */
  defindexVaultId: string;
  /** How often (ms) the vault watcher (#114) polls Soroban RPC for new
   * deposit/withdraw events. */
  vaultWatcherPollIntervalMs: number;
  /** bitcoin-spv contract id; the header sync feeds it. */
  bitcoinSpvId: string;
  /** Height to start syncing from - the bitcoin-spv checkpoint height. */
  spvSyncFromHeight: number | undefined;
  spvSyncIntervalMs: number;
  // ZK keeper (#212)
  /** BabyJubJub scalar whose public key commitment-tree holds as its keeper
   * key; opens the keeper note every borrow and repay publishes. */
  keeperBabyjubSecret: bigint | undefined;
  /** Stellar secret of the account that pays a liquidated position's debt. */
  keeperSecret: string | undefined;
  keeperPollIntervalMs: number;
  /** Must equal commitment-tree's oracle price, or liquidation proofs fail
   * with PriceMismatch. The contract's Phase 1 oracle is a fixed $60,000. */
  btcPriceStroops: bigint;
  /** Must equal commitment-tree's liquidation_threshold_bp. */
  liquidationThresholdBp: bigint;
  /** Signet faucet (`/faucet/signet`). Off unless `wif` is set; signet only. */
  faucet: FaucetConfig;
}

export interface FaucetConfig {
  /** WIF of the faucet's own P2WPKH hot wallet (FAUCET_SIGNET_WIF). Never the protocol key. */
  wif: string | undefined;
  /** FAUCET_ENABLED=false switches the faucet off without removing the key. */
  enabled: boolean;
  amountSat: number;
  dailyCap: number;
  cooldownHours: number;
  minFeeRate: number;
  maxFeeRate: number;
  feeTargetBlocks: number;
  /** Per-IP POST attempts per window. */
  rateLimit: number;
  rateWindowMs: number;
}

// mempool.space rather than Blockstream: Blockstream's public API now
// enforces a monthly quota on unauthenticated callers, and a header sync from
// an older checkpoint exhausted it within minutes (every pass then failed
// with 429). Both serve the same Esplora API.
const ESPLORA_URLS: Record<BitcoinNetwork, string> = {
  mainnet: "https://mempool.space/api",
  signet: "https://mempool.space/signet/api",
};

const TESTNET_RPC = "https://soroban-testnet.stellar.org";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

function loadConfig(): Config {
  const rawNetwork = getEnv("BITCOIN_NETWORK", "mainnet");
  const network = (rawNetwork === "testnet" ? "signet" : rawNetwork) as BitcoinNetwork;
  if (network !== "mainnet" && network !== "signet") {
    throw new Error(`BITCOIN_NETWORK must be "mainnet" or "signet", got: ${rawNetwork}`);
  }

  const corsOrigin = getEnv("CORS_ORIGIN", "*");
  const networkPassphrase = getEnv("STELLAR_NETWORK_PASSPHRASE", TESTNET_PASSPHRASE);
  const stellarRpcUrl = getEnv("STELLAR_RPC_URL", TESTNET_RPC);
  const defindexVaultId = getEnv("DEFINDEX_VAULT_ID", "");

  // Refuse to boot a declared deploy target whose config contradicts it. This
  // runs before anything binds a port, so a mis-copied service fails loudly at
  // startup instead of serving the wrong network's vault.
  const target = assertDeployTarget({
    target: process.env["WRITZ_ENV"],
    bitcoinNetwork: rawNetwork,
    networkPassphrase,
    stellarRpcUrl,
    corsOrigin,
    defindexVaultId,
    kmsKeyId: process.env["KMS_KEY_ID"],
    protocolSigningKeyWif: process.env["PROTOCOL_SIGNING_KEY"],
    lending: {
      ADMIN_SECRET: process.env["ADMIN_SECRET"],
      RELAYER_SECRET: process.env["RELAYER_SECRET"],
      COMMITMENT_TREE_ID: process.env["COMMITMENT_TREE_ID"],
      WRITZ_LEND_ID: process.env["WRITZ_LEND_ID"] ?? process.env["PRIVATE_LEND_ID"],
      BITCOIN_SPV_ID: process.env["BITCOIN_SPV_ID"],
      KEEPER_SECRET: process.env["KEEPER_SECRET"],
      KEEPER_BABYJUB_SECRET: process.env["KEEPER_BABYJUB_SECRET"],
      FAUCET_SIGNET_WIF: process.env["FAUCET_SIGNET_WIF"],
    },
  });

  const faucetWif = process.env["FAUCET_SIGNET_WIF"]?.trim() || undefined;
  if (faucetWif && network !== "signet") {
    throw new Error("FAUCET_SIGNET_WIF is set but BITCOIN_NETWORK is not signet. The faucet pays Signet coins only.");
  }

  return {
    target,
    port: parseInt(getEnv("PORT", "3000"), 10),
    bitcoinNetwork: network,
    esploraBaseUrl: getEnv("ESPLORA_URL", ESPLORA_URLS[network]),
    corsOrigin,
    defaultConfirmations: parseInt(getEnv("DEFAULT_CONFIRMATIONS", "6"), 10),
    maxConfirmations: parseInt(getEnv("MAX_CONFIRMATIONS", "20"), 10),
    requestTimeoutMs: parseInt(getEnv("REQUEST_TIMEOUT_MS", "10000"), 10),
    esploraFallbackUrl: process.env["ESPLORA_FALLBACK_URL"] || undefined,
    esploraRetries: parseInt(getEnv("ESPLORA_RETRIES", "2"), 10),
    trustProxyHops: parseInt(getEnv("TRUST_PROXY_HOPS", "1"), 10),
    spvProofRateLimit: parseInt(getEnv("SPV_PROOF_RATE_LIMIT", "60"), 10),
    spvProofRateWindowMs: parseInt(getEnv("SPV_PROOF_RATE_WINDOW_MS", "60000"), 10),
    spvProofCacheMaxEntries: parseInt(getEnv("SPV_PROOF_CACHE_MAX_ENTRIES", "1000"), 10),
    spvProofCacheTtlMs: parseInt(getEnv("SPV_PROOF_CACHE_TTL_MS", "3600000"), 10),
    stellarRpcUrl,
    networkPassphrase,
    commitmentTreeId: getEnv("COMMITMENT_TREE_ID", ""),
    adminSecret: process.env["ADMIN_SECRET"],
    // PRIVATE_LEND_ID is the name the contract had before it was renamed to writz-lend.
    writzLendId: getEnv("WRITZ_LEND_ID", process.env["PRIVATE_LEND_ID"] ?? ""),
    relayerSecret: process.env["RELAYER_SECRET"],
    kmsKeyId: process.env["KMS_KEY_ID"],
    protocolSigningKeyWif: process.env["PROTOCOL_SIGNING_KEY"],
    releaseFeeSat: parseInt(getEnv("RELEASE_FEE_SAT", "1500"), 10),
    repayWatcherPollIntervalMs: parseInt(getEnv("REPAY_WATCHER_POLL_INTERVAL_MS", "30000"), 10),
    defindexApiKey: process.env["DEFINDEX_API_KEY"],
    defindexApiUrl: getEnv("DEFINDEX_API_URL", "https://api.defindex.io"),
    defindexVaultId,
    vaultWatcherPollIntervalMs: parseInt(getEnv("VAULT_WATCHER_POLL_INTERVAL_MS", "30000"), 10),
    bitcoinSpvId: getEnv("BITCOIN_SPV_ID", ""),
    spvSyncFromHeight: process.env["SPV_SYNC_FROM_HEIGHT"] ? parseInt(process.env["SPV_SYNC_FROM_HEIGHT"], 10) : undefined,
    spvSyncIntervalMs: parseInt(getEnv("SPV_SYNC_INTERVAL_MS", "60000"), 10),
    keeperBabyjubSecret: process.env["KEEPER_BABYJUB_SECRET"] ? BigInt(process.env["KEEPER_BABYJUB_SECRET"].trim()) : undefined,
    keeperSecret: process.env["KEEPER_SECRET"],
    keeperPollIntervalMs: parseInt(getEnv("KEEPER_POLL_INTERVAL_MS", "60000"), 10),
    btcPriceStroops: BigInt(getEnv("BTC_PRICE_STROOPS", "600000000000")),
    liquidationThresholdBp: BigInt(getEnv("LIQUIDATION_THRESHOLD_BP", "12000")),
    faucet: {
      wif: faucetWif,
      enabled: getEnv("FAUCET_ENABLED", "true").trim().toLowerCase() !== "false",
      amountSat: parseInt(getEnv("FAUCET_AMOUNT_SATS", "20000"), 10),
      dailyCap: parseInt(getEnv("FAUCET_DAILY_CAP", "50"), 10),
      cooldownHours: parseFloat(getEnv("FAUCET_COOLDOWN_HOURS", "24")),
      minFeeRate: parseFloat(getEnv("FAUCET_MIN_FEE_RATE", "2")),
      maxFeeRate: parseFloat(getEnv("FAUCET_MAX_FEE_RATE", "25")),
      feeTargetBlocks: parseInt(getEnv("FAUCET_FEE_TARGET_BLOCKS", "3"), 10),
      rateLimit: parseInt(getEnv("FAUCET_RATE_LIMIT", "5"), 10),
      rateWindowMs: parseInt(getEnv("FAUCET_RATE_WINDOW_MS", "600000"), 10),
    },
  };
}

export const config = loadConfig();
