/** Checks a replay against the contract, which is the only authority. */
import type { ReplayedState } from "./replay.js";

export interface LendChainReader {
  /** The position's status, or null if the contract has no such position. */
  positionStatus(txid: string): Promise<string | null>;
  scaledSupply(supplier: string): Promise<bigint>;
  totalScaledSupply(): Promise<bigint>;
  hasRelease(txid: string): Promise<boolean>;
}

export interface VerifyResult {
  /** The first difference from the chain, or null when everything agrees. */
  mismatch: string | null;
  /** Positions repaid in full with no release on chain yet. */
  missingReleases: string[];
}

export async function verifyAgainstChain(state: ReplayedState, chain: LendChainReader): Promise<VerifyResult> {
  for (const [txid, expected] of state.positions) {
    const status = await chain.positionStatus(txid);
    if (status !== expected) {
      return { mismatch: `position ${txid}: replay says ${expected}, chain says ${status ?? "no position"}`, missingReleases: [] };
    }
  }
  for (const [supplier, expected] of state.scaledBySupplier) {
    const scaled = await chain.scaledSupply(supplier);
    if (scaled !== expected) {
      return { mismatch: `supplier ${supplier}: replay says ${expected} scaled, chain says ${scaled}`, missingReleases: [] };
    }
  }
  const total = await chain.totalScaledSupply();
  if (total !== state.totalScaled) {
    return { mismatch: `total scaled supply: replay says ${state.totalScaled}, chain says ${total}`, missingReleases: [] };
  }
  const missingReleases: string[] = [];
  for (const txid of state.repaidInFull) {
    if (!(await chain.hasRelease(txid))) missingReleases.push(txid);
  }
  return { mismatch: null, missingReleases };
}
