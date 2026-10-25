/**
 * Claim records for the Signet faucet: what the one-claim rules, the per-IP
 * allowance and the daily cap are computed from. The relayer uses the sqlite
 * store (`sqlite-store.ts`) so the limits survive a restart; tests use the
 * in-memory one below.
 */

export interface ClaimRecord {
  /** Recipient Signet address, lowercase. */
  address: string;
  /** SHA-256 of the client IP, so the IP itself is never stored. */
  ipHash: string;
  /** SHA-256 of the Pollar user id the claim was verified for (`userKeyFor`), never the id or profile. */
  userKey: string;
  /** The Stellar address of the Pollar wallet that claimed. */
  stellarAddress: string;
  txid: string;
  amountSat: number;
  /** Unix milliseconds. */
  createdAt: number;
}

export interface ClaimStore {
  /** True if `address` ever received coins, including payouts recorded before claims needed a login. */
  hasClaimForAddress(address: string): boolean;
  /** True if this Pollar account (by `userKey`) ever claimed. */
  hasClaimForUser(userKey: string): boolean;
  /** True if this Stellar address ever claimed. */
  hasClaimForStellarAddress(stellarAddress: string): boolean;
  /**
   * Times (Unix ms, oldest first) of the claims from `ipHash` at or after
   * `since`: their count is the per-IP allowance used, and the oldest ones
   * tell when the window frees a slot.
   */
  ipClaimsSince(ipHash: string, since: number): number[];
  /** Number of claims at or after `since` (Unix ms). */
  countSince(since: number): number;
  /** Throws if the account, the Stellar address or the Signet address already claimed. */
  record(claim: ClaimRecord): void;
}

export class MemoryClaimStore implements ClaimStore {
  readonly claims: ClaimRecord[] = [];

  hasClaimForAddress(address: string): boolean {
    return this.claims.some((c) => c.address === address);
  }

  hasClaimForUser(userKey: string): boolean {
    return this.claims.some((c) => c.userKey === userKey);
  }

  hasClaimForStellarAddress(stellarAddress: string): boolean {
    return this.claims.some((c) => c.stellarAddress === stellarAddress);
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
    if (
      this.hasClaimForUser(claim.userKey) ||
      this.hasClaimForStellarAddress(claim.stellarAddress) ||
      this.hasClaimForAddress(claim.address)
    ) {
      throw new Error("UNIQUE constraint failed: faucet_claims");
    }
    this.claims.push(claim);
  }
}
