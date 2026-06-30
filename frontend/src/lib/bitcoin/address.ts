import * as bitcoin from "bitcoinjs-lib";
import type { PsbtInput } from "bip174/src/lib/interfaces";
import * as ecc from "@bitcoinerlab/secp256k1";

bitcoin.initEccLib(ecc);

export function getBitcoinNetwork(): bitcoin.networks.Network {
  return process.env.NEXT_PUBLIC_BITCOIN_NETWORK === "mainnet"
    ? bitcoin.networks.bitcoin
    : bitcoin.networks.testnet;
}

/**
 * Builds the Writz P2WSH redeem script.
 *
 * Canonical implementation lives in bitcoin-script/src/script.ts.
 * Both MUST produce identical output for the same inputs — any change here
 * must be mirrored there and vice versa.
 *
 *   OP_IF   <protocol_pubkey> OP_CHECKSIGVERIFY <user_pubkey> OP_CHECKSIG
 *   OP_ELSE <timelock> OP_CHECKLOCKTIMEVERIFY OP_DROP <user_pubkey> OP_CHECKSIG
 *   OP_ENDIF
 */
function buildRedeemScript(
  protocolPubkey: Buffer,
  userPubkey: Buffer,
  timelockHeight: number,
): Buffer {
  if (protocolPubkey.length !== 33) {
    throw new Error("protocolPubkey must be a 33-byte compressed public key");
  }
  if (userPubkey.length !== 33) {
    throw new Error("userPubkey must be a 33-byte compressed public key");
  }
  if (timelockHeight < 100_000) {
    throw new Error(`timelockHeight must be ≥ 100,000 (got ${timelockHeight})`);
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

export interface P2WSHAddress {
  address: string;
  scriptPubKey: Buffer;
  redeemScript: Buffer;
}

/**
 * Derives the unique P2WSH deposit address for this user + protocol + timelock.
 * Deterministic: same inputs always produce the same address.
 */
export function deriveP2WSH(
  protocolPubkeyHex: string,
  userPubkeyHex: string,
  timelockHeight: number,
): P2WSHAddress {
  const network = getBitcoinNetwork();
  const protocolPubkey = Buffer.from(protocolPubkeyHex, "hex");
  const userPubkey = Buffer.from(userPubkeyHex, "hex");

  const redeemScript = buildRedeemScript(protocolPubkey, userPubkey, timelockHeight);
  const payment = bitcoin.payments.p2wsh({
    redeem: { output: redeemScript, network },
    network,
  });

  if (!payment.address || !payment.output) {
    throw new Error("Failed to derive P2WSH address");
  }

  return {
    address: payment.address,
    scriptPubKey: payment.output,
    redeemScript,
  };
}

/**
 * Builds a PSBT for the Path A release transaction (co-signed by protocol + user).
 * The PSBT is unsigned — both parties sign before finalization.
 */
export function buildReleasePsbt(params: {
  txidHex: string;
  vout: number;
  amountSat: number;
  scriptPubKey: Buffer;
  redeemScript: Buffer;
  recipientAddress: string;
  feeSat: number;
}): bitcoin.Psbt {
  const network = getBitcoinNetwork();
  const psbt = new bitcoin.Psbt({ network });

  psbt.addInput({
    hash: params.txidHex,
    index: params.vout,
    witnessUtxo: { script: params.scriptPubKey, value: params.amountSat },
    witnessScript: params.redeemScript,
    sequence: 0xffff_fffe,
  });

  psbt.addOutput({
    address: params.recipientAddress,
    value: params.amountSat - params.feeSat,
  });

  return psbt;
}

/**
 * Finalizes a Path A PSBT after both the user (via Xverse) and the protocol
 * (via /api/cosign) have signed. Returns the hex-encoded broadcast-ready tx.
 */
export function finalizePathA(
  protocolSignedPsbtBase64: string,
  userSignedPsbtBase64: string,
  protocolPubkeyHex: string,
  userPubkeyHex: string,
): string {
  const network = getBitcoinNetwork();
  const userPsbt = bitcoin.Psbt.fromBase64(userSignedPsbtBase64, { network });

  // Merge partial signatures from both PSBTs into one.
  const merged = bitcoin.Psbt.fromBase64(protocolSignedPsbtBase64, { network });
  const userSigs = userPsbt.data.inputs[0]?.partialSig ?? [];
  for (const sig of userSigs) {
    merged.data.inputs[0]!.partialSig ??= [];
    merged.data.inputs[0]!.partialSig.push(sig);
  }

  const protocolPubkey = Buffer.from(protocolPubkeyHex, "hex");
  const userPubkey = Buffer.from(userPubkeyHex, "hex");

  merged.finalizeInput(0, (_idx: number, input: PsbtInput) => {
    const protocolEntry = input.partialSig?.find((ps) =>
      ps.pubkey.equals(protocolPubkey),
    );
    const userEntry = input.partialSig?.find((ps) =>
      ps.pubkey.equals(userPubkey),
    );
    if (!protocolEntry) throw new Error("Protocol signature not found");
    if (!userEntry) throw new Error("User signature not found");
    if (!input.witnessScript) throw new Error("witnessScript not set");

    return {
      finalScriptSig: undefined,
      finalScriptWitness: serializeWitness([
        userEntry.signature,
        protocolEntry.signature,
        Buffer.from([0x01]),
        input.witnessScript,
      ]),
    };
  });

  return merged.extractTransaction().toHex();
}

function serializeWitness(items: Buffer[]): Buffer {
  const parts: Buffer[] = [encodeVarInt(items.length)];
  for (const item of items) {
    parts.push(encodeVarInt(item.length), item);
  }
  return Buffer.concat(parts);
}

function encodeVarInt(n: number): Buffer {
  if (n < 0) throw new RangeError(`witness item length must be non-negative, got ${n}`);
  if (n < 0xfd) return Buffer.from([n]);
  if (n > 0xffff) throw new RangeError(`witness item too large: ${n} bytes (max 65535)`);
  const b = Buffer.allocUnsafe(3);
  b[0] = 0xfd;
  b.writeUInt16LE(n, 1);
  return b;
}

/**
 * Estimates the miner fee for a Path A cooperative release transaction.
 *
 * Queries the Esplora fee-estimates endpoint for the sat/vbyte rate at the
 * requested confirmation target and multiplies by the fixed P2WSH Path A
 * transaction size (~150 vbytes). Falls back to `fallbackSatPerVbyte` if the
 * API is unreachable.
 */
export async function estimateReleaseFee(
  apiUrl: string,
  confirmationTarget = 3,
  fallbackSatPerVbyte = 10,
): Promise<number> {
  // P2WSH cooperative release: 1 input + 1 P2WPKH output ≈ 150 vbytes
  const TX_VBYTES = 150;
  try {
    const res = await fetch(`${apiUrl}/fee-estimates`);
    if (res.ok) {
      const estimates = (await res.json()) as Record<string, number>;
      const rate = estimates[String(confirmationTarget)] ?? estimates["6"] ?? fallbackSatPerVbyte;
      return Math.max(Math.ceil(rate * TX_VBYTES), 1000); // floor at 1000 sats (dust guard)
    }
  } catch {
    // network error — use fallback
  }
  return fallbackSatPerVbyte * TX_VBYTES;
}

/**
 * Finds the output index (vout) in a Bitcoin transaction that pays to the given
 * address, by polling the Esplora API until the transaction is indexed.
 */
export async function resolveVout(
  txid: string,
  address: string,
  apiUrl: string,
  maxAttempts = 12,
  intervalMs = 5_000,
): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${apiUrl}/tx/${txid}`);
      if (res.ok) {
        const tx = (await res.json()) as { vout: Array<{ scriptpubkey_address?: string }> };
        const idx = tx.vout.findIndex((o) => o.scriptpubkey_address === address);
        if (idx !== -1) return idx;
      }
    } catch {
      // network error — retry
    }
    if (i < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw new Error(
    `Could not locate output paying ${address} in tx ${txid} after ${maxAttempts} attempts. ` +
    `Check that the transaction was broadcast and the Esplora API (${apiUrl}) is reachable.`,
  );
}
