/**
 * Centralized, environment-driven configuration.
 *
 * Contract addresses and service endpoints must never be hardcoded elsewhere in
 * the app - read them from here. Values come from `NEXT_PUBLIC_*` variables
 * (see `.env.example`). RPC URL and network passphrase have safe public
 * testnet defaults so the app builds even without a local env file; contract
 * IDs default to empty and surface a clear error at read time when missing.
 */

import { assertDeployTarget, lendingEnabled, TESTNET_PASSPHRASE } from "@/config/target";

const TESTNET_RPC = "https://soroban-testnet.stellar.org";

// "testnet" is a legacy alias for signet, as in the relayer: the testnet deploy
// and the SPV checkpoint both run on Bitcoin Signet.
const BTC_NETWORK = ((n) => (n === "testnet" ? "signet" : n))(
  process.env.NEXT_PUBLIC_BITCOIN_NETWORK ?? "signet",
);

/** How the Bitcoin network is named in the UI. */
export const BTC_NETWORK_LABEL = BTC_NETWORK === "mainnet" ? "Bitcoin" : `Bitcoin ${BTC_NETWORK}`;

/**
 * Which deployment this build is for, validated against everything below.
 *
 * `NEXT_PUBLIC_*` reads must stay literal member expressions - Next.js inlines
 * them at build time by matching the source text, so a computed lookup like
 * `process.env[name]` would silently resolve to `undefined` in the browser
 * bundle and defeat the whole check.
 */
const deployTarget = assertDeployTarget({
  target: process.env.NEXT_PUBLIC_WRITZ_ENV,
  networkPassphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE,
  rpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL,
  horizonUrl: process.env.NEXT_PUBLIC_HORIZON_URL,
  relayerUrl: process.env.NEXT_PUBLIC_RELAYER_URL,
  required: {
    NEXT_PUBLIC_EARN_ASSET_ISSUER: process.env.NEXT_PUBLIC_EARN_ASSET_ISSUER,
    NEXT_PUBLIC_EARN_VAULT_ID: process.env.NEXT_PUBLIC_EARN_VAULT_ID,
  },
  lendingOnly: {
    NEXT_PUBLIC_COMMITMENT_TREE_ID: process.env.NEXT_PUBLIC_COMMITMENT_TREE_ID,
    NEXT_PUBLIC_BITCOIN_SPV_ID: process.env.NEXT_PUBLIC_BITCOIN_SPV_ID,
    NEXT_PUBLIC_ZK_VERIFIER_ID: process.env.NEXT_PUBLIC_ZK_VERIFIER_ID,
    NEXT_PUBLIC_WRITZ_LEND_ID: process.env.NEXT_PUBLIC_WRITZ_LEND_ID ?? process.env.NEXT_PUBLIC_PRIVATE_LEND_ID,
    NEXT_PUBLIC_PROTOCOL_BTC_PUBKEY: process.env.NEXT_PUBLIC_PROTOCOL_BTC_PUBKEY,
    NEXT_PUBLIC_BTC_ORACLE_ID: process.env.NEXT_PUBLIC_BTC_ORACLE_ID,
  },
  testnetOnly: {
    NEXT_PUBLIC_POLLAR_API_KEY: process.env.NEXT_PUBLIC_POLLAR_API_KEY,
  },
});

/** False on mainnet: lending routes, links and the co-signing API are off there (#122). */
export const LENDING_ENABLED = lendingEnabled(deployTarget);

/** The vault testnet has served from since #132; mainnet must name its own. */
/**
 * Reflector's external-prices BTC/USD oracle on Stellar testnet, the one
 * `writz-lend` is deployed with (contracts/deployments/testnet.md). The
 * contract has no getter for its oracle, so the app names it here.
 */
const TESTNET_BTC_ORACLE = "CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63";
const TESTNET_EARN_VAULT = "CBMHGL7GGGHODEDDJ5H2LKJEFHJWBRSQUKOXMC4FKOFDZK5HBKW6PI2S";
const TESTNET_SOROSWAP_ROUTER = "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD";
const TESTNET_XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
/** Circle CCTP V2 TokenMessengerMinter on Stellar testnet (domain 27). */
const TESTNET_CCTP_TMM = "CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP";

