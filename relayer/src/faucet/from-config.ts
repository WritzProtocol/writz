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
import { createPollarVerifier } from "./pollar.js";

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
  // Claims are for Writz testnet app social logins only. Without the means to
  // check a login the faucet stays off; it never falls back to paying anyone.
  if (!f.pollarSecretKey || !f.pollarApplicationId) {
    return {
      faucet: undefined,
      disabledReason:
        "claims require a Writz testnet app social login, and this relayer has no Pollar server key or application id configured",
    };
  }

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
    verifier: createPollarVerifier({
      secretKey: f.pollarSecretKey,
      applicationId: f.pollarApplicationId,
      apiUrl: f.pollarApiUrl,
      timeoutMs: config.requestTimeoutMs,
      allowEmail: f.allowEmail,
    }),
    settings: {
      amountSat: f.amountSat,
      dailyCap: f.dailyCap,
      ipClaimsPerWindow: f.ipClaimsPerWindow,
      ipWindowMs: f.ipWindowHours * 3_600_000,
      minFeeRate: f.minFeeRate,
      maxFeeRate: f.maxFeeRate,
      feeTargetBlocks: f.feeTargetBlocks,
    },
  });
  return { faucet, disabledReason: "" };
}
