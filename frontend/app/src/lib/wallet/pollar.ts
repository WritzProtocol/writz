import { PollarClient, type SignOutcome } from "@pollar/core";
import { FeeBumpTransaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { config } from "@/config";

let client: PollarClient | null = null;

/** The app-wide Pollar client, or null when Pollar is not configured or during SSR. */
export function pollarClient(): PollarClient | null {
  if (!config.pollarApiKey || typeof window === "undefined") return null;
  // cosignManual stops the login-time read of co-sign requests, a mainnet
  // feature the testnet API answers with a 404 that surfaces as a console error.
  client ??= new PollarClient({ apiKey: config.pollarApiKey, stellarNetwork: "testnet", logLevel: "warn", cosignManual: true });
  return client;
}

export class PollarSignError extends Error {
  constructor(readonly code: string | undefined, message: string) {
    super(message);
    this.name = "PollarSignError";
  }
}

/**
 * Only contract calls and trustlines are sponsored. Anything else comes back as
 * a plain transaction signed by the user, never wrapped in a fee-bump.
 */
export function wantsSponsorship(xdr: string): boolean {
  const tx = TransactionBuilder.fromXDR(xdr, config.networkPassphrase);
  if (tx instanceof FeeBumpTransaction) throw new Error("A fee-bump envelope cannot be signed by the Pollar wallet");
  return tx.operations.some((op) => op.type === "invokeHostFunction" || op.type === "changeTrust");
}

function signed(outcome: SignOutcome): string {
  if (outcome.status === "signed") return outcome.signedXdr;
  if (outcome.status === "cosign_pending") {
    throw new PollarSignError("cosign_pending", "Co-signed Pollar wallets are not supported");
  }
  throw new PollarSignError(outcome.code, outcome.details ?? outcome.message ?? "Pollar could not sign the transaction");
}

/**
 * Pollar signs on its server. A sponsored transaction comes back fee-bumped by
 * the app's gas wallet, ready to broadcast as is, so every existing submit path
 * keeps working; one Pollar does not sponsor comes back signed by the user only.
 */
export async function signTransactionWithPollar(
  pollar: PollarClient,
  xdr: string,
  address: string,
): Promise<{ signedTxXdr: string; signerAddress: string; sponsored: boolean }> {
  const sponsor = wantsSponsorship(xdr);
  const outcome = await pollar.signTx(xdr, { skipSponsorship: !sponsor });
  const signedTxXdr = signed(outcome);
  const sponsored = TransactionBuilder.fromXDR(signedTxXdr, config.networkPassphrase) instanceof FeeBumpTransaction;
  return { signedTxXdr, signerAddress: address, sponsored };
}

/** SEP-53, the same base64 signature Freighter returns. */
export async function signMessageWithPollar(pollar: PollarClient, message: string): Promise<string> {
  const proof = await pollar.stellar.sep53.signMessage(message);
  if (proof.status !== "signed") {
    throw new PollarSignError(proof.code, proof.details ?? "Pollar could not sign the message");
  }
  return proof.signature;
}
