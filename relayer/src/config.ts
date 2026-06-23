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
  defaultConfirmations: number;
  maxConfirmations: number;
  requestTimeoutMs: number;
}

const ESPLORA_URLS: Record<BitcoinNetwork, string> = {
  mainnet: "https://blockstream.info/api",
  signet: "https://blockstream.info/signet/api",
};

function loadConfig(): Config {
  const rawNetwork = getEnv("BITCOIN_NETWORK", "mainnet");
  // Legacy alias: testnet3 was replaced by Bitcoin Signet for development.
  const network = (rawNetwork === "testnet" ? "signet" : rawNetwork) as BitcoinNetwork;
  if (network !== "mainnet" && network !== "signet") {
    throw new Error(`BITCOIN_NETWORK must be "mainnet" or "signet", got: ${rawNetwork}`);
  }

  return {
    port: parseInt(getEnv("PORT", "3000"), 10),
    bitcoinNetwork: network,
    esploraBaseUrl: getEnv("ESPLORA_URL", ESPLORA_URLS[network]),
    defaultConfirmations: parseInt(getEnv("DEFAULT_CONFIRMATIONS", "6"), 10),
    maxConfirmations: parseInt(getEnv("MAX_CONFIRMATIONS", "20"), 10),
    requestTimeoutMs: parseInt(getEnv("REQUEST_TIMEOUT_MS", "10000"), 10),
  };
}

export const config = loadConfig();
