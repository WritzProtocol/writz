/**
 * Key management utilities for Writz Protocol.
 *
 * In Phase 1, the protocol private key is stored in a cloud HSM.
 * This module provides the abstraction used in tests and local development.
 * Production use replaces `sign()` with an HSM-backed signing call.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { ECPairFactory, ECPairInterface } from 'ecpair';

const ECPair = ECPairFactory(ecc);

/** A Bitcoin key pair with an explicit network binding. */
export interface WritzKeyPair {
  /** 33-byte compressed public key. */
  publicKey: Buffer;
  /** The underlying ECPair — implements the bitcoinjs-lib Signer interface. */
  signer: ECPairInterface;
  /** The network this key is bound to. */
  network: bitcoin.networks.Network;
}

/**
 * Generates a fresh random key pair for the given network.
 * For tests and local development only — never log the private key in production.
 */
export function generateKeyPair(network: bitcoin.networks.Network): WritzKeyPair {
  const pair = ECPair.makeRandom({ network });
  return {
    publicKey: Buffer.from(pair.publicKey),
    signer: pair,
    network,
  };
}

/**
 * Loads a key pair from a raw 32-byte private key buffer.
 * Used for deterministic test vectors and HSM-backed signing stubs.
 */
export function keyPairFromPrivkey(
  privkeyBuf: Buffer,
  network: bitcoin.networks.Network,
): WritzKeyPair {
  const pair = ECPair.fromPrivateKey(privkeyBuf, { network, compressed: true });
  return {
    publicKey: Buffer.from(pair.publicKey),
    signer: pair,
    network,
  };
}

/**
 * Derives the Bitcoin address (P2WPKH, bech32) for a given public key.
 * Used to generate the user's return address for BTC release.
 */
export function pubkeyToP2WPKHAddress(
  pubkey: Buffer,
  network: bitcoin.networks.Network,
): string {
  const payment = bitcoin.payments.p2wpkh({ pubkey, network });
  if (!payment.address) throw new Error('failed to derive P2WPKH address');
  return payment.address;
}
