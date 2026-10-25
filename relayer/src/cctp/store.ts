/**
 * Relay records, one per Stellar burn: where each transfer is, and the mint
 * that completed it. The relayer uses the sqlite store (`sqlite-store.ts`) so
 * a restart neither forgets a transfer in flight nor loses the mint hash the
 * app links to; tests use the in-memory one below.
 */

/**
 * `sent`        recorded; Iris has not answered with the message yet
 * `confirming`  Iris knows the burn and is waiting for Stellar finality
 * `confirmed`   Circle signed the message; the relay is about to mint
 * `submitted`   the mint transaction is broadcast and not yet mined
 * `arrived`     the nonce is spent on Base Sepolia: the USDC is minted
 * `failed`      the relay stopped; `failure` says why. With `retryAt` set the
 *               stop is transient and the relay tries again by itself at that
 *               time; without it, it is final (see `FailureCode`)
 */
export type RelayState = "sent" | "confirming" | "confirmed" | "submitted" | "arrived" | "failed";

/**
 * Why a transfer failed, which decides what happens next.
 *
 * Retried automatically, with backoff, until `RETRY_GIVE_UP_MS` after the
 * first failure: `confirm_timeout` (Circle still finalizing), `rpc` (Base
 * Sepolia unreachable), `out_of_gas` (retried once the balance covers a mint),
 * `daily_cap` (retried after 00:00 UTC), `send_failed`, `not_mined`,
 * `reverted` (simulated fine, reverted on chain; the retry simulates again)
 * and `unexpected`.
 *
 * Final: `refused` (not a Stellar to Base Sepolia USDC burn) and
 * `mint_refused` (MessageTransmitterV2 rejects it: a bad signature, an
 * expired message) never change. `unseen` (Circle never reported the burn,
 * most likely not a CCTP transfer) and `gave_up` stay failed until a new
 * POST for the burn starts it over.
 */
export type FailureCode =
  | "confirm_timeout"
  | "rpc"
  | "out_of_gas"
  | "daily_cap"
  | "send_failed"
  | "not_mined"
  | "reverted"
  | "unexpected"
  | "refused"
  | "mint_refused"
  | "unseen"
  | "gave_up";

export interface RelayRecord {
  /** Stellar transaction hash of the burn, 64 lowercase hex characters. */
  burnHash: string;
  state: RelayState;
  /** From the decoded message, once Circle has signed it. */
  nonce?: string;
  /** Base Sepolia address the USDC is minted to. */
  recipient?: string;
  /** USDC base units (6 decimals) burned on Stellar. */
  amount?: string;
  /** Fee Circle took from the amount, in the same units. */
  feeExecuted?: string;
  message?: string;
  attestation?: string;
  /** The Base Sepolia transaction that minted the USDC. */
  mintHash?: string;
  /** Who sent `mintHash`: the relay, or someone else who completed the transfer first. */
  mintedBy?: "relay" | "other";
  failure?: string;
  failureCode?: FailureCode;
  /** A failure a later request may retry (a timeout, an empty gas wallet), as opposed to a refused message. */
  retryable: boolean;
  /**
   * When the relay next acts on this record by itself (Unix ms): the next
   * attempt of a transient failure, or the next search for the mint hash of
   * an arrived transfer whose hash neither source found. Unset: nothing is due.
   */
  retryAt?: number;
  /** Automatic attempts so far in the current streak; drives the backoff. */
  attempts?: number;
  /** First transient failure of the current streak (Unix ms), for the give-up deadline. */
  retryingSince?: number;
  /** Unix milliseconds. */
  createdAt: number;
  updatedAt: number;
  /** When the relay broadcast its mint, for the daily cap. */
  submittedAt?: number;
}

export interface RelayStore {
  get(burnHash: string): RelayRecord | undefined;
  /** Inserts or replaces the record for `record.burnHash`. */
  put(record: RelayRecord): void;
  /** Mints the relay broadcast at or after `since` (Unix ms). */
  countSubmittedSince(since: number): number;
  /** Records still in flight (neither arrived nor failed), oldest first. */
  listOpen(): RelayRecord[];
  /** Records with a `retryAt` at or before `now`, earliest first. */
  listDue(now: number): RelayRecord[];
}

export const isSettled = (r: RelayRecord): boolean => r.state === "arrived" || r.state === "failed";

/** A failure the relay will retry by itself: reported to the app as still in progress. */
export const isRetrying = (r: RelayRecord): boolean => r.state === "failed" && r.retryAt !== undefined;

