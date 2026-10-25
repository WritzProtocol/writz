/**
 * Single-use challenges for faucet claims. The browser signs a message that
 * contains one with its Signet key, so a signature cannot be replayed for a
 * second claim or reused from another context. Kept in memory: the relayer
 * runs as one process, and a restart only invalidates challenges that were
 * minutes from expiring anyway.
 */
import { randomBytes } from "crypto";

export const NONCE_TTL_MS = 5 * 60_000;
/** Outstanding challenges kept at most; the oldest are dropped first. */
const MAX_OUTSTANDING = 10_000;

export interface IssuedNonce {
  nonce: string;
  /** Unix milliseconds. */
  expiresAt: number;
}

export class NonceBook {
  private readonly issued = new Map<string, number>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = NONCE_TTL_MS,
  ) {}

  issue(): IssuedNonce {
    this.prune();
    while (this.issued.size >= MAX_OUTSTANDING) {
      const oldest = this.issued.keys().next().value;
      if (oldest === undefined) break;
      this.issued.delete(oldest);
    }
    const nonce = randomBytes(16).toString("hex");
    const expiresAt = this.now() + this.ttlMs;
    this.issued.set(nonce, expiresAt);
    return { nonce, expiresAt };
  }

  /** True once per issued, unexpired nonce; the nonce is spent whatever the claim's outcome. */
  consume(nonce: string): boolean {
    const expiresAt = this.issued.get(nonce);
    if (expiresAt === undefined) return false;
    this.issued.delete(nonce);
    return expiresAt > this.now();
  }

  private prune(): void {
    const t = this.now();
    for (const [n, exp] of this.issued) if (exp <= t) this.issued.delete(n);
  }
}

/**
 * The text the Signet key signs (BIP-137) to claim. Must stay byte-identical
 * to `faucetClaimMessage` in frontend/app/src/lib/faucet/claim.ts.
 */
export function faucetClaimMessage(nonce: string, stellarAddress: string, signetAddress: string): string {
  return `Writz Signet faucet\nnonce:${nonce}\nstellar:${stellarAddress}\nsignet:${signetAddress}`;
}
