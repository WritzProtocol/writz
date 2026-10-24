import { describe, test, expect } from 'bun:test';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { ECPairFactory } from 'ecpair';
import {
  buildP2wpkhPayment,
  addressToOutputScript,
  InsufficientFundsError,
  P2WPKH_DUST_LIMIT_SAT,
} from '../src/payment.js';
import { keyPairFromWif, pubkeyToP2WPKHAddress } from '../src/keys.js';

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet;
const payer = ECPair.fromPrivateKey(Buffer.alloc(32, 1), { network });
const payerAddress = pubkeyToP2WPKHAddress(Buffer.from(payer.publicKey), network);
const recipient = pubkeyToP2WPKHAddress(Buffer.from(ECPair.fromPrivateKey(Buffer.alloc(32, 2)).publicKey), network);

const utxo = (i: number, value: number) => ({ txid: String(i).padStart(2, '0').repeat(32), vout: i, value });

describe('buildP2wpkhPayment', () => {
  test('pays the amount, returns change to the payer and signs every input', () => {
    const p = buildP2wpkhPayment({ utxos: [utxo(1, 100_000)], to: recipient, amountSat: 20_000, feeRate: 2, signer: payer, network });
    const tx = bitcoin.Transaction.fromHex(p.txHex);
    expect(tx.getId()).toBe(p.txid);
    expect(tx.ins).toHaveLength(1);
    expect(tx.ins[0].witness).toHaveLength(2);
    expect(tx.outs[0].value).toBe(20_000);
    expect(tx.outs[0].script.equals(addressToOutputScript(recipient, network))).toBe(true);
    expect(tx.outs[1].script.equals(addressToOutputScript(payerAddress, network))).toBe(true);
    expect(p.changeSat).toBe(100_000 - 20_000 - p.feeSat);
    // The estimate never undershoots the real size, so the paid rate is at least the asked rate.
    expect(p.feeSat / p.vsize).toBeGreaterThanOrEqual(2);
    expect(p.feeSat / p.vsize).toBeLessThan(2.1);
  });

  test('adds inputs in order until the amount and fee are covered', () => {
    const p = buildP2wpkhPayment({
      utxos: [utxo(1, 8_000), utxo(2, 8_000), utxo(3, 8_000), utxo(4, 50_000)],
      to: recipient, amountSat: 20_000, feeRate: 1, signer: payer, network,
    });
    expect(p.inputs.map((u) => u.vout)).toEqual([1, 2, 3]);
    expect(bitcoin.Transaction.fromHex(p.txHex).ins).toHaveLength(3);
  });

  test('drops dust change into the fee', () => {
    const p = buildP2wpkhPayment({ utxos: [utxo(1, 20_200)], to: recipient, amountSat: 20_000, feeRate: 1, signer: payer, network });
    expect(p.changeSat).toBe(0);
    expect(p.feeSat).toBe(200);
    expect(bitcoin.Transaction.fromHex(p.txHex).outs).toHaveLength(1);
    expect(P2WPKH_DUST_LIMIT_SAT).toBe(294);
  });

  test('throws InsufficientFundsError when the UTXOs cannot cover amount plus fee', () => {
    expect(() =>
      buildP2wpkhPayment({ utxos: [utxo(1, 20_050)], to: recipient, amountSat: 20_000, feeRate: 1, signer: payer, network }),
    ).toThrow(InsufficientFundsError);
  });

  test('pays a taproot (bech32m) recipient', () => {
    const tr = bitcoin.payments.p2tr({ internalPubkey: Buffer.from(payer.publicKey).subarray(1), network }).address!;
    expect(tr.startsWith('tb1p')).toBe(true);
    const p = buildP2wpkhPayment({ utxos: [utxo(1, 100_000)], to: tr, amountSat: 20_000, feeRate: 1, signer: payer, network });
    expect(bitcoin.Transaction.fromHex(p.txHex).outs[0].script).toHaveLength(34);
  });

  test('refuses a mainnet recipient on testnet/signet', () => {
    const main = pubkeyToP2WPKHAddress(Buffer.from(payer.publicKey), bitcoin.networks.bitcoin);
    expect(() =>
      buildP2wpkhPayment({ utxos: [utxo(1, 100_000)], to: main, amountSat: 20_000, feeRate: 1, signer: payer, network }),
    ).toThrow();
  });
});

describe('keyPairFromWif', () => {
  test('loads a testnet WIF and refuses a mainnet one', () => {
    const wif = payer.toWIF();
    expect(keyPairFromWif(wif, network).publicKey.equals(Buffer.from(payer.publicKey))).toBe(true);
    const mainWif = ECPair.fromPrivateKey(Buffer.alloc(32, 1), { network: bitcoin.networks.bitcoin }).toWIF();
    expect(() => keyPairFromWif(mainWif, network)).toThrow();
  });
});
