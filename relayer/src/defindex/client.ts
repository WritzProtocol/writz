import { DefindexSDK, SupportedNetworks } from "@defindex/sdk";
import { config } from "../config.js";

const STELLAR_MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

export const defindexSdk = new DefindexSDK({
  apiKey: config.defindexApiKey,
  baseUrl: config.defindexApiUrl,
});

export const defindexNetwork: SupportedNetworks =
  config.networkPassphrase === STELLAR_MAINNET_PASSPHRASE
    ? SupportedNetworks.MAINNET
    : SupportedNetworks.TESTNET;
