/**
 * Builds the Signet faucet from the relayer's configuration, or explains why
 * it stays off. Kept apart from `service.ts` so tests of the service never
 * open the sqlite store or read the environment.
 */
import * as btc from "bitcoinjs-lib";
import { keyPairFromWif } from "@writz/bitcoin-script";
import { config } from "../config.js";
import { EsploraClient } from "../bitcoin/esplora.js";
import { openSqliteClaimStore } from "./sqlite-store.js";
import { SignetFaucet } from "./service.js";

export interface FaucetSetup {
  faucet: SignetFaucet | undefined;
  disabledReason: string;
}

export function faucetFromConfig(): FaucetSetup {
  const f = config.faucet;
  if (config.bitcoinNetwork !== "signet") {
    return { faucet: undefined, disabledReason: "this relayer does not run on Bitcoin Signet" };
  }
  if (!f.wif) return { faucet: undefined, disabledReason: "no faucet key is configured" };
  if (!f.enabled) return { faucet: undefined, disabledReason: "the faucet is switched off by the operator" };

  // A mainnet WIF throws here: keyPairFromWif checks the network version byte.
  const wallet = keyPairFromWif(f.wif, btc.networks.testnet);

  // The faucet key pays strangers; it must never be able to sign a Writz lock.
  if (config.protocolSigningKeyWif) {
    let protocolPub: Buffer | undefined;
    try {
      protocolPub = keyPairFromWif(config.protocolSigningKeyWif, btc.networks.testnet).publicKey;
    } catch {
      protocolPub = undefined;
    }
    if (protocolPub && protocolPub.equals(wallet.publicKey)) {
      throw new Error("FAUCET_SIGNET_WIF must be a different key from PROTOCOL_SIGNING_KEY");
    }
  }

  const esplora = new EsploraClient(config.esploraBaseUrl, config.requestTimeoutMs, {
    retries: config.esploraRetries,
    fallbackBaseUrl: config.esploraFallbackUrl,
  });
  const faucet = new SignetFaucet({
    wallet,
    esplora,
    store: openSqliteClaimStore(),
    settings: {
      amountSat: f.amountSat,
      dailyCap: f.dailyCap,
      cooldownMs: f.cooldownHours * 3_600_000,
      ipClaimsPerWindow: f.ipClaimsPerWindow,
      ipWindowMs: f.ipWindowHours * 3_600_000,
      minFeeRate: f.minFeeRate,
      maxFeeRate: f.maxFeeRate,
      feeTargetBlocks: f.feeTargetBlocks,
    },
  });
  return { faucet, disabledReason: "" };
}
