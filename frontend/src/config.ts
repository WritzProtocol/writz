/**
 * Centralized, environment-driven configuration.
 *
 * Contract addresses and service endpoints must never be hardcoded elsewhere in
 * the app — read them from here. Values come from `NEXT_PUBLIC_*` variables
 * (see `.env.example`). RPC URL and network passphrase have safe public
 * testnet defaults so the app builds even without a local env file; contract
 * IDs default to empty and surface a clear error at read time when missing.
 */

const TESTNET_RPC = "https://soroban-testnet.stellar.org";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

export const config = {
  rpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? TESTNET_RPC,
  networkPassphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? TESTNET_PASSPHRASE,
  contracts: {
    commitmentTree: process.env.NEXT_PUBLIC_COMMITMENT_TREE_ID ?? "",
    bitcoinSpv: process.env.NEXT_PUBLIC_BITCOIN_SPV_ID ?? "",
    zkVerifier: process.env.NEXT_PUBLIC_ZK_VERIFIER_ID ?? "",
    privateLend: process.env.NEXT_PUBLIC_PRIVATE_LEND_ID ?? "",
    usdcToken: process.env.NEXT_PUBLIC_USDC_TOKEN_ID ?? "",
  },
  services: {
    relayerUrl: process.env.NEXT_PUBLIC_RELAYER_URL ?? "",
    proverUrl: process.env.NEXT_PUBLIC_PROVER_URL ?? "",
  },
  bitcoin: {
    network: process.env.NEXT_PUBLIC_BITCOIN_NETWORK ?? "testnet",
    protocolPubkey: process.env.NEXT_PUBLIC_PROTOCOL_BTC_PUBKEY ?? "",
    timelockHeight: parseInt(
      process.env.NEXT_PUBLIC_BITCOIN_TIMELOCK_HEIGHT ?? "3000000",
      10,
    ),
    apiUrl:
      process.env.NEXT_PUBLIC_BITCOIN_API_URL ??
      "https://blockstream.info/testnet/api",
  },
} as const;

/** Throws a clear error if a required contract id is not configured. */
export function requireContract(id: string, name: string): string {
  if (!id) {
    throw new Error(
      `Missing contract address for ${name}. Set the matching NEXT_PUBLIC_* variable (see .env.example).`,
    );
  }
  return id;
}
