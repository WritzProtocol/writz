/**
 * Bitcoin P2WSH redeem script construction.
 *
 * Implements the Writz Protocol locking script:
 *
 *   OP_IF
 *     <protocol_pubkey> OP_CHECKSIGVERIFY   ← path A: protocol co-signs release
 *     <user_pubkey>     OP_CHECKSIG
 *   OP_ELSE
 *     <timelock_height> OP_CHECKLOCKTIMEVERIFY OP_DROP
 *     <user_pubkey>     OP_CHECKSIG           ← path B: emergency recovery
 *   OP_ENDIF
 *
 * Path A is used for normal loan repayment — both the protocol and the user
 * sign the release transaction cooperatively.
 *
 * Path B is used if Writz becomes unavailable — after the timelock block height
 * is reached, the user can recover their BTC with their key alone, with no
 * Writz involvement.
 */

import * as bitcoin from 'bitcoinjs-lib';

/** Minimum block height timelock accepted by Writz (prevents obviously wrong values). */
export const MIN_TIMELOCK_HEIGHT = 100_000;

/** Maximum future timelock offset from the current tip (≈ 2 years of blocks). */
export const MAX_TIMELOCK_OFFSET = 105_000;

/**
 * Builds the Writz Protocol P2WSH redeem script.
 *
 * @param protocolPubkey - Writz co-signing public key (33 bytes, compressed).
 * @param userPubkey     - User's Bitcoin public key (33 bytes, compressed).
 * @param timelockHeight - Absolute block height for the emergency CLTV escape hatch.
 */
export function buildRedeemScript(
  protocolPubkey: Buffer,
  userPubkey: Buffer,
  timelockHeight: number,
): Buffer {
  if (protocolPubkey.length !== 33) throw new Error('protocolPubkey must be 33-byte compressed');
  if (userPubkey.length !== 33)     throw new Error('userPubkey must be 33-byte compressed');
  if (timelockHeight < MIN_TIMELOCK_HEIGHT) {
    throw new Error(`timelockHeight must be ≥ ${MIN_TIMELOCK_HEIGHT}`);
  }

  return bitcoin.script.compile([
    bitcoin.opcodes.OP_IF,
      protocolPubkey,
      bitcoin.opcodes.OP_CHECKSIGVERIFY,
      userPubkey,
      bitcoin.opcodes.OP_CHECKSIG,
    bitcoin.opcodes.OP_ELSE,
      bitcoin.script.number.encode(timelockHeight),
      bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
      bitcoin.opcodes.OP_DROP,
      userPubkey,
      bitcoin.opcodes.OP_CHECKSIG,
    bitcoin.opcodes.OP_ENDIF,
  ]);
}

/**
 * Decompiles and returns the elements of a Writz redeem script for inspection.
 * Useful for debugging and off-chain verification.
 */
export function decompileRedeemScript(redeemScript: Buffer): (number | Buffer)[] {
  const items = bitcoin.script.decompile(redeemScript);
  if (!items) throw new Error('failed to decompile script');
  return items;
}

/**
 * Computes the timelock for a new deposit.
 *
 * @param depositBlockHeight - The block height at which the deposit was confirmed.
 * @param loanDurationBlocks - Loan duration in Bitcoin blocks (10 min/block).
 * @param safetyBufferBlocks - Extra blocks after loan expiry before user can self-recover.
 *                             Defaults to 1,008 blocks (≈7 days).
 */
export function computeTimelock(
  depositBlockHeight: number,
  loanDurationBlocks: number,
  safetyBufferBlocks = 1_008,
): number {
  return depositBlockHeight + loanDurationBlocks + safetyBufferBlocks;
}
