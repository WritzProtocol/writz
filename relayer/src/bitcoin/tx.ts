/**
 * Bitcoin transaction parsing - non-witness serialization extraction.
 *
 * Bitcoin uses double-SHA256 of the NON-WITNESS serialization to compute
 * the txid. SegWit transactions (P2WPKH, P2WSH, P2TR) carry a 2-byte
 * marker+flag and a witness section that must be stripped before hashing.
 *
 * Reference: BIP-141 § Serialization
 */

/**
 * Returns `buf.subarray(start, start + len)`, but throws instead of silently
 * truncating when the requested range extends past `buf.length` - the
 * default `Buffer.subarray` behavior on an out-of-range end index. Every
 * fixed- or computed-length read in this file must go through this (or
 * `readVarInt`, which self-checks) rather than a bare `subarray` call, or a
 * truncated/malformed transaction produces silently corrupted output instead
 * of a thrown error.
 */
function sliceExact(buf: Buffer, start: number, len: number, context: string): Buffer {
  const end = start + len;
  if (end > buf.length) {
    throw new RangeError(
      `${context}: need ${len} bytes at offset ${start}, but buffer is only ${buf.length} bytes`
    );
  }
  return buf.subarray(start, end);
}

/**
 * Converts a 64-bit satoshi value to `Number`, throwing if it would lose
 * precision (i.e. it exceeds `Number.MAX_SAFE_INTEGER`, ~9.2 × 10^15 sats -
 * far above Bitcoin's real 21M BTC supply cap, but not above what an
 * adversarial or corrupted input byte sequence could encode).
 */
function bigUInt64ToSafeNumber(value: bigint, context: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${context}: value ${value} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return Number(value);
}

/** Reads a Bitcoin variable-length integer from `buf` at `offset`. */
function readVarInt(buf: Buffer, offset: number): { value: number; size: number } {
  const first = buf[offset];
  if (first === undefined) throw new RangeError(`readVarInt: offset ${offset} out of range`);
  if (first < 0xfd) return { value: first, size: 1 };
  if (first === 0xfd) return { value: buf.readUInt16LE(offset + 1), size: 3 };
  if (first === 0xfe) return { value: buf.readUInt32LE(offset + 1), size: 5 };
  // 0xff: 8-byte int - safe to cap at Number.MAX_SAFE_INTEGER for tx counts
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
  out.push(...sliceExact(buf, 0, 4, "stripWitness: version"));
  i = 4;

  // Skip SegWit marker (0x00) and flag (0x01)
  i += 2;

  // Input count
  const { value: inputCount, size: inputCountLen } = readVarInt(buf, i);
  out.push(...sliceExact(buf, i, inputCountLen, "stripWitness: input count"));
  i += inputCountLen;

  // Inputs: prevout (36 bytes) + scriptSig (varint + bytes) + sequence (4 bytes)
  for (let k = 0; k < inputCount; k++) {
    out.push(...sliceExact(buf, i, 36, `stripWitness: input ${k} prevout`)); // prev_hash (32) + prev_index (4)
    i += 36;
    const { value: scriptLen, size: scriptLenSize } = readVarInt(buf, i);
    out.push(...sliceExact(buf, i, scriptLenSize + scriptLen, `stripWitness: input ${k} scriptSig`));
    i += scriptLenSize + scriptLen;
    out.push(...sliceExact(buf, i, 4, `stripWitness: input ${k} sequence`));
    i += 4;
  }

  // Output count
  const { value: outputCount, size: outputCountLen } = readVarInt(buf, i);
  out.push(...sliceExact(buf, i, outputCountLen, "stripWitness: output count"));
  i += outputCountLen;

  // Outputs: value (8 bytes) + scriptPubKey (varint + bytes)
  for (let k = 0; k < outputCount; k++) {
    out.push(...sliceExact(buf, i, 8, `stripWitness: output ${k} value`)); // value (satoshis, LE)
    i += 8;
    const { value: scriptLen, size: scriptLenSize } = readVarInt(buf, i);
    out.push(...sliceExact(buf, i, scriptLenSize + scriptLen, `stripWitness: output ${k} scriptPubKey`));
    i += scriptLenSize + scriptLen;
  }

  // Witness data - skip one stack per input
  for (let k = 0; k < inputCount; k++) {
    const { value: stackItems, size: stackItemsSize } = readVarInt(buf, i);
    i += stackItemsSize;
    for (let j = 0; j < stackItems; j++) {
      const { value: itemLen, size: itemLenSize } = readVarInt(buf, i);
      i += itemLenSize + itemLen;
    }
  }

  // Locktime (4 bytes)
  out.push(...sliceExact(buf, i, 4, "stripWitness: locktime"));

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
    const valueSat = bigUInt64ToSafeNumber(buf.readBigUInt64LE(i), `parseOutput: output ${k} value`);
    i += 8;
    const { value: scriptLen, size: scriptLenSize } = readVarInt(buf, i);
    const scriptPubKey = sliceExact(
      buf, i + scriptLenSize, scriptLen, `parseOutput: output ${k} scriptPubKey`
    ).toString("hex");
    i += scriptLenSize + scriptLen;
    if (k === outputIndex) return { valueSat, scriptPubKey };
  }

  throw new Error("unreachable");
}
