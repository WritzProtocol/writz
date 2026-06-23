/**
 * Transaction building and finalization for the two spending paths.
 *
 * Path A — normal repayment (co-sign):
 *   Witness: [<user_sig>, <protocol_sig>, OP_1, <redeem_script>]
 *   OP_IF branch is taken. Requires both signatures.
 *
 * Path B — emergency recovery (timelock):
 *   Witness: [<user_sig>, OP_0, <redeem_script>]
 *   OP_ELSE branch is taken. Requires only the user signature, but the
 *   transaction's nLockTime must be >= the CLTV value in the script, and
 *   the input's nSequence must be <= 0xFFFFFFFE.
 *
 * Both paths use PSBT (BIP 174) to support the multi-party signing flow:
 *   1. Writz backend creates and partially signs the PSBT.
 *   2. User wallet signs the PSBT (via Xverse or any PSBT-compatible wallet).
 *   3. The signed PSBT is finalized and broadcast.
 */

import * as bitcoin from 'bitcoinjs-lib';
import type { PsbtInput } from 'bip174/src/lib/interfaces';

/** SIGHASH_ALL — the standard sighash type for Writz transactions. */
const SIGHASH_ALL = bitcoin.Transaction.SIGHASH_ALL;

/** Sequence value that enables nLockTime checking (any value < 0xFFFFFFFF). */
const SEQUENCE_LOCKTIME_ENABLED = 0xffff_fffe;

/** Parameters shared by both spending path builders. */
interface SpendParams {
  /** The UTXO being spent: txid in display (reversed) byte order, 64 hex chars. */
  txidHex: string;
  /** Output index within the funding transaction. */
  vout: number;
  /** Value of the UTXO in satoshis. */
  amountSat: number;
  /** P2WSH scriptPubKey (34 bytes): OP_0 <script-hash>. Returned by `deriveDepositAddress`. */
  scriptPubKey: Buffer;
  /** The full redeem script. Returned by `deriveDepositAddress`. */
  redeemScript: Buffer;
  /** Destination address (user's return address). */
  recipientAddress: string;
  /** Miner fee in satoshis. */
  feeSat: number;
  network: bitcoin.networks.Network;
}

// ── Path A: Normal repayment (co-sign) ──────────────────────────────────────

/**
 * Builds an unsigned PSBT for the co-signed release transaction (Path A).
 *
 * Both the Writz backend and the user must call `psbt.signInput(0, signer)`
 * before finalizing. The PSBT can be exchanged between parties as a
 * base64-encoded string (`psbt.toBase64()`).
 *
 * After both parties have signed, call `finalizePathA(psbt, ...)` to
 * assemble the correct witness and extract the broadcast-ready transaction.
 */
export function buildReleaseTransaction(params: SpendParams): bitcoin.Psbt {
  const psbt = new bitcoin.Psbt({ network: params.network });

  psbt.addInput({
    hash: params.txidHex,   // bitcoinjs-lib reverses hex strings automatically
    index: params.vout,
    witnessUtxo: {
      script: params.scriptPubKey,
      value: params.amountSat,
    },
    witnessScript: params.redeemScript,
    // No locktime needed for Path A — set nSequence to the default non-RBF value.
    sequence: 0xffff_fffe,
  });

  psbt.addOutput({
    address: params.recipientAddress,
    value: params.amountSat - params.feeSat,
  });

  return psbt;
}

/**
 * Finalizes the Path A PSBT after both parties have signed.
 *
 * Assembles the witness in the exact order the script expects:
 *   `[user_sig, protocol_sig, 0x01, redeem_script]`
 *
 * The `0x01` at position 2 is consumed by OP_IF, routing execution to the
 * co-sign branch.
 *
 * @param psbt            - PSBT with two partial signatures present.
 * @param inputIndex      - Index of the input to finalize (typically 0).
 * @param userPubkey      - 33-byte compressed public key of the user signer.
 * @param protocolPubkey  - 33-byte compressed public key of the Writz signer.
 */
export function finalizePathA(
  psbt: bitcoin.Psbt,
  inputIndex: number,
  userPubkey: Buffer,
  protocolPubkey: Buffer,
): void {
  psbt.finalizeInput(inputIndex, (_idx: number, input: PsbtInput) => ({
    finalScriptSig: undefined,
    ..._finalizeA(input, userPubkey, protocolPubkey),
  }));
}

function _finalizeA(
  input: PsbtInput,
  userPubkey: Buffer,
  protocolPubkey: Buffer,
): { finalScriptWitness: Buffer } {
  if (!input.partialSig?.length) throw new Error('no partial signatures on input');
  if (!input.witnessScript)      throw new Error('witnessScript not set on input');

  const userEntry     = input.partialSig.find((ps) => ps.pubkey.equals(userPubkey));
  const protocolEntry = input.partialSig.find((ps) => ps.pubkey.equals(protocolPubkey));

  if (!userEntry)     throw new Error('user signature not found in PSBT partialSig');
  if (!protocolEntry) throw new Error('protocol signature not found in PSBT partialSig');

  // Witness stack consumed by the script (top of stack = right-most element):
  //   user_sig ← consumed last by OP_CHECKSIG
  //   protocol_sig ← consumed first by OP_CHECKSIGVERIFY
  //   0x01 ← consumed by OP_IF → takes IF branch
  //   redeem_script ← P2WSH script revelation
  return {
    finalScriptWitness: serializeWitness([
      userEntry.signature,
      protocolEntry.signature,
      Buffer.from([0x01]),
      input.witnessScript,
    ]),
  };
}

