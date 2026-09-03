export type BitcoinNetwork = "mainnet" | "signet";

function getEnv(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return val;
}

export interface Config {
  port: number;
  bitcoinNetwork: BitcoinNetwork;
  esploraBaseUrl: string;
  corsOrigin: string;
  defaultConfirmations: number;
  maxConfirmations: number;
  requestTimeoutMs: number;
  // Stellar / Soroban
  stellarRpcUrl: string;
  networkPassphrase: string;
  commitmentTreeId: string;
  adminSecret: string | undefined;
  // Repay watcher
  privateLendId: string;
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
}

const ESPLORA_URLS: Record<BitcoinNetwork, string> = {
  mainnet: "https://blockstream.info/api",
  signet: "https://blockstream.info/signet/api",
};

const TESTNET_RPC = "https://soroban-testnet.stellar.org";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

function loadConfig(): Config {
  const rawNetwork = getEnv("BITCOIN_NETWORK", "mainnet");
  const network = (rawNetwork === "testnet" ? "signet" : rawNetwork) as BitcoinNetwork;
  if (network !== "mainnet" && network !== "signet") {
    throw new Error(`BITCOIN_NETWORK must be "mainnet" or "signet", got: ${rawNetwork}`);
  }

  return {
    port: parseInt(getEnv("PORT", "3000"), 10),
    bitcoinNetwork: network,
    esploraBaseUrl: getEnv("ESPLORA_URL", ESPLORA_URLS[network]),
    corsOrigin: getEnv("CORS_ORIGIN", "*"),
    defaultConfirmations: parseInt(getEnv("DEFAULT_CONFIRMATIONS", "6"), 10),
    maxConfirmations: parseInt(getEnv("MAX_CONFIRMATIONS", "20"), 10),
    requestTimeoutMs: parseInt(getEnv("REQUEST_TIMEOUT_MS", "10000"), 10),
    stellarRpcUrl: getEnv("STELLAR_RPC_URL", TESTNET_RPC),
    networkPassphrase: getEnv("STELLAR_NETWORK_PASSPHRASE", TESTNET_PASSPHRASE),
    commitmentTreeId: getEnv("COMMITMENT_TREE_ID", ""),
    adminSecret: process.env["ADMIN_SECRET"],
    privateLendId: getEnv("PRIVATE_LEND_ID", ""),
    relayerSecret: process.env["RELAYER_SECRET"],
    kmsKeyId: process.env["KMS_KEY_ID"],
    protocolSigningKeyWif: process.env["PROTOCOL_SIGNING_KEY"],
    releaseFeeSat: parseInt(getEnv("RELEASE_FEE_SAT", "1500"), 10),
    repayWatcherPollIntervalMs: parseInt(getEnv("REPAY_WATCHER_POLL_INTERVAL_MS", "30000"), 10),
    defindexApiKey: process.env["DEFINDEX_API_KEY"],
    defindexApiUrl: getEnv("DEFINDEX_API_URL", "https://api.defindex.io"),
    defindexVaultId: getEnv("DEFINDEX_VAULT_ID", ""),
  };
}

export const config = loadConfig();
