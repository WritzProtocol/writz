/**
 * Plain single-key payments: spend P2WPKH outputs held by one key to one
 * recipient, with change back to the same key.
 *
 * Built for the relayer's Signet faucet, which pays test coins from a hot
 * wallet. Nothing here touches a Writz lock: the key passed in is whatever
 * the caller holds, and it should never be the protocol key.
 */

import * as bitcoin from 'bitcoinjs-lib';
import type { Signer } from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';

// Taproot (bech32m, witness v1) recipients need an ECC library to validate.
bitcoin.initEccLib(ecc);

/** Below this a P2WPKH change output is uneconomic to spend; it goes to fees. */
export const P2WPKH_DUST_LIMIT_SAT = 294;

// Virtual sizes used for fee estimation. A P2WPKH input is 41 bytes plus a
// 108-byte witness at most (72-byte DER signature, 33-byte key, length
// prefixes): 41 + 108 / 4 = 68 vbytes, rounded up. The fixed part is
// version, locktime, counts and the segwit marker: 10.5 vbytes, rounded up.
const TX_OVERHEAD_VB = 11;
const P2WPKH_INPUT_VB = 68;

/** One spendable output of the payer's P2WPKH address. */
export interface P2wpkhUtxo {
  /** Funding transaction id, display (reversed) byte order. */
  txid: string;
  vout: number;
  /** Value in satoshis. */
  value: number;
}

export interface P2wpkhPaymentParams {
  /** Candidate inputs, in the order they should be tried. */
  utxos: P2wpkhUtxo[];
  /** Recipient address on `network`. */
  to: string;
  amountSat: number;
  /** Fee rate in sat/vbyte. */
  feeRate: number;
  /** The key that owns every UTXO. Its P2WPKH address receives the change. */
  signer: Signer;
  network: bitcoin.networks.Network;
}

export interface P2wpkhPayment {
  txHex: string;
  txid: string;
  feeSat: number;
  /** 0 when the change was below the dust limit and went to fees. */
  changeSat: number;
  vsize: number;
  /** The UTXOs this transaction spends. */
  inputs: P2wpkhUtxo[];
}

/** Thrown when the UTXOs cannot cover the amount plus fees. */
export class InsufficientFundsError extends Error {
  constructor(
    public readonly availableSat: number,
    public readonly requiredSat: number,
  ) {
    super(`insufficient funds: ${availableSat} sats available, ${requiredSat} needed`);
    this.name = 'InsufficientFundsError';
  }
}

/**
 * Returns the output script for `address` on `network`, or throws if the
 * address is malformed or belongs to another network.
 */
export function addressToOutputScript(address: string, network: bitcoin.networks.Network): Buffer {
  return bitcoin.address.toOutputScript(address, network);
}

function outputVbytes(script: Buffer): number {
  // 8-byte value, 1-byte script length, the script.
  return 8 + 1 + script.length;
}

/** Estimated vsize of a transaction with `inputs` P2WPKH inputs and the given outputs. */
export function estimateP2wpkhVsize(inputs: number, outputScripts: Buffer[]): number {
  return TX_OVERHEAD_VB + inputs * P2WPKH_INPUT_VB + outputScripts.reduce((s, o) => s + outputVbytes(o), 0);
}

/**
 * Builds and signs a payment of `amountSat` to `to`, choosing inputs from
 * `utxos` in the order given until they cover the amount and the fee. Change
 * goes back to the signer's own P2WPKH address, or to fees when it would be
 * dust.
 */
export function buildP2wpkhPayment(params: P2wpkhPaymentParams): P2wpkhPayment {
  const { utxos, to, amountSat, feeRate, signer, network } = params;
  if (!Number.isSafeInteger(amountSat) || amountSat <= 0) throw new Error('amountSat must be a positive integer');
  if (!(feeRate > 0)) throw new Error('feeRate must be positive');

  const recipientScript = addressToOutputScript(to, network);
  const payer = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(signer.publicKey), network });
  if (!payer.output || !payer.address) throw new Error('could not derive the payer P2WPKH script');
  const changeScript = payer.output;

  const selected: P2wpkhUtxo[] = [];
  let total = 0;
  let feeSat = 0;
  let changeSat = 0;
  let covered = false;
  for (const utxo of utxos) {
    selected.push(utxo);
    total += utxo.value;
    const feeWithChange = Math.ceil(estimateP2wpkhVsize(selected.length, [recipientScript, changeScript]) * feeRate);
    const change = total - amountSat - feeWithChange;
    if (change >= P2WPKH_DUST_LIMIT_SAT) {
      feeSat = feeWithChange;
      changeSat = change;
      covered = true;
      break;
    }
    const feeNoChange = Math.ceil(estimateP2wpkhVsize(selected.length, [recipientScript]) * feeRate);
    if (total - amountSat >= feeNoChange) {
      // Whatever is left over (less than the dust limit plus a change output) goes to fees.
      feeSat = total - amountSat;
      changeSat = 0;
      covered = true;
      break;
    }
  }
  if (!covered) {
    const all = utxos.reduce((s, u) => s + u.value, 0);
    const minFee = Math.ceil(estimateP2wpkhVsize(Math.max(1, utxos.length), [recipientScript]) * feeRate);
    throw new InsufficientFundsError(all, amountSat + minFee);
  }

  const psbt = new bitcoin.Psbt({ network });
  for (const utxo of selected) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: { script: changeScript, value: utxo.value },
    });
  }
  psbt.addOutput({ script: recipientScript, value: amountSat });
  if (changeSat > 0) psbt.addOutput({ script: changeScript, value: changeSat });
  psbt.signAllInputs(signer);
  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();

  return {
    txHex: tx.toHex(),
    txid: tx.getId(),
    feeSat,
    changeSat,
    vsize: tx.virtualSize(),
    inputs: selected,
  };
}
