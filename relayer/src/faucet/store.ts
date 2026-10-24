/**
 * Claim records for the Signet faucet: what the cooldowns and the daily cap
 * are computed from. The relayer uses the sqlite store (`sqlite-store.ts`) so
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
  /** Time of the latest claim from `ipHash`, or undefined. */
  lastClaimForIp(ipHash: string): number | undefined;
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

  lastClaimForIp(ipHash: string): number | undefined {
    return this.latest((c) => c.ipHash === ipHash);
  }

  countSince(since: number): number {
    return this.claims.filter((c) => c.createdAt >= since).length;
  }

  record(claim: ClaimRecord): void {
    this.claims.push(claim);
  }
}