export const config = {
  /** The validated deploy target ("local" | "testnet" | "mainnet"). */
  target: deployTarget,
  /** stellar.expert's name for this network, for explorer links. */
  explorerNetwork: deployTarget === "mainnet" ? "public" : "testnet",
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
    // NEXT_PUBLIC_PRIVATE_LEND_ID is the name the contract had before it was renamed to writz-lend.
    writzLend: process.env.NEXT_PUBLIC_WRITZ_LEND_ID ?? process.env.NEXT_PUBLIC_PRIVATE_LEND_ID ?? "",
    usdcToken: process.env.NEXT_PUBLIC_USDC_TOKEN_ID ?? "",
    /** The BTC/USD price oracle `writz-lend` reads; must be the address the contract was deployed with. */
    btcOracle:
      process.env.NEXT_PUBLIC_BTC_ORACLE_ID ?? (deployTarget === "mainnet" ? "" : TESTNET_BTC_ORACLE),
  },
  /** Where a borrower can take the loan besides USDC on Stellar; empty on mainnet until it ships there. */
  receive: {
    /** EURC has no usable testnet liquidity; on only with NEXT_PUBLIC_RECEIVE_EURC=1. */
    eurc: process.env.NEXT_PUBLIC_RECEIVE_EURC === "1",
    soroswapRouter:
      process.env.NEXT_PUBLIC_SOROSWAP_ROUTER_ID ?? (deployTarget === "mainnet" ? "" : TESTNET_SOROSWAP_ROUTER),
    /** The native XLM Stellar Asset Contract. */
    xlmToken: process.env.NEXT_PUBLIC_XLM_TOKEN_ID ?? (deployTarget === "mainnet" ? "" : TESTNET_XLM_SAC),
    cctp: {
      tokenMessengerMinter:
        process.env.NEXT_PUBLIC_CCTP_TOKEN_MESSENGER_MINTER_ID ?? (deployTarget === "mainnet" ? "" : TESTNET_CCTP_TMM),
      irisUrl:
        process.env.NEXT_PUBLIC_CCTP_IRIS_URL ??
        (deployTarget === "mainnet" ? "https://iris-api.circle.com" : "https://iris-api-sandbox.circle.com"),
      /** The Writz relay that completes the mint on the destination; the relayer unless overridden for local runs. */
      relayUrl: process.env.NEXT_PUBLIC_CCTP_RELAY_URL ?? process.env.NEXT_PUBLIC_RELAYER_URL ?? "",
      destination: {
        name: deployTarget === "mainnet" ? "Base" : "Base Sepolia",
        domain: 6,
        explorerUrl: deployTarget === "mainnet" ? "https://basescan.org" : "https://sepolia.basescan.org",
      },
    },
  },
  services: {
    relayerUrl: process.env.NEXT_PUBLIC_RELAYER_URL ?? "",
    proverUrl: process.env.NEXT_PUBLIC_PROVER_URL ?? "",
    depositAddress: process.env.NEXT_PUBLIC_DEPOSIT_ADDRESS ?? "",
  },
  /**
   * Earn: the DeFindex USDC vault product. The vault address and the DeFindex
   * API key live relayer-side (server-only), so the frontend needs no vault id
   * of its own - it reads and builds transactions through the relayer's
   * `/defindex` routes.
   */
  earn: {
    /** The DeFindex vault contract, shown on the Protocol page. Reads and
     * transactions still go through the relayer, which owns the vault id. */
    vaultId:
      process.env.NEXT_PUBLIC_EARN_VAULT_ID ?? (deployTarget === "mainnet" ? "" : TESTNET_EARN_VAULT),
    /**
     * The classic Stellar asset the vault accepts, which is NOT the same asset
     * as `usdc` above.
     *
     * On testnet the lending pool runs on a DEX-liquid USDC while the DeFindex
     * vault was created against Blend's own test USDC, because a vault only
     * accepts its strategy's asset (`strategy.asset() == asset.address`). Two
     * different issuers, both with the asset code "USDC", and in Stellar an
     * asset is code *and* issuer - holding one gives you nothing of the other.
     * Reading the wrong one is not a cosmetic bug: it shows a balance the
     * vault will not accept and offers a trustline that costs 0.5 XLM of
     * reserve for nothing.
     *
     * On mainnet both converge on Circle's USDC and this will equal `usdc`.
     * It stays a separate variable anyway, so the day they diverge again
     * nothing silently inherits.
     *
     * Source of truth for the current value: the "Underlying asset" row of
     * contracts/deployments/defindex-vault-testnet.md.
     */
    asset: {
      code: process.env.NEXT_PUBLIC_EARN_ASSET_CODE ?? "USDC",
      issuer: process.env.NEXT_PUBLIC_EARN_ASSET_ISSUER ?? "",
    },
    /**
     * Where a tester obtains the vault's asset. Shown in the Earn UI when the
     * connected account holds none of it: the SOW's Deliverable 2 evidence is
     * "a testnet URL anyone can open to try the flow", and that is not true if
     * the asset cannot be obtained.
     */
    faucetUrl: process.env.NEXT_PUBLIC_EARN_FAUCET_URL ?? "",
  },
  bitcoin: {
    network: BTC_NETWORK,
    protocolPubkey: process.env.NEXT_PUBLIC_PROTOCOL_BTC_PUBKEY ?? "",
    apiUrl:
      process.env.NEXT_PUBLIC_BITCOIN_API_URL ??
      (BTC_NETWORK === "mainnet"
        ? "https://blockstream.info/api"
        : `https://blockstream.info/${BTC_NETWORK}/api`),
    /**
     * Confirmations required before a deposit's SPV proof is accepted. Must
     * match the contract's own `min_confirmations` for this deployment: 6 on
     * mainnet, 1 on testnet (contracts/deployments/testnet.md). The relayer's
     * own count wins when it reports one; this is the denominator until then.
     */
    minConfirmations: parseInt(
      process.env.NEXT_PUBLIC_BITCOIN_MIN_CONFIRMATIONS ??
        (deployTarget === "mainnet" ? "6" : "1"),
      10,
    ),
    /**
     * Smallest deposit `writz-lend` accepts, in sats. Must match this
     * deployment's `min_deposit_satoshis`: 100,000 on mainnet, 5,000 on
     * testnet so a single Signet faucet payout covers a deposit and its fee
     * (contracts/deployments/testnet.md).
     */
    minDepositSats: BigInt(
      process.env.NEXT_PUBLIC_MIN_DEPOSIT_SATS ?? (deployTarget === "mainnet" ? "100000" : "5000"),
    ),
    /** Average Bitcoin block time, minutes - used only for the ETA estimate shown while waiting for confirmations. */
    avgBlockMinutes: 10,
  },
  /**
   * Pollar publishable key for email, Google and GitHub sign-in. Pollar holds
   * the key of the wallet it creates, so it is a testnet-only path: the
   * mainnet target refuses to build with it set. Empty disables it.
   */
  pollarApiKey: process.env.NEXT_PUBLIC_POLLAR_API_KEY ?? "",
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
