import { FeeBumpTransaction, TransactionBuilder } from "@stellar/stellar-sdk";
import type { PollarClient } from "@pollar/core";
import { SignatureRejectedError, withRejection } from "./rejection";
import { preflightSign, type AccountSnapshot } from "./precheck";
import { signTransactionWithPollar, wantsSponsorship } from "./pollar";
import type { SignOptions, SigningIntent } from "./intent";
import { checkIntent, describeRequest, describeTx, type SigningEnv } from "./verifyIntent";
import { POLLAR_WALLET_NAME, type SigningReviews } from "./signingReview";

export { POLLAR_WALLET_NAME };

export interface SignResult {
  signedTxXdr: string;
  signerAddress: string;
}

/** Pollar returned an envelope that is not the one checked. Nothing was submitted. */
export class SignedTxMismatchError extends Error {
  constructor(readonly detail: string) {
    super(`SignedTxMismatch: ${detail}`);
    this.name = "SignedTxMismatchError";
  }
}

/**
 * Checks what Pollar hands back against what was checked before it signed.
 * Pollar signs on its server: a sponsored call comes back wrapped in a
 * fee-bump paid by the app's gas wallet, anything else signed by the user
 * only. The transaction inside must be the one checked (same hash), or, when
 * an intent was declared, pass the same intent check; a fee-bump paid by the
 * user is never expected. Returns the problem, or null.
 */
export function checkSignedEnvelope(params: {
  signedXdr: string;
  unsignedXdr: string;
  intent: SigningIntent | undefined;
  caller: string;
  env: SigningEnv;
}): string | null {
  const { signedXdr, unsignedXdr, intent, caller, env } = params;
  let signed;
  let unsigned;
  try {
    signed = TransactionBuilder.fromXDR(signedXdr, env.networkPassphrase);
    unsigned = TransactionBuilder.fromXDR(unsignedXdr, env.networkPassphrase);
  } catch {
    return "the signed envelope can't be read";
  }
  let inner = signed;
  if (signed instanceof FeeBumpTransaction) {
    if (signed.feeSource === caller) return "the fee-bump is paid by the user";
    inner = signed.innerTransaction;
  }
  if (inner.hash().equals(unsigned.hash())) return null;
  if (!intent) return "the signed transaction is not the one reviewed";
  const again = checkIntent(inner.toXDR(), intent, caller, env);
  return again.status === "match" ? null : `the signed transaction ${again.status === "mismatch" ? again.detail : "can't be checked"}`;
}

/**
 * The check before Pollar uses the key. A transaction that matches its
 * intent goes straight to `sign`; one that does not is blocked with only
 * Cancel; one with no known intent asks Cancel or Sign anyway; a matching one
 * above `confirmAboveUsdc` asks Confirm or Cancel. Cancel throws the same
 * `SignatureRejectedError` a declined wallet window does.
 */
export async function signWithIntentCheck(params: {
  xdr: string;
  intent: SigningIntent | undefined;
  caller: string;
  env: SigningEnv;
  reviews: SigningReviews;
  confirmAboveUsdc: bigint | null;
  sign: () => Promise<SignResult>;
}): Promise<SignResult> {
  const { xdr, intent, caller, env, reviews, confirmAboveUsdc } = params;
  const verdict = checkIntent(xdr, intent, caller, env);
  const base = { walletName: POLLAR_WALLET_NAME, actual: describeTx(xdr, caller, env), limit: null };

  let ask: Parameters<SigningReviews["request"]>[0] | null = null;
  if (verdict.status === "mismatch") {
    ask = { ...base, mode: "mismatch", asked: describeRequest(verdict.intent, env), detail: `${verdict.reason}: ${verdict.detail}` };
  } else if (verdict.status === "unknown") {
    ask = { ...base, mode: "unknown", asked: null, detail: intent ? `unknown intent ${String(intent.kind)}` : "no intent declared" };
  } else if (confirmAboveUsdc !== null && verdict.usdc !== null && verdict.usdc > confirmAboveUsdc) {
    ask = { ...base, mode: "large", asked: describeRequest(verdict.intent, env), detail: null, limit: confirmAboveUsdc };
  }
  if (ask) {
    const answer = await reviews.request(ask);
    if (answer !== "sign" || ask.mode === "mismatch") throw new SignatureRejectedError("stellar", POLLAR_WALLET_NAME);
  }

  const result = await params.sign();
  const problem = checkSignedEnvelope({ signedXdr: result.signedTxXdr, unsignedXdr: xdr, intent, caller, env });
  if (problem) throw new SignedTxMismatchError(problem);
  return result;
}

