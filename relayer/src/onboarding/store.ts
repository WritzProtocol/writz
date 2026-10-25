/**
 * Storage for the onboarding funnel (`funnel.ts`). One row per subject, step
 * and outcome, written the first time it happens and never updated: the
 * funnel counts people who reached a step, not how often they repeated it.
 *
 * A subject is an HMAC of a Stellar address under a secret that never leaves
 * this store (`secret()`), so the table holds no address, no Pollar id, no
 * email and no IP. The relayer uses the sqlite store (`sqlite-store.ts`);
 * tests use the in-memory one below.
 */

export interface FunnelRow {
  /** HMAC-SHA256 of the Stellar address, hex (`subjectOf`). */
  subject: string;
  step: string;
  /** "ok" for a plain step; the result code for a faucet claim ("paid", "account_already_claimed", ...). */
  outcome: string;
  /** "social" (Pollar sign-in) or "wallet" (an extension wallet). */
  channel: string;
  /** True when the relayer checked the step itself (on Stellar, or because it paid the claim). */
  verified: boolean;
  /** Unix milliseconds of the first time this subject reached this step with this outcome. */
  createdAt: number;
}

export interface FunnelStore {
  /** Records the row unless one with the same subject, step and outcome exists. True when it was new. */
  record(row: FunnelRow): boolean;
  /** Every row, oldest first. The table is small: a handful of rows per person. */
  rows(): FunnelRow[];
  /** The HMAC key for subjects, created once per store and kept with it. */
  secret(): string;
}

export function memoryFunnelStore(secret = "test-secret"): FunnelStore {
  const rows: FunnelRow[] = [];
  const keys = new Set<string>();
  return {
    record(row) {
      const key = `${row.subject}|${row.step}|${row.outcome}`;
      if (keys.has(key)) return false;
      keys.add(key);
      rows.push({ ...row });
      return true;
    },
    rows: () => [...rows].sort((a, b) => a.createdAt - b.createdAt),
    secret: () => secret,
  };
}
