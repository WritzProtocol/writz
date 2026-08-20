/**
 * Centralized, environment-driven configuration.
 *
 * Contract addresses and service endpoints must never be hardcoded elsewhere in
 * the app - read them from here. Values come from `NEXT_PUBLIC_*` variables
 * (see `.env.example`). RPC URL and network passphrase have safe public
 * testnet defaults so the app builds even without a local env file; contract
 * IDs default to empty and surface a clear error at read time when missing.
 */

const TESTNET_RPC = "https://soroban-testnet.stellar.org";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

export const config = {
  rpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? TESTNET_RPC,
  horizonUrl: process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org",
  networkPassphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? TESTNET_PASSPHRASE,
  // The pool token as a classic Stellar asset (for trustline ops). The SAC id
  // is contracts.usdcToken.
  usdc: {
    code: process.env.NEXT_PUBLIC_USDC_CODE ?? "USDC",
    issuer: process.env.NEXT_PUBLIC_USDC_ISSUER ?? "",
  },
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
    depositAddress: process.env.NEXT_PUBLIC_DEPOSIT_ADDRESS ?? "",
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
    /**
     * Confirmations required before a deposit's SPV proof is accepted. Must
     * match the contract's own `min_confirmations` expectation for this
     * deployment (6 on mainnet per docs/products/privatelend.md; testnet/signet
     * deployments commonly run with 1 to skip the wait - see
     * contracts/deployments/testnet.md). Drives the deposit progress bar, so
     * a mismatch here just shows the wrong denominator, not a functional bug.
     */
    minConfirmations: parseInt(
      process.env.NEXT_PUBLIC_BITCOIN_MIN_CONFIRMATIONS ?? "6",
      10,
    ),
    /** Average Bitcoin block time, minutes - used only for the ETA estimate shown while waiting for confirmations. */
    avgBlockMinutes: 10,
  },
  /**
   * BTC/USD oracle price in USDC stroops per BTC (7 decimals).
   * Must match the value returned by the on-chain oracle at the time of
   * borrow/repay - the contract validates the proof's price signal against it.
   * Override via NEXT_PUBLIC_BTC_PRICE_STROOPS when the oracle price changes.
   */
  btcPriceStroops: process.env.NEXT_PUBLIC_BTC_PRICE_STROOPS ?? "600000000000",
  /**
   * Privy app ID for embedded wallet support (email / social login).
   * When unset, the Privy connect option is disabled and the Stellar Wallets Kit
   * remains the only auth path.
   */
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "",
  /**
   * Umami website ID for pageview analytics. When unset, the tracking
   * script is not injected (e.g. local dev without an env file).
   */
  umamiWebsiteId: process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID ?? "",
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
