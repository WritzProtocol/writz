import type { Read } from "@/lib/loan/model";
import type { RetentionCohort } from "@/lib/metrics/api";
import type { MockWorld, Reading } from "@/lib/mock/types";

export interface ProtocolData {
  pool: Read<{ totalSupplied: bigint; totalBorrowed: bigint; available: bigint }>;
  vault: Read<{ totalStroops: bigint; depositors: number; apy: number | null }>;
  cohorts: Read<RetentionCohort[]>;
  /** When the server read these, epoch ms. */
  at: number;
}

const read = <T,>(r: Reading<T>): Read<T> =>
  r.state === "loading" ? { kind: "checking" } : r.state === "failed" ? { kind: "failed" } : { kind: "ok", value: r.value };

const DAY = 86_400_000;

export function mockProtocolData(world: MockWorld, now: number): ProtocolData {
  const p = world.protocol;
  if (!p) return { pool: { kind: "failed" }, vault: { kind: "failed" }, cohorts: { kind: "failed" }, at: now };
  const vault = read(p.vault);
  const first = new Date(now - p.cohortDays * DAY).toISOString().slice(0, 10);
  const depositors = vault.kind === "ok" ? vault.value.depositors : 0;
  const cohorts: RetentionCohort[] =
    depositors > 0
      ? [{ cohort: first, depositors, eligible: p.cohortDays >= 30 ? depositors : 0, retained: p.cohortDays >= 30 ? Math.round(depositors * 0.84) : 0 }]
      : [];
  return { pool: read(p.pool), vault, cohorts: vault.kind === "failed" ? { kind: "failed" } : { kind: "ok", value: cohorts }, at: now };
}
