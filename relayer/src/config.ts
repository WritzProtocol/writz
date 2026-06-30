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
  };
}

export const config = loadConfig();
