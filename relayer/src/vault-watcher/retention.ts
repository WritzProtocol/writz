/**
 * 30-day retention cohorts from vault-watcher's (#114) indexed events.
 * Pure function over `VaultEvent[]` (plus an injectable `now`) - no I/O, so
 * it's trivially unit-testable with synthetic dates.
 */
import { readAllVaultEvents, type VaultEvent } from "./event-store.js";

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

export interface CohortRetention {
  /** UTC calendar day of this cohort's first deposit, `YYYY-MM-DD`. */
  cohort: string;
  /** Depositors whose first-ever deposit fell on this day. */
  depositors: number;
  /** Of those, how many have actually reached the 30-day mark as of `now` -
   * a cohort less than 30 days old has depositors who are neither retained
   * nor churned yet, just too early to tell. */
  eligible: number;
  /** Of the eligible depositors, how many still held a positive net
   * balance (their own deposits minus withdrawals, using only events up to
   * their individual 30-day mark) - i.e. hadn't fully withdrawn. */
  retained: number;
}

function utcDay(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * Defaults to reading every persisted event; accepts an explicit list (and
 * `now`) so callers and tests can compute cohorts without touching sqlite
 * or the real clock.
 */
export function computeRetentionCohorts(
  events: VaultEvent[] = readAllVaultEvents(),
  now: Date = new Date(),
): CohortRetention[] {
  const byDepositor = new Map<string, VaultEvent[]>();
  for (const event of events) {
    const list = byDepositor.get(event.depositor);
    if (list) list.push(event);
    else byDepositor.set(event.depositor, [event]);
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const cohorts = new Map<string, CohortRetention>();

  for (const depositorEvents of byDepositor.values()) {
    const deposits = depositorEvents.filter((e) => e.kind === "deposit");
    if (deposits.length === 0) continue; // Withdrew-only anomaly - not a depositor cohort.

    const firstDepositTime = Math.min(...deposits.map((e) => e.ledgerCloseTime));
    const cohortDay = utcDay(firstDepositTime);
    const cutoff = firstDepositTime + THIRTY_DAYS_SECONDS;

    let cohort = cohorts.get(cohortDay);
    if (!cohort) {
      cohort = { cohort: cohortDay, depositors: 0, eligible: 0, retained: 0 };
      cohorts.set(cohortDay, cohort);
    }
    cohort.depositors += 1;

    if (nowSeconds < cutoff) continue; // Too early to classify this depositor.
    cohort.eligible += 1;

    let netStroops = 0n;
    for (const e of depositorEvents) {
      if (e.ledgerCloseTime > cutoff) continue;
      const amount = BigInt(e.amountStroops);
      netStroops += e.kind === "deposit" ? amount : -amount;
    }
    if (netStroops > 0n) cohort.retained += 1;
  }

  return [...cohorts.values()].sort((a, b) => a.cohort.localeCompare(b.cohort));
}
