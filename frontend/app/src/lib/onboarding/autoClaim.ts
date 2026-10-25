import { BTC_FAUCETS } from "@/lib/links";
import { SignetFaucetError, type SignetClaimResult } from "@/lib/faucet/claim";

/**
 * Instant funding after a social sign-in: once the account's Signet test key
 * exists, check its balance; if it is empty, claim the Writz faucet's
 * one-time payout, then follow the payout to its first confirmation. Every
 * refusal ends in a short explanation and the public Signet faucets.
 *
 * The coins are spendable as soon as the payout is broadcast (Signet relays
 * unconfirmed spends), so the guide lets the deposit start at `sent`.
 */

export interface ClaimFailure {
  /** The relayer's code, or `network_error`. */
  code: string;
  title: string;
  message: string;
  /** Worth trying again later from this page. */
  retryable: boolean;
  retryAfterSeconds?: number;
  publicFaucets: string[];
}

export type ClaimState =
  | { kind: "idle" }
  | { kind: "checking" }
  /** The key already holds coins (a payout, a public faucet, or change from an earlier loan). */
  | { kind: "funded"; sats: number }
  | { kind: "claiming" }
  | { kind: "sent"; txid: string; explorerUrl: string; amountSats: number }
  | { kind: "confirmed"; txid: string; explorerUrl: string; amountSats: number }
  | { kind: "failed"; failure: ClaimFailure };

/** A payout this browser received, kept so a reload resumes at "waiting for confirmation". */
export interface SavedClaim {
  txid: string;
  explorerUrl: string;
  amountSats: number;
}

const PUBLIC = BTC_FAUCETS.map((f) => f.href);

const COPY: Record<string, { title: string; message: string; retryable: boolean }> = {
  faucet_disabled: { title: "Faucet off", message: "The Writz faucet is off right now. Get free test BTC from a public Signet faucet.", retryable: false },
  faucet_empty: { title: "Faucet empty", message: "The Writz faucet is out of test BTC. Get some from a public Signet faucet.", retryable: true },
  daily_cap_reached: {
    title: "Daily limit reached",
    message: "The Writz faucet paid its daily maximum. It resets at 00:00 UTC, or use a public Signet faucet now.",
    retryable: true,
  },
  already_claimed: {
    title: "Already funded once",
    message: "This account already received its test BTC. The faucet pays each account once. Use a public Signet faucet for more.",
    retryable: false,
  },
  login_check_unavailable: {
    title: "Sign-in check unavailable",
    message: "We could not confirm your sign-in right now. Try again in a minute, or use a public Signet faucet.",
    retryable: true,
  },
  login_expired: { title: "Sign-in expired", message: "Your sign-in expired. Sign out and sign in again, then try again.", retryable: true },
  login_provider_not_allowed: {
    title: "Not for email sign-in",
    message: "Test BTC is sent automatically to Google and GitHub sign-ins. Use a public Signet faucet instead.",
    retryable: false,
  },
  busy: { title: "Try again shortly", message: "The faucet is busy. Try again in a minute, or use a public Signet faucet.", retryable: true },
  network_error: { title: "Faucet unreachable", message: "The Writz faucet could not be reached. Try again shortly.", retryable: true },
  other: { title: "Test BTC not sent", message: "The faucet could not send test BTC. Try again, or use a public Signet faucet.", retryable: true },
};

const ALIASES: Record<string, string> = {
  account_already_claimed: "already_claimed",
  stellar_address_already_claimed: "already_claimed",
  signet_address_already_claimed: "already_claimed",
  login_invalid: "login_expired",
  login_not_social: "login_provider_not_allowed",
  upstream_unavailable: "busy",
  broadcast_rejected: "busy",
  rate_limited: "busy",
  ip_cooldown: "busy",
};

/** The page's wording and next step for any faucet error. */
export function describeClaimError(e: unknown): ClaimFailure {
  const code = e instanceof SignetFaucetError ? e.code : "other";
  const copy = COPY[ALIASES[code] ?? code] ?? COPY.other;
  const faucets = e instanceof SignetFaucetError && e.publicFaucets.length > 0 ? e.publicFaucets : PUBLIC;
  return {
    code,
    ...copy,
    ...(e instanceof SignetFaucetError && e.retryAfterSeconds !== undefined ? { retryAfterSeconds: e.retryAfterSeconds } : {}),
    publicFaucets: faucets,
  };
}

export interface AutoClaimDeps {
  /** Spendable sats at the key's address, unconfirmed included. */
  balance(): Promise<number>;
  claim(): Promise<SignetClaimResult>;
  confirmed(txid: string): Promise<boolean>;
  saved: { get(): SavedClaim | null; set(claim: SavedClaim): void };
  sleep(ms: number): Promise<void>;
  /** How long between confirmation checks. */
  pollMs?: number;
}

/**
 * Runs the funding steps once, reporting each state. Stops when the key is
 * funded, the payout confirms, the faucet refuses, or `signal` aborts.
 */
export async function runAutoClaim(deps: AutoClaimDeps, onState: (s: ClaimState) => void, signal?: AbortSignal): Promise<ClaimState> {
  let last: ClaimState = { kind: "idle" };
  const set = (s: ClaimState) => {
    last = s;
    if (!signal?.aborted) onState(s);
    return s;
  };
  const poll = deps.pollMs ?? 15_000;

  const follow = async (c: SavedClaim): Promise<ClaimState> => {
    set({ kind: "sent", ...c });
    for (;;) {
      if (signal?.aborted) return last;
      try {
        if (await deps.confirmed(c.txid)) return set({ kind: "confirmed", ...c });
      } catch {
        // A failed status read is not a failed payout: keep waiting.
      }
      await deps.sleep(poll);
    }
  };

  const saved = deps.saved.get();
  if (saved) return follow(saved);

  set({ kind: "checking" });
  let sats = 0;
  try {
    sats = await deps.balance();
  } catch {
    // Unknown balance: claim anyway; the faucet refuses a second payout itself.
  }
  if (signal?.aborted) return last;
  if (sats > 0) return set({ kind: "funded", sats });

  set({ kind: "claiming" });
  let paid: SignetClaimResult;
  try {
    paid = await deps.claim();
  } catch (e) {
    return set({ kind: "failed", failure: describeClaimError(e) });
  }
  const c: SavedClaim = { txid: paid.txid, explorerUrl: paid.explorerUrl, amountSats: paid.amountSats };
  deps.saved.set(c);
  return follow(c);
}

/** True once the key holds coins the deposit can spend. */
export const isFunded = (s: ClaimState): boolean => s.kind === "funded" || s.kind === "sent" || s.kind === "confirmed";