/** Stellar Wallets Kit, as far as signing uses it. */
export interface KitSigner {
  getAddress(): Promise<{ address: string }>;
  getNetwork(): Promise<{ networkPassphrase: string }>;
  signTransaction(
    xdr: string,
    opts: { address: string; networkPassphrase: string },
  ): Promise<{ signedTxXdr: string; signerAddress?: string }>;
}

export interface SignDeps {
  backend: "kit" | "pollar" | null;
  networkPassphrase: string;
  kit: () => KitSigner;
  kitWalletName: () => string | undefined;
  /** The Pollar client and the signing address, or a thrown reason it is not ready. */
  pollar: () => { client: PollarClient; signer: string };
  loadAccount: (address: string) => Promise<AccountSnapshot | null>;
  reviews: SigningReviews;
  confirmAboveUsdc: bigint | null;
  env: () => SigningEnv;
}

/**
 * `signTransaction` for the active backend. The kit path is a wallet with its
 * own approval window and is left as it was: the intent travels with the
 * call and is not checked there. The Pollar path runs `signWithIntentCheck`
 * before the key is used.
 */
export function createSignTransaction(deps: SignDeps) {
  return async (xdr: string, opts?: SignOptions): Promise<SignResult> => {
    if (deps.backend === "pollar") {
      const { client, signer } = deps.pollar();
      const preflight = () =>
        preflightSign({
          xdr,
          expectedPassphrase: deps.networkPassphrase,
          getWalletPassphrase: async () => null,
          loadAccount: () => deps.loadAccount(signer),
        });
      return signWithIntentCheck({
        xdr,
        intent: opts?.intent,
        caller: signer,
        env: deps.env(),
        reviews: deps.reviews,
        confirmAboveUsdc: deps.confirmAboveUsdc,
        sign: async () => {
          // A sponsored envelope needs no XLM. One Pollar never sponsors is paid by
          // the user, so it is checked before Pollar signs, as on the kit path.
          const sponsorable = wantsSponsorship(xdr);
          if (!sponsorable) await preflight();
          const result = await withRejection("stellar", POLLAR_WALLET_NAME, () => signTransactionWithPollar(client, xdr, signer));
          // Pollar can still decline to sponsor a contract call or trustline, and
          // that is only known once it has signed; the user pays for it then.
          if (sponsorable && !result.sponsored) await preflight();
          return { signedTxXdr: result.signedTxXdr, signerAddress: result.signerAddress };
        },
      });
    }
    const kit = deps.kit();
    const walletName = deps.kitWalletName();
    const { address: signerAddress } = await kit.getAddress();
    await preflightSign({
      xdr,
      expectedPassphrase: deps.networkPassphrase,
      walletName,
      getWalletPassphrase: async () => (await kit.getNetwork()).networkPassphrase,
      loadAccount: () => deps.loadAccount(signerAddress),
    });
    const { signedTxXdr, signerAddress: signer } = await withRejection("stellar", walletName, () =>
      kit.signTransaction(xdr, {
        address: signerAddress,
        networkPassphrase: deps.networkPassphrase,
      }),
    );
    return { signedTxXdr, signerAddress: signer ?? signerAddress };
  };
}
