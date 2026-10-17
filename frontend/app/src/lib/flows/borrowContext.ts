import { config } from "@/config";
import { getBorrowParams } from "@/lib/contracts/commitmentTree";
import { fetchTipHeight } from "@/lib/bitcoin/timelock";
import { randomEphemeralScalar } from "@/lib/position";

/**
 * Blocks added to the bound a borrow proves its timelock clears. The contract
 * measures the margin from `bitcoin-spv`'s tip, which trails the Esplora tip
 * read here, so a small cushion keeps a proof valid while it is signed and
 * submitted. The bound reveals only the current tip, never the position's own
 * timelock.
 */
export const TIMELOCK_SLACK_BLOCKS = 12;

/** The public, non-witness inputs every borrow_repay proof needs since #212. */
export interface KeeperInputs {
  min_timelock_height: string;
  eph_sk: string;
  keeper_pub_x: string;
  keeper_pub_y: string;
}

export interface BorrowContext {
  inputs: KeeperInputs;
  /** The lowest timelock a borrow can be proven for right now. */
  minTimelockHeight: number;
}

/** Pure part of `readBorrowContext`, for tests. */
export function minTimelockFor(tipHeight: number, marginBlocks: number): number {
  return tipHeight + marginBlocks + TIMELOCK_SLACK_BLOCKS;
}

export async function readBorrowContext(): Promise<BorrowContext> {
  const [params, tip] = await Promise.all([getBorrowParams(), fetchTipHeight(config.bitcoin.apiUrl)]);
  const minTimelockHeight = minTimelockFor(tip, params.timelockMarginBlocks);
  return {
    minTimelockHeight,
    inputs: {
      min_timelock_height: String(minTimelockHeight),
      eph_sk: randomEphemeralScalar().toString(),
      keeper_pub_x: params.keeperPubX,
      keeper_pub_y: params.keeperPubY,
    },
  };
}