// ── Path B: Emergency recovery (timelock) ────────────────────────────────────

/**
 * Builds an unsigned PSBT for the emergency timelock recovery (Path B).
 *
 * The transaction's nLockTime is set to `timelockHeight`, satisfying
 * OP_CHECKLOCKTIMEVERIFY. The input's nSequence is set to 0xFFFFFFFE so
 * that the locktime check is active (Bitcoin requires nSequence < 0xFFFFFFFF
 * for CLTV to be evaluated).
 *
 * Only the user needs to sign this transaction.
 */
export function buildEmergencyTransaction(
  params: SpendParams,
  timelockHeight: number,
): bitcoin.Psbt {
  const psbt = new bitcoin.Psbt({ network: params.network });

  // nLockTime must be >= timelockHeight for CLTV to pass.
  psbt.setLocktime(timelockHeight);

  psbt.addInput({
    hash: params.txidHex,
    index: params.vout,
    witnessUtxo: {
      script: params.scriptPubKey,
      value: params.amountSat,
    },
    witnessScript: params.redeemScript,
    // Must be < 0xFFFFFFFF to enable nLockTime checking on this input.
    sequence: SEQUENCE_LOCKTIME_ENABLED,
  });

  psbt.addOutput({
    address: params.recipientAddress,
    value: params.amountSat - params.feeSat,
  });

  return psbt;
}

/**
 * Finalizes the Path B PSBT after the user has signed.
 *
 * Assembles the witness in the exact order the script expects:
 *   `[user_sig, <empty>, redeem_script]`
 *
 * The empty buffer at position 1 is consumed by OP_IF as falsy, routing
 * execution to the OP_ELSE (timelock) branch.
 *
 * @param psbt       - PSBT with the user's partial signature present.
 * @param inputIndex - Index of the input to finalize (typically 0).
 * @param userPubkey - 33-byte compressed public key of the user signer.
 */
export function finalizePathB(
  psbt: bitcoin.Psbt,
  inputIndex: number,
  userPubkey: Buffer,
): void {
  psbt.finalizeInput(inputIndex, (_idx: number, input: PsbtInput) => ({
    finalScriptSig: undefined,
    ..._finalizeB(input, userPubkey),
  }));
}

function _finalizeB(
  input: PsbtInput,
  userPubkey: Buffer,
): { finalScriptWitness: Buffer } {
  if (!input.partialSig?.length) throw new Error('no partial signatures on input');
  if (!input.witnessScript)      throw new Error('witnessScript not set on input');

  const userEntry = input.partialSig.find((ps) => ps.pubkey.equals(userPubkey));
  if (!userEntry) throw new Error('user signature not found in PSBT partialSig');

  // Witness stack:
  //   user_sig ← consumed by OP_CHECKSIG
  //   <empty>  ← consumed by OP_IF as falsy → takes ELSE branch
  //   redeem_script ← P2WSH script revelation
  return {
    finalScriptWitness: serializeWitness([
      userEntry.signature,
      Buffer.alloc(0),        // falsy: takes OP_ELSE branch
      input.witnessScript,
    ]),
  };
}

// ── Witness serialization ────────────────────────────────────────────────────

/**
 * Serializes a witness stack into the compact format used in Bitcoin
 * transactions: varint(count) followed by varint(len)+data for each item.
 */
export function serializeWitness(items: Buffer[]): Buffer {
  const parts: Buffer[] = [encodeVarInt(items.length)];
  for (const item of items) {
    parts.push(encodeVarInt(item.length), item);
  }
  return Buffer.concat(parts);
}

/**
 * Deserializes a witness buffer back into a stack of Buffers.
 * Useful for extracting and inspecting witness items after finalization.
 */
export function deserializeWitness(buf: Buffer): Buffer[] {
  let offset = 0;

  const { value: count, size: countSize } = readVarInt(buf, offset);
  offset += countSize;

  const items: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const { value: len, size: lenSize } = readVarInt(buf, offset);
    offset += lenSize;
    items.push(buf.subarray(offset, offset + len));
    offset += len;
  }
  return items;
}

function encodeVarInt(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  const b = Buffer.allocUnsafe(3);
  b[0] = 0xfd;
  b.writeUInt16LE(n, 1);
  return b;
}

function readVarInt(buf: Buffer, offset: number): { value: number; size: number } {
  const first = buf[offset];
  if (first === undefined) throw new RangeError(`readVarInt: offset ${offset} out of range`);
  if (first < 0xfd) return { value: first, size: 1 };
  if (first === 0xfd) return { value: buf.readUInt16LE(offset + 1), size: 3 };
  throw new RangeError('varint > 0xFDFF not expected in witness data');
}
