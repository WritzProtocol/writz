import type { Wallet } from "@/lib/flow/engine";

/** The canonical message of a declined signature, whatever wallet raised it. */
export const SIGNATURE_REJECTED = "SignatureRejected";

/**
 * Text of anything thrown. Stellar Wallets Kit rejects with plain
 * `{ code, message }` objects rather than `Error`s, so `String(e)` alone
 * would read "[object Object]".
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string") {
    return e.message;
  }
  return String(e);
}

/**
 * Every wallet words a user rejection differently, and none of them use an
 * error code:
 *   Freighter  "User declined access", "The user rejected this request."
 *   xBull      "User rejected the request"
 *   Albedo     "Action canceled by the user"
 *   Rabet      "User rejected"
 *   Lobstr     "User rejected the request"
 *   Privy      "User rejected request", "User closed the modal"
 *
 * Matching on wording is unavoidable, so it is split by how much each word
 * proves. "Rejected", "declined" and "denied" only ever describe a decision,
 * so they stand alone. "Cancelled", "dismissed" and "closed" also describe
 * things that break on their own ("the connection was closed", "request
 * cancelled" from an aborted fetch), so they count only next to the actor who
 * would have done it deliberately. Privy signs over the network, so a dropped
 * connection mid-signing is a real case, and telling someone they declined
 * when the wallet actually broke sends them to the wrong fix.
 */
export function isUserRejection(message: string): boolean {
  const decision = /\b(reject(ed|s|ing)?|declin(e|ed|es|ing)|denied)\b/i;
  const ambiguous = /\b(cancel(ed|led|s)?|dismiss(ed)?|closed)\b/i;
  const actor = /\b(user|you|modal|popup|window|prompt|request)\b/i;
  return decision.test(message) || (ambiguous.test(message) && actor.test(message));
}

export class SignatureRejectedError extends Error {
  constructor(
    readonly wallet: Wallet,
    readonly walletName?: string,
  ) {
    super(SIGNATURE_REJECTED);
    this.name = "SignatureRejectedError";
  }
}

export function isSignatureRejected(e: unknown): boolean {
  return e instanceof SignatureRejectedError || errorMessage(e) === SIGNATURE_REJECTED;
}

/** How a declined signature names the wallet: "Freighter", "Xverse", or a generic fallback. */
export function walletLabel(e: unknown): string {
  if (e instanceof SignatureRejectedError) {
    if (e.walletName) return e.walletName;
    if (e.wallet === "bitcoin") return "Xverse";
  }
  return "your wallet";
}

/** `e` as a `SignatureRejectedError` when it is a user rejection, otherwise null. */
export function asRejection(
  e: unknown,
  wallet: Wallet,
  walletName?: string,
): SignatureRejectedError | null {
  if (e instanceof SignatureRejectedError) return e;
  const message = errorMessage(e);
  if (message === SIGNATURE_REJECTED || isUserRejection(message)) {
    return new SignatureRejectedError(wallet, walletName);
  }
  return null;
}

/** Runs a wallet call, turning a user rejection into `SignatureRejectedError`. */
export async function withRejection<T>(
  wallet: Wallet,
  walletName: string | undefined,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (e) {
    throw asRejection(e, wallet, walletName) ?? e;
  }
}
