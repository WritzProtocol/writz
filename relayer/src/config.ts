export type BitcoinNetwork = "mainnet" | "testnet";

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
  testnet: "https://blockstream.info/testnet/api",
};

function loadConfig(): Config {
  const network = getEnv("BITCOIN_NETWORK", "mainnet") as BitcoinNetwork;
  if (network !== "mainnet" && network !== "testnet") {
    throw new Error(`BITCOIN_NETWORK must be "mainnet" or "testnet", got: ${network}`);
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
