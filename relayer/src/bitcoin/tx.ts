/**
 * Bitcoin transaction parsing — non-witness serialization extraction.
 *
 * Bitcoin uses double-SHA256 of the NON-WITNESS serialization to compute
 * the txid. SegWit transactions (P2WPKH, P2WSH, P2TR) carry a 2-byte
 * marker+flag and a witness section that must be stripped before hashing.
 *
 * Reference: BIP-141 § Serialization
 */

/** Reads a Bitcoin variable-length integer from `buf` at `offset`. */
function readVarInt(buf: Buffer, offset: number): { value: number; size: number } {
  const first = buf[offset];
  if (first === undefined) throw new RangeError(`readVarInt: offset ${offset} out of range`);
  if (first < 0xfd) return { value: first, size: 1 };
  if (first === 0xfd) return { value: buf.readUInt16LE(offset + 1), size: 3 };
  if (first === 0xfe) return { value: buf.readUInt32LE(offset + 1), size: 5 };
  // 0xff: 8-byte int — safe to cap at Number.MAX_SAFE_INTEGER for tx counts
  const lo = buf.readUInt32LE(offset + 1);
  const hi = buf.readUInt32LE(offset + 5);
  if (hi > 0) throw new RangeError("varint exceeds Number.MAX_SAFE_INTEGER");
  return { value: lo, size: 9 };
}

/**
 * Returns `true` if the raw transaction bytes contain a SegWit marker.
 *
 * Per BIP-141: marker byte is 0x00 and flag byte is 0x01, located at
 * bytes 4 and 5 (after the 4-byte version field).
 */
export function isSegwit(rawHex: string): boolean {
  const buf = Buffer.from(rawHex, "hex");
  return buf.length > 6 && buf[4] === 0x00 && buf[5] === 0x01;
}

/**
 * Returns the non-witness serialization of a Bitcoin transaction.
 *
 * For legacy transactions (pre-SegWit), the input is returned unchanged.
 * For SegWit transactions, the 2-byte marker+flag and witness fields are
 * stripped, producing the serialization used to compute the txid.
 *
 * @param rawHex - Full transaction in hex (with or without witness data).
 * @returns Non-witness transaction hex.
 * @throws {RangeError} If the buffer is truncated or malformed.
 */
export function stripWitness(rawHex: string): string {
  if (!isSegwit(rawHex)) return rawHex;

  const buf = Buffer.from(rawHex, "hex");
  const out: number[] = [];
  let i = 0;

  // Version (4 bytes)
  out.push(...buf.subarray(0, 4));
  i = 4;

  // Skip SegWit marker (0x00) and flag (0x01)
  i += 2;

  // Input count
  const { value: inputCount, size: inputCountLen } = readVarInt(buf, i);
  out.push(...buf.subarray(i, i + inputCountLen));
  i += inputCountLen;

  // Inputs: prevout (36 bytes) + scriptSig (varint + bytes) + sequence (4 bytes)
  for (let k = 0; k < inputCount; k++) {
    out.push(...buf.subarray(i, i + 36)); // prev_hash (32) + prev_index (4)
    i += 36;
    const { value: scriptLen, size: scriptLenSize } = readVarInt(buf, i);
    out.push(...buf.subarray(i, i + scriptLenSize + scriptLen));
    i += scriptLenSize + scriptLen;
    out.push(...buf.subarray(i, i + 4)); // sequence
    i += 4;
  }

  // Output count
  const { value: outputCount, size: outputCountLen } = readVarInt(buf, i);
  out.push(...buf.subarray(i, i + outputCountLen));
  i += outputCountLen;

  // Outputs: value (8 bytes) + scriptPubKey (varint + bytes)
  for (let k = 0; k < outputCount; k++) {
    out.push(...buf.subarray(i, i + 8)); // value (satoshis, LE)
    i += 8;
    const { value: scriptLen, size: scriptLenSize } = readVarInt(buf, i);
    out.push(...buf.subarray(i, i + scriptLenSize + scriptLen));
    i += scriptLenSize + scriptLen;
  }

  // Witness data — skip one stack per input
  for (let k = 0; k < inputCount; k++) {
    const { value: stackItems, size: stackItemsSize } = readVarInt(buf, i);
    i += stackItemsSize;
    for (let j = 0; j < stackItems; j++) {
      const { value: itemLen, size: itemLenSize } = readVarInt(buf, i);
      i += itemLenSize + itemLen;
    }
  }

  // Locktime (4 bytes)
  if (i + 4 > buf.length) throw new RangeError("stripWitness: buffer truncated before locktime");
  out.push(...buf.subarray(i, i + 4));

  return Buffer.from(out).toString("hex");
}

/**
 * Parses the output at `outputIndex` from a raw transaction, returning
 * the value in satoshis and the scriptPubKey hex.
 *
 * Used by the frontend to confirm the deposit amount and P2WSH address.
 */
export function parseOutput(
  rawHex: string,
  outputIndex: number
): { valueSat: number; scriptPubKey: string } {
  const buf = Buffer.from(rawHex, "hex");
  let i = 0;

  // Skip version
  i += 4;

  // Skip SegWit marker+flag if present
  const segwit = buf[4] === 0x00 && buf[5] === 0x01;
  if (segwit) i += 2;

  // Skip inputs
  const { value: inputCount, size: inputCountLen } = readVarInt(buf, i);
  i += inputCountLen;
  for (let k = 0; k < inputCount; k++) {
    i += 36;
    const { value: scriptLen, size: scriptLenSize } = readVarInt(buf, i);
    i += scriptLenSize + scriptLen + 4;
  }

  // Parse outputs
  const { value: outputCount, size: outputCountLen } = readVarInt(buf, i);
  i += outputCountLen;
  if (outputIndex >= outputCount) {
    throw new RangeError(`outputIndex ${outputIndex} >= outputCount ${outputCount}`);
  }

  for (let k = 0; k <= outputIndex; k++) {
    const valueSat = Number(buf.readBigUInt64LE(i));
    i += 8;
    const { value: scriptLen, size: scriptLenSize } = readVarInt(buf, i);
    const scriptPubKey = buf.subarray(i + scriptLenSize, i + scriptLenSize + scriptLen).toString("hex");
    i += scriptLenSize + scriptLen;
    if (k === outputIndex) return { valueSat, scriptPubKey };
  }

  throw new Error("unreachable");
}