export class MemoryRelayStore implements RelayStore {
  readonly records = new Map<string, RelayRecord>();

  get(burnHash: string): RelayRecord | undefined {
    const r = this.records.get(burnHash);
    return r ? { ...r } : undefined;
  }

  put(record: RelayRecord): void {
    this.records.set(record.burnHash, { ...record });
  }

  countSubmittedSince(since: number): number {
    return [...this.records.values()].filter((r) => r.submittedAt !== undefined && r.submittedAt >= since).length;
  }

  listOpen(): RelayRecord[] {
    return [...this.records.values()].filter((r) => !isSettled(r)).sort((a, b) => a.createdAt - b.createdAt);
  }

  listDue(now: number): RelayRecord[] {
    return [...this.records.values()]
      .filter((r) => r.retryAt !== undefined && r.retryAt <= now)
      .sort((a, b) => a.retryAt! - b.retryAt!)
      .map((r) => ({ ...r }));
  }
}

export const BASE_SEPOLIA_EXPLORER = "https://sepolia.basescan.org";

/**
 * What the API answers for a transfer. `kind` takes exactly the values of
 * the app's `CctpStatus` (frontend/app/src/lib/receive/cctpApi.ts), so the
 * screen reads it as is; `submitted` is reported as `confirmed`, since to
 * the borrower both mean the relay is minting.
 *
 * A transient failure the relay retries by itself is not reported as
 * `failed`: the app would show a dead end for a transfer that is still going
 * to complete. It is reported at the stage it reached (`confirmed` once
 * Circle has signed, `confirming` before) with `retrying: true`, the
 * `reason` and when the next attempt is due. `failed` means the relay has
 * stopped: a final refusal, or the give-up deadline passed.
 */
export interface CctpRelayView {
  burnHash: string;
  kind: "sent" | "confirming" | "confirmed" | "arrived" | "failed";
  /**
   * Set when `kind` is `arrived`. Null only when someone else completed the
   * mint and neither the RPC log search nor the indexer could name the
   * transaction; the relay searches again later and fills it in.
   */
  mintHash?: string | null;
  explorerUrl?: string;
  /** Why it failed, or, with `retrying`, what the relay is waiting out. */
  reason?: string;
  /** Set (true) while a transient failure is being retried automatically. */
  retrying?: true;
  /** With `retrying`: when the next attempt is due (ISO 8601). */
  nextRetryAt?: string;
  recipient?: string;
  amount?: string;
  feeExecuted?: string;
  mintedBy?: "relay" | "other";
  createdAt: string;
  updatedAt: string;
}

export function toRelayView(r: RelayRecord): CctpRelayView {
  const retrying = isRetrying(r);
  const kind = retrying ? (r.attestation ? "confirmed" : "confirming") : r.state === "submitted" ? "confirmed" : r.state;
  return {
    burnHash: r.burnHash,
    kind,
    ...(kind === "arrived" ? { mintHash: r.mintHash ?? null } : {}),
    ...(kind === "arrived" && r.mintHash ? { explorerUrl: `${BASE_SEPOLIA_EXPLORER}/tx/${r.mintHash}` } : {}),
    ...(kind === "failed" ? { reason: r.failure ?? "the relay stopped" } : {}),
    ...(retrying
      ? { retrying: true as const, reason: r.failure ?? "the relay is retrying", nextRetryAt: new Date(r.retryAt!).toISOString() }
      : {}),
    ...(r.recipient ? { recipient: r.recipient } : {}),
    ...(r.amount ? { amount: r.amount } : {}),
    ...(r.feeExecuted ? { feeExecuted: r.feeExecuted } : {}),
    ...(r.mintedBy ? { mintedBy: r.mintedBy } : {}),
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
  };
}

/** A burn hash as the relay keys it: 64 hex characters, lowercase. Undefined if `raw` is not one. */
export function normalizeBurnHash(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const hash = raw.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(hash) ? hash : undefined;
}

/**
 * Read-only lookup of a relay by its Stellar burn hash, for anything that
 * reports a transfer without driving it (the full-cycle timeline). Undefined
 * when the relay has never been asked about this burn.
 */
export function lookupCctpRelay(store: RelayStore, burnHash: string): CctpRelayView | undefined {
  const hash = normalizeBurnHash(burnHash);
  const record = hash ? store.get(hash) : undefined;
  return record ? toRelayView(record) : undefined;
}
