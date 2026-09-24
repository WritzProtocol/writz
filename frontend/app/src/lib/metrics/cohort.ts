import type { RetentionCohort } from "./api";
import { STROOP } from "@/lib/earn/amount";

export type CohortState = "seasoning" | "retained" | "churned" | "mixed";

export interface CohortAnalysis {
  cohort: string;
  depositors: number;
  eligible: number;
  retained: number;
  churned: number;
  pendingSeasoning: number;
  retentionPercent: number | null;
  state: CohortState;
  seasoningDays: number;
  isFullySeasoned: boolean;
}

export interface CohortsSummary {
  totalCohorts: number;
  maturedCohorts: number;
  seasoningCohorts: number;
  totalDepositors: number;
  totalEligible: number;
  totalRetained: number;
  aggregateRetentionPercent: number | null;
}

/**
 * Calculates calendar age in days from a UTC `YYYY-MM-DD` date string.
 */
export function getCohortAgeDays(cohortDateStr: string, now: Date = new Date()): number {
  const parts = cohortDateStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return 0;
  const cohortUtc = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  const nowUtc = now.getTime();
  if (isNaN(cohortUtc)) return 0;
  const diffMs = nowUtc - cohortUtc;
  if (diffMs <= 0) return 1;
  return Math.max(1, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

/**
 * Transforms a raw RetentionCohort into rich analysis for rendering:
 * separates eligible-and-retained, eligible-and-churned, and seasoning.
 */
export function analyzeCohort(cohort: RetentionCohort, now: Date = new Date()): CohortAnalysis {
  const ageDays = getCohortAgeDays(cohort.cohort, now);
  const seasoningDays = Math.min(30, ageDays);
  const isFullySeasoned = ageDays >= 30;

  const eligible = Math.max(0, cohort.eligible);
  const retained = Math.max(0, Math.min(eligible, cohort.retained));
  const churned = Math.max(0, eligible - retained);
  const pendingSeasoning = Math.max(0, cohort.depositors - eligible);

  let retentionPercent: number | null = null;
  let state: CohortState = "seasoning";

  if (eligible > 0) {
    retentionPercent = Math.round((retained / eligible) * 100);
    if (retained === eligible) {
      state = "retained";
    } else if (retained === 0) {
      state = "churned";
    } else {
      state = "mixed";
    }
  } else {
    state = "seasoning";
  }

  return {
    cohort: cohort.cohort,
    depositors: cohort.depositors,
    eligible,
    retained,
    churned,
    pendingSeasoning,
    retentionPercent,
    state,
    seasoningDays,
    isFullySeasoned,
  };
}

/**
 * Computes protocol-wide cohort totals and weighted 30-day retention.
 */
export function summarizeCohorts(cohorts: RetentionCohort[], now: Date = new Date()): CohortsSummary {
  let totalDepositors = 0;
  let totalEligible = 0;
  let totalRetained = 0;
  let maturedCohorts = 0;
  let seasoningCohorts = 0;

  for (const cohort of cohorts) {
    const analysis = analyzeCohort(cohort, now);
    totalDepositors += analysis.depositors;
    totalEligible += analysis.eligible;
    totalRetained += analysis.retained;
    if (analysis.eligible > 0) {
      maturedCohorts += 1;
    } else {
      seasoningCohorts += 1;
    }
  }

  const aggregateRetentionPercent =
    totalEligible > 0 ? Math.round((totalRetained / totalEligible) * 100) : null;

  return {
    totalCohorts: cohorts.length,
    maturedCohorts,
    seasoningCohorts,
    totalDepositors,
    totalEligible,
    totalRetained,
    aggregateRetentionPercent,
  };
}

/**
 * Splits USDC stroops into whole and fractional parts with 2-7 decimal places,
 * styled for institutional editorial presentation.
 */
export function formatTvlParts(stroops: bigint | null): {
  whole: string;
  frac: string;
  formatted: string;
} {
  if (stroops === null) {
    return { whole: "—", frac: "", formatted: "—" };
  }

  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const whole = (abs / STROOP).toLocaleString("en-US");
  const rawFrac = (abs % STROOP).toString().padStart(7, "0");
  const trimmed = rawFrac.replace(/0+$/, "");
  const frac = trimmed.length < 2 ? rawFrac.slice(0, 2) : trimmed;
  const formatted = `${negative ? "-" : ""}${whole}.${frac}`;

  return {
    whole: `${negative ? "-" : ""}${whole}`,
    frac: `.${frac}`,
    formatted,
  };
}
