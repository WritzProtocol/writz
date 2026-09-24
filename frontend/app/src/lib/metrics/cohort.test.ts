import { describe, expect, it } from "bun:test";
import {
  analyzeCohort,
  formatTvlParts,
  getCohortAgeDays,
  summarizeCohorts,
} from "./cohort";

describe("cohort analysis (#113-#117)", () => {
  const fakeNow = new Date("2026-09-16T12:00:00Z");

  it("identifies a seasoning cohort (< 30 days old, 0 eligible)", () => {
    const analysis = analyzeCohort(
      {
        cohort: "2026-09-15",
        depositors: 1,
        eligible: 0,
        retained: 0,
      },
      fakeNow,
    );

    expect(analysis.state).toBe("seasoning");
    expect(analysis.retentionPercent).toBeNull();
    expect(analysis.eligible).toBe(0);
    expect(analysis.retained).toBe(0);
    expect(analysis.churned).toBe(0);
    expect(analysis.pendingSeasoning).toBe(1);
    expect(analysis.seasoningDays).toBe(1);
    expect(analysis.isFullySeasoned).toBe(false);
  });

  it("identifies a fully retained matured cohort", () => {
    const analysis = analyzeCohort(
      {
        cohort: "2026-08-01",
        depositors: 4,
        eligible: 4,
        retained: 4,
      },
      fakeNow,
    );

    expect(analysis.state).toBe("retained");
    expect(analysis.retentionPercent).toBe(100);
    expect(analysis.churned).toBe(0);
    expect(analysis.pendingSeasoning).toBe(0);
    expect(analysis.isFullySeasoned).toBe(true);
  });

  it("identifies a fully churned matured cohort", () => {
    const analysis = analyzeCohort(
      {
        cohort: "2026-08-01",
        depositors: 2,
        eligible: 2,
        retained: 0,
      },
      fakeNow,
    );

    expect(analysis.state).toBe("churned");
    expect(analysis.retentionPercent).toBe(0);
    expect(analysis.churned).toBe(2);
    expect(analysis.retained).toBe(0);
  });

  it("identifies a mixed matured cohort", () => {
    const analysis = analyzeCohort(
      {
        cohort: "2026-08-01",
        depositors: 10,
        eligible: 10,
        retained: 7,
      },
      fakeNow,
    );

    expect(analysis.state).toBe("mixed");
    expect(analysis.retentionPercent).toBe(70);
    expect(analysis.churned).toBe(3);
    expect(analysis.retained).toBe(7);
  });

  it("handles partial seasoning (some depositors reached 30d, some pending)", () => {
    const analysis = analyzeCohort(
      {
        cohort: "2026-08-16",
        depositors: 5,
        eligible: 3,
        retained: 2,
      },
      fakeNow,
    );

    expect(analysis.state).toBe("mixed");
    expect(analysis.retentionPercent).toBe(67);
    expect(analysis.eligible).toBe(3);
    expect(analysis.retained).toBe(2);
    expect(analysis.churned).toBe(1);
    expect(analysis.pendingSeasoning).toBe(2);
  });

  it("summarizes cohorts across seasoning and mature cohorts", () => {
    const summary = summarizeCohorts(
      [
        { cohort: "2026-08-01", depositors: 10, eligible: 10, retained: 8 },
        { cohort: "2026-09-15", depositors: 1, eligible: 0, retained: 0 },
      ],
      fakeNow,
    );

    expect(summary.totalCohorts).toBe(2);
    expect(summary.maturedCohorts).toBe(1);
    expect(summary.seasoningCohorts).toBe(1);
    expect(summary.totalDepositors).toBe(11);
    expect(summary.totalEligible).toBe(10);
    expect(summary.totalRetained).toBe(8);
    expect(summary.aggregateRetentionPercent).toBe(80);
  });

  it("calculates cohort age in days accurately", () => {
    expect(getCohortAgeDays("2026-09-15", fakeNow)).toBe(1);
    expect(getCohortAgeDays("2026-08-17", fakeNow)).toBe(30);
  });

  it("formats TVL into whole and fractional parts", () => {
    expect(formatTvlParts(null)).toEqual({ whole: "—", frac: "", formatted: "—" });
    expect(formatTvlParts(200_000_000n)).toEqual({
      whole: "20",
      frac: ".00",
      formatted: "20.00",
    });
    expect(formatTvlParts(20_500_000n)).toEqual({
      whole: "2",
      frac: ".05",
      formatted: "2.05",
    });
    expect(formatTvlParts(12_345_678_1234567n)).toEqual({
      whole: "12,345,678",
      frac: ".1234567",
      formatted: "12,345,678.1234567",
    });
  });
});
