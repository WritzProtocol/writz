/**
 * Claim records for the Signet faucet: what the address cooldown, the per-IP
 * allowance and the daily cap are computed from. The relayer uses the sqlite store (`sqlite-store.ts`) so
 * the limits survive a restart; tests use the in-memory one below.
 */

export interface ClaimRecord {
  /** Recipient address, lowercase. */
  address: string;
  /** SHA-256 of the client IP, so the address itself is never stored. */
  ipHash: string;
  txid: string;
  amountSat: number;
  /** Unix milliseconds. */
  createdAt: number;
}

export interface ClaimStore {
  /** Time of the latest claim to `address`, or undefined. */
  lastClaimForAddress(address: string): number | undefined;
  /**
   * Times (Unix ms, oldest first) of the claims from `ipHash` at or after
   * `since`: their count is the per-IP allowance used, and the oldest ones
   * tell when the window frees a slot.
   */
  ipClaimsSince(ipHash: string, since: number): number[];
  /** Number of claims at or after `since` (Unix ms). */
  countSince(since: number): number;
  record(claim: ClaimRecord): void;
}

export class MemoryClaimStore implements ClaimStore {
  readonly claims: ClaimRecord[] = [];

  private latest(match: (c: ClaimRecord) => boolean): number | undefined {
    let t: number | undefined;
    for (const c of this.claims) if (match(c) && (t === undefined || c.createdAt > t)) t = c.createdAt;
    return t;
  }

  lastClaimForAddress(address: string): number | undefined {
    return this.latest((c) => c.address === address);
  }

  ipClaimsSince(ipHash: string, since: number): number[] {
    return this.claims
      .filter((c) => c.ipHash === ipHash && c.createdAt >= since)
      .map((c) => c.createdAt)
      .sort((a, b) => a - b);
  }

  countSince(since: number): number {
    return this.claims.filter((c) => c.createdAt >= since).length;
  }

  record(claim: ClaimRecord): void {
    this.claims.push(claim);
  }
}
