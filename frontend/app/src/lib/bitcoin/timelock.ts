import * as bitcoin from "bitcoinjs-lib";
import { deriveP2WSH } from "./address";

/**
 * Deposit timelock policy.
 *
 * `commitment-tree::deposit` and `private-lend::deposit` accept a CLTV height
 * only within 1,008..=105,000 blocks above the block that confirms the deposit
 * (`spv-types::script::timelock_in_bounds`). The UI aims for about a year past
 * the current tip, which stays inside that window even if confirmation takes
 * weeks, and rounds to a multiple of TIMELOCK_STEP so the chosen height can be
 * recovered from the transaction alone (see `findDepositOutput`) when the page
 * is reloaded between sending BTC and submitting the deposit.
 */
export const TIMELOCK_TARGET_MARGIN = 52_560; // ~1 year of 10-minute blocks
export const TIMELOCK_STEP = 1_000;
export const MAX_TIMELOCK_MARGIN = 105_000; // contract's upper bound

/** The timelock to lock a new deposit under, given the current tip height. */
export function chooseDepositTimelock(tipHeight: number): number {
  return Math.ceil((tipHeight + TIMELOCK_TARGET_MARGIN) / TIMELOCK_STEP) * TIMELOCK_STEP;
}

/** Current Bitcoin tip height from an Esplora API. */
export async function fetchTipHeight(apiUrl: string): Promise<number> {
  const res = await fetch(`${apiUrl}/blocks/tip/height`);
  if (!res.ok) throw new Error(`Could not read the Bitcoin tip height (${res.status})`);
  const height = Number((await res.text()).trim());
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error("Bitcoin API returned an invalid tip height");
  }
  return height;
}

export interface DepositOutput {
  timelockHeight: number;
  vout: number;
  valueSats: bigint;
}

/**
 * Finds the output of `rawTxHex` that pays this user's Writz P2WSH, and the
 * timelock it was derived with. Tries `hintTimelock` first, then every
 * TIMELOCK_STEP height a deposit made up to MAX_TIMELOCK_MARGIN blocks before
 * `tipHeight` could have used. Returns null when no output matches - the
 * contract would reject such a deposit with `VaultOutputNotFound`.
 */
export function findDepositOutput(params: {
  rawTxHex: string;
  protocolPubkeyHex: string;
  userPubkeyHex: string;
  tipHeight: number;
  hintTimelock?: number;
}): DepositOutput | null {
  const { rawTxHex, protocolPubkeyHex, userPubkeyHex, tipHeight, hintTimelock } = params;
  const tx = bitcoin.Transaction.fromHex(rawTxHex);

  const candidates: number[] = [];
  if (hintTimelock) candidates.push(hintTimelock);
  const newest = chooseDepositTimelock(tipHeight);
  const oldest = chooseDepositTimelock(Math.max(0, tipHeight - MAX_TIMELOCK_MARGIN));
  for (let h = newest; h >= oldest; h -= TIMELOCK_STEP) {
    if (h !== hintTimelock) candidates.push(h);
  }

  for (const timelockHeight of candidates) {
    const { scriptPubKey } = deriveP2WSH(protocolPubkeyHex, userPubkeyHex, timelockHeight);
    const vout = tx.outs.findIndex((o) => Buffer.from(o.script).equals(scriptPubKey));
    if (vout !== -1) {
      return { timelockHeight, vout, valueSats: BigInt(tx.outs[vout]!.value) };
    }
  }
  return null;
}
