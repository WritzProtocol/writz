/** What the archived events say the contract's state must be. */
import type { LendEventRow } from "../lend-events/store.js";

export type ExpectedStatus = "Active" | "Closed" | "Liquidated";

export interface ReplayedState {
  /** By position txid (internal byte order, hex). */
  positions: Map<string, ExpectedStatus>;
  /** Scaled supply by supplier address. */
  scaledBySupplier: Map<string, bigint>;
  totalScaled: bigint;
  /** Positions repaid in full, which are owed a release. */
  repaidInFull: string[];
}

function scaledAmount(row: LendEventRow): bigint {
  const { scaled_amount: scaled } = JSON.parse(row.data) as { scaled_amount?: string };
  if (scaled === undefined) throw new Error(`${row.name} event ${row.id} has no scaled_amount`);
  return BigInt(scaled);
}

export function replay(rows: LendEventRow[]): ReplayedState {
  const positions = new Map<string, ExpectedStatus>();
  const scaledBySupplier = new Map<string, bigint>();
  const repaidInFull: string[] = [];

  for (const row of rows) {
    switch (row.name) {
      case "deposit":
        positions.set(row.subject, "Active");
        break;
      case "repay_full":
        positions.set(row.subject, "Closed");
        repaidInFull.push(row.subject);
        break;
      case "liquidate":
        positions.set(row.subject, "Liquidated");
        break;
      case "supply":
        scaledBySupplier.set(row.subject, (scaledBySupplier.get(row.subject) ?? 0n) + scaledAmount(row));
        break;
      case "withdraw":
        scaledBySupplier.set(row.subject, (scaledBySupplier.get(row.subject) ?? 0n) - scaledAmount(row));
        break;
    }
  }

  let totalScaled = 0n;
  for (const scaled of scaledBySupplier.values()) totalScaled += scaled;
  return { positions, scaledBySupplier, totalScaled, repaidInFull };
}
