import type { PollarClient } from "@pollar/core";

/**
 * Client for the relayer's Signet faucet. The faucet only funds accounts
 * created through this app's social login (Pollar), once per account, per
 * Stellar address and per Signet address. It is not a public faucet.
 *
 * Where it plugs in: the onboarding step that follows a Pollar social login,
 * once the custodial Stellar wallet is ready and the app has created the
 * user's embedded Signet test key. If that key's address holds no coins and
 * has not claimed, call `claimSignetCoins` with the session's access token
 * (`pollarAccessToken`), the wallet's G-address and the Signet key's address,
 * public key and message signer, then show the txid and explorer link, or the
 * error's message with `publicFaucets` as the fallback. Extension wallets
 * (Xverse) keep using the public faucets.
 *
 * Protocol (relayer `faucet/service.ts`): GET /faucet/signet/nonce, sign
 * `faucetClaimMessage(nonce, stellarAddress, signetAddress)` with the Signet
 * key as a BIP-137 message, POST /faucet/signet. The relayer checks the
 * signature, that the address is the key's P2WPKH, and asks Pollar that the
 * token is a live testnet social login whose wallet is `stellarAddress`.
 */

/**
 * The text the Signet key signs. Must stay byte-identical to
 * `faucetClaimMessage` in relayer/src/faucet/nonce.ts.
 */
export function faucetClaimMessage(nonce: string, stellarAddress: string, signetAddress: string): string {
  return `Writz Signet faucet\nnonce:${nonce}\nstellar:${stellarAddress}\nsignet:${signetAddress}`;
}

/** The SDK access token of the current Pollar session, or null when nobody is signed in. */
export function pollarAccessToken(pollar: Pick<PollarClient, "getAuthState">): string | null {
  const auth = pollar.getAuthState();
  return auth.step === "authenticated" ? auth.session.token.accessToken || null : null;
}

export interface SignetClaimInput {
  /** The relayer's base URL (config.relayerUrl). */
  relayerUrl: string;
  /** From `pollarAccessToken`. */
  accessToken: string;
  /** The Pollar wallet's G-address. */
  stellarAddress: string;
  /** The embedded Signet key's P2WPKH address (tb1q...). */
  signetAddress: string;
  /** Its 33-byte compressed public key, hex. */
  signetPubkey: string;
  /** Signs a message with the Signet key; returns a base64 BIP-137 signature. */
  signMessage: (message: string) => Promise<string>;
  fetch?: typeof fetch;
}

export interface SignetClaimResult {
  txid: string;
  explorerUrl: string;
  amountSats: number;
}

export class SignetFaucetError extends Error {
  constructor(
    /** The relayer's error code (for example `account_already_claimed`, `login_expired`), or `network_error`. */
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
    /** Public Signet faucets to offer instead, when the relayer lists them. */
    readonly publicFaucets: string[] = [],
  ) {
    super(message);
    this.name = "SignetFaucetError";
  }

  /** True when this account, Stellar address or Signet address has already been funded once. */
  get alreadyClaimed(): boolean {
    return this.code.endsWith("_already_claimed");
  }
}

async function call<T>(doFetch: typeof fetch, url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await doFetch(url, init);
  } catch {
    throw new SignetFaucetError("network_error", "The Writz faucet could not be reached. Try again shortly.", 0);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (!res.ok) {
    throw new SignetFaucetError(
      typeof body.error === "string" ? body.error : "faucet_error",
      typeof body.message === "string" ? body.message : `The Writz faucet answered ${res.status}.`,
      res.status,
      typeof body.retryAfterSeconds === "number" ? body.retryAfterSeconds : undefined,
      Array.isArray(body.publicFaucets) ? body.publicFaucets.filter((f): f is string => typeof f === "string") : [],
    );
  }
  return body as T;
}

/** Requests the one-time Signet payout for a social-login account. Throws `SignetFaucetError`. */
export async function claimSignetCoins(input: SignetClaimInput): Promise<SignetClaimResult> {
  const doFetch = input.fetch ?? fetch;
  const base = input.relayerUrl.replace(/\/+$/, "");
  const { nonce } = await call<{ nonce: string }>(doFetch, `${base}/faucet/signet/nonce`);
  const keySig = await input.signMessage(faucetClaimMessage(nonce, input.stellarAddress, input.signetAddress));
  const paid = await call<SignetClaimResult>(doFetch, `${base}/faucet/signet`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pollarAccessToken: input.accessToken,
      stellarAddress: input.stellarAddress,
      signetAddress: input.signetAddress,
      signetPubkey: input.signetPubkey,
      nonce,
      keySig,
    }),
  });
  return { txid: paid.txid, explorerUrl: paid.explorerUrl, amountSats: paid.amountSats };
}
