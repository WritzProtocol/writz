/**
 * P2WSH deposit address derivation.
 *
 * Each Writz deposit gets a unique Bitcoin address derived from:
 *   - The Writz protocol co-signing public key
 *   - The user's Bitcoin public key
 *   - The CLTV timelock height for this deposit
 *
 * The address is: bech32(OP_0 + SHA256(redeemScript))
 */

import * as bitcoin from 'bitcoinjs-lib';
import { buildRedeemScript } from './script.js';

/** All parameters that uniquely identify a single Writz deposit address. */
export interface LockingParams {
  /** Writz Protocol co-signing public key, 33 bytes compressed. */
  protocolPubkey: Buffer;
  /** User's Bitcoin public key, 33 bytes compressed. */
  userPubkey: Buffer;
  /** Absolute block height after which the user can self-recover (CLTV). */
  timelockHeight: number;
}

/** Result of deriving a deposit address. */
export interface DepositAddress {
  /** Bech32 P2WSH address (starts with "bc1q..." on mainnet, "tb1q..." on testnet). */
  address: string;
  /** 34-byte scriptPubKey: OP_0 <32-byte-SHA256(redeemScript)>. */
  scriptPubKey: Buffer;
  /** The full redeem script that must be revealed when spending. */
  redeemScript: Buffer;
}

/**
 * Derives the unique P2WSH deposit address for a given set of locking parameters.
 *
 * The same (protocolPubkey, userPubkey, timelockHeight) triple always
 * produces the same address — derivation is deterministic.
 *
 * @param params  - The locking parameters for this deposit.
 * @param network - `bitcoin.networks.bitcoin` for mainnet, `.testnet` for testnet.
 */
export function deriveDepositAddress(
  params: LockingParams,
  network: bitcoin.networks.Network,
): DepositAddress {
  const redeemScript = buildRedeemScript(
    params.protocolPubkey,
    params.userPubkey,
    params.timelockHeight,
  );

  const payment = bitcoin.payments.p2wsh({
    redeem: { output: redeemScript, network },
    network,
  });

  if (!payment.address || !payment.output) {
    throw new Error('failed to derive P2WSH address');
  }

  return {
    address: payment.address,
    scriptPubKey: payment.output,
    redeemScript,
  };
}

/**
 * Returns the SHA256 of the redeem script (the "script hash" committed to in
 * the P2WSH output). Used for on-chain lookup and verification.
 */
export function redeemScriptHash(redeemScript: Buffer): Buffer {
  return bitcoin.crypto.sha256(redeemScript);
}
