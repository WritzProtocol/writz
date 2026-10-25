/**
 * Server-side check of a Pollar login, for the Signet faucet.
 *
 * The testnet app signs users in with Pollar (social login). The browser
 * sends the SDK access token of that session; the relayer asks Pollar's
 * Server API whether the token is genuine:
 *
 *   POST {POLLAR_API_URL}/tokens/verify      (default https://server.api.pollar.xyz/v3)
 *   x-pollar-api-key: <POLLAR_SECRET_KEY>    (a sec_testnet_ key)
 *   { "token": "<sdk access token>" }
 *
 *   200 { success: true, code: "SERVER_TOKEN_VERIFIED",
 *         content: { userId, applicationId, expiresAt, network: "testnet" | "mainnet",
 *                    wallet: { type: "internal" | "external" | "smart", address } | null,
 *                    profile: { email, firstName, lastName, avatar }, authProvider } }
 *   401 SDK_AUTH_TOKEN_EXPIRED | SDK_AUTH_INVALID_TOKEN
 *   403 SDK_TOKEN_WRONG_APPLICATION
 *   404 API_KEY_NOT_FOUND, 401 API_KEY_EXPIRED, 403 API_KEY_TYPE_NOT_ALLOWED (our key, not the user's token)
 *
 * Source: Pollar's published OpenAPI document for the v3 Server API
 * (server.api.pollar.xyz/openapi.v3.json, operation postTokensVerify) and the
 * Server API reference at docs.pollar.xyz. The check is stateless on Pollar's
 * side (signature and expiry), so a token bound to the browser's DPoP key is
 * verified without the browser's proof.
 *
 * Only the user id (hashed), the wallet and the login provider are used; the
 * profile (email, names, avatar) is never read or stored.
 */
import { createHash } from "crypto";
import { FaucetError } from "./service.js";

export const DEFAULT_POLLAR_API_URL = "https://server.api.pollar.xyz/v3";

/** What the faucet needs from a verified login. */
export interface VerifiedLogin {
  /** SHA-256 of the Pollar user id, domain separated: stored instead of the id. */
  userKey: string;
  /** The Stellar address of the user's Pollar wallet. */
  stellarAddress: string;
}

export interface LoginVerifier {
  /** Resolves when `token` is a live Writz testnet social login whose wallet is `stellarAddress`; throws a FaucetError otherwise. */
  verify(token: string, stellarAddress: string): Promise<VerifiedLogin>;
}

export interface PollarVerifierOptions {
  /** Server API secret key (POLLAR_SECRET_KEY). Never logged. */
  secretKey: string;
  /** The Writz testnet app's id in Pollar (POLLAR_APPLICATION_ID). */
  applicationId: string;
  apiUrl?: string;
  timeoutMs?: number;
  /** Email one-time-code logins may claim only when this is true. */
  allowEmail?: boolean;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

export function userKeyFor(userId: string): string {
  return createHash("sha256").update(`writz-signet-faucet-user:${userId}`).digest("hex");
}

interface VerifyContent {
  userId?: unknown;
  applicationId?: unknown;
  network?: unknown;
  wallet?: { type?: unknown; address?: unknown } | null;
  authProvider?: unknown;
}

const unavailable = () =>
  new FaucetError("login_check_unavailable", "the sign-in could not be checked right now; try again shortly", 30);

export function createPollarVerifier(opts: PollarVerifierOptions): LoginVerifier {
  const apiUrl = (opts.apiUrl ?? DEFAULT_POLLAR_API_URL).replace(/\/+$/, "");
  const doFetch = opts.fetch ?? fetch;
  const log = opts.log ?? ((line: string) => console.log(line));
  const timeoutMs = opts.timeoutMs ?? 10_000;

  return {
    async verify(token, stellarAddress) {
      let res: Response;
      try {
        res = await doFetch(`${apiUrl}/tokens/verify`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-pollar-api-key": opts.secretKey },
          body: JSON.stringify({ token }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        log(JSON.stringify({ evt: "faucet_pollar_unreachable", message: e instanceof Error ? e.message : String(e) }));
        throw unavailable();
      }

      let body: { success?: unknown; code?: unknown; content?: VerifyContent } = {};
      try {
        body = (await res.json()) as typeof body;
      } catch {
        body = {};
      }
      const code = typeof body.code === "string" ? body.code : "";

      if (!res.ok) {
        if (code === "SDK_AUTH_TOKEN_EXPIRED") {
          throw new FaucetError("login_expired", "your sign-in has expired; sign in again and retry");
        }
        if (code === "SDK_AUTH_INVALID_TOKEN") {
          throw new FaucetError("login_invalid", "the sign-in token is not valid");
        }
        if (code === "SDK_TOKEN_WRONG_APPLICATION") {
          throw new FaucetError("login_wrong_app", "the sign-in is not from the Writz testnet app");
        }
        // Anything else is ours to fix (API_KEY_NOT_FOUND, API_KEY_EXPIRED,
        // API_KEY_TYPE_NOT_ALLOWED, 5xx): never blame the user's login for it.
        log(JSON.stringify({ evt: "faucet_pollar_error", status: res.status, code: code.slice(0, 80) }));
        throw unavailable();
      }

      const c = body.content;
      if (body.success !== true || code !== "SERVER_TOKEN_VERIFIED" || !c || typeof c.userId !== "string" || !c.userId) {
        log(JSON.stringify({ evt: "faucet_pollar_unexpected", status: res.status, code: code.slice(0, 80) }));
        throw unavailable();
      }
      // Pollar already refuses another app's token for this key; checking the
      // id as well means a key from a different app can never widen the gate.
      if (c.applicationId !== opts.applicationId) {
        throw new FaucetError("login_wrong_app", "the sign-in is not from the Writz testnet app");
      }
      if (c.network !== "testnet") {
        throw new FaucetError("login_wrong_network", "only testnet sign-ins can claim Signet coins");
      }
      const wallet = c.wallet;
      if (!wallet || wallet.type !== "internal" || typeof wallet.address !== "string") {
        throw new FaucetError(
          "login_not_social",
          "only accounts created with the Writz testnet app's social login can claim; a connected wallet cannot",
        );
      }
      if (wallet.address !== stellarAddress) {
        throw new FaucetError("login_address_mismatch", "the Stellar address does not belong to this sign-in");
      }
      const provider = typeof c.authProvider === "string" ? c.authProvider.toLowerCase() : "";
      if (!opts.allowEmail && /email|otp/.test(provider)) {
        throw new FaucetError(
          "login_provider_not_allowed",
          "sign in with Google or GitHub to claim Signet coins; email sign-ins cannot claim",
        );
      }
      return { userKey: userKeyFor(c.userId), stellarAddress };
    },
  };
}
