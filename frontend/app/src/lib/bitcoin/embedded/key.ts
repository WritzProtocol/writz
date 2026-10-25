import { Buffer } from "buffer";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import { sha256 } from "@noble/hashes/sha2.js";
import { signedMessageFrame } from "../keyProof";

/**
 * The Signet test key: a random secp256k1 key generated in this browser for
 * a social-login account, kept only in this browser's storage, never sent to
 * Writz, Pollar or the relayer. It exists so someone with no Bitcoin wallet
 * can try the whole loop, and only on testnet with Bitcoin Signet, whose
 * coins have no value. Anything in the page can read it, which is acceptable
 * for worthless test coins and is why it never exists on mainnet.
 */

bitcoin.initEccLib(ecc);

/** Signet addresses use the testnet prefix (tb1). */
const NETWORK = bitcoin.networks.testnet;
const KEY_PREFIX = "writz:signet-key:";
const FILE_FORMAT = "writz-signet-test-key";

/** Where the key may exist: never on the mainnet target, and only when the Bitcoin side is Signet. */
export function embeddedSignetAllowed(target: string, btcNetwork: string): boolean {
  return target !== "mainnet" && btcNetwork === "signet";
}

export class EmbeddedKeyRefused extends Error {
  constructor() {
    super("The Signet test key only exists on Writz testnet with Bitcoin signet.");
    this.name = "EmbeddedKeyRefused";
  }
}

/** Throws unless the test key is allowed for this build (`embeddedSignetAllowed`). */
export function assertEmbeddedAllowed(target: string, btcNetwork: string): void {
  if (!embeddedSignetAllowed(target, btcNetwork)) throw new EmbeddedKeyRefused();
}

export interface KeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SignetKey {
  privkey: Buffer;
  /** 33-byte compressed public key. */
  pubkey: Buffer;
  /** Native SegWit (P2WPKH) Signet address, tb1q... */
  address: string;
  createdAt: number;
}

interface StoredKey {
  v: 1;
  network: "signet";
  privkey: string;
  createdAt: number;
}

/** The storage entry of an account's key: one per Pollar account. */
export function storageKeyFor(accountId: string): string {
  if (!accountId) throw new Error("A Signet test key needs an account to belong to.");
  return `${KEY_PREFIX}${accountId}`;
}

export function keyFromPrivkey(privkey: Uint8Array, createdAt = Date.now()): SignetKey {
  const priv = Buffer.from(privkey);
  if (priv.length !== 32 || !ecc.isPrivate(priv)) throw new Error("That is not a valid private key.");
  const pubkey = Buffer.from(ecc.pointFromScalar(priv, true)!);
  const { address } = bitcoin.payments.p2wpkh({ pubkey, network: NETWORK });
  return { privkey: priv, pubkey, address: address!, createdAt };
}

/** 32 random bytes that make a valid key, from the browser's CSPRNG. */
export function generatePrivkey(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): Buffer {
  for (let i = 0; i < 16; i++) {
    const candidate = Buffer.from(random(32));
    if (ecc.isPrivate(candidate)) return candidate;
  }
  throw new Error("Could not generate a key.");
}

/** The account's key from storage, or null when there is none or it is unreadable. */
export function loadKey(storage: KeyStorage, accountId: string): SignetKey | null {
  const raw = storage.getItem(storageKeyFor(accountId));
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as StoredKey;
    if (stored.v !== 1 || stored.network !== "signet" || !/^[0-9a-f]{64}$/.test(stored.privkey)) return null;
    return keyFromPrivkey(Buffer.from(stored.privkey, "hex"), stored.createdAt);
  } catch {
    return null;
  }
}

function storeKey(storage: KeyStorage, accountId: string, key: SignetKey): void {
  const stored: StoredKey = { v: 1, network: "signet", privkey: key.privkey.toString("hex"), createdAt: key.createdAt };
  storage.setItem(storageKeyFor(accountId), JSON.stringify(stored));
}

/** The account's key, generated and stored on first use. */
export function loadOrCreateKey(
  storage: KeyStorage,
  accountId: string,
  opts: { now?: number; random?: (n: number) => Uint8Array } = {},
): { key: SignetKey; created: boolean } {
  const existing = loadKey(storage, accountId);
  if (existing) return { key: existing, created: false };
  const key = keyFromPrivkey(generatePrivkey(opts.random), opts.now ?? Date.now());
  storeKey(storage, accountId, key);
  // Read back: a storage that silently drops writes (some private modes) must not hand out a key it will forget.
  const saved = loadKey(storage, accountId);
  if (!saved || saved.address !== key.address) throw new Error("This browser did not keep the test key. Storage may be blocked.");
  return { key, created: true };
}

// ── WIF (testnet version byte, compressed) ──────────────────────────────

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58check(payload: Buffer): string {
  const data = Buffer.concat([payload, Buffer.from(sha256(sha256(payload))).subarray(0, 4)]);
  let n = BigInt(`0x${data.toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of data) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

function unbase58check(text: string): Buffer {
  let n = 0n;
  for (const c of text) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("Not a key file or WIF.");
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const lead = /^1*/.exec(text)![0].length;
  const data = Buffer.concat([Buffer.alloc(lead), Buffer.from(hex, "hex")]);
  const payload = data.subarray(0, -4);
  const check = Buffer.from(sha256(sha256(payload))).subarray(0, 4);
  if (!check.equals(data.subarray(-4))) throw new Error("That key has a typo: its checksum does not match.");
  return payload;
}

/** Testnet WIF (cN.../cT...), which Signet wallets such as Sparrow or Bitcoin Core import. */
export function toWif(privkey: Buffer): string {
  return base58check(Buffer.concat([Buffer.from([0xef]), privkey, Buffer.from([0x01])]));
}

export function fromWif(wif: string): Buffer {
  const payload = unbase58check(wif.trim());
  if (payload[0] === 0x80) throw new Error("That is a mainnet key. Only Signet test keys can be imported.");
  if (payload[0] !== 0xef || payload.length !== 34 || payload[33] !== 0x01) {
    throw new Error("That is not a compressed testnet or Signet key.");
  }
  return payload.subarray(1, 33);
}

// ── Export and import ───────────────────────────────────────────────────

/** The backup file: the key as a Signet WIF, its address, and what it is for. */
export function exportKeyFile(key: SignetKey): string {
  return `${JSON.stringify(
    {
      format: FILE_FORMAT,
      version: 1,
      network: "signet",
      note: "Signet test key, worthless coins. For testing Writz on testnet only. Anyone with this file can spend its Signet coins.",
      address: key.address,
      wif: toWif(key.privkey),
      createdAt: new Date(key.createdAt).toISOString(),
    },
    null,
    2,
  )}\n`;
}

/** Reads a backup file, or a bare Signet WIF, into a key. Refuses mainnet keys. */
export function parseKeyFile(text: string): SignetKey {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("The file is empty.");
  if (trimmed.startsWith("{")) {
    let file: { format?: unknown; network?: unknown; wif?: unknown; address?: unknown; createdAt?: unknown };
    try {
      file = JSON.parse(trimmed);
    } catch {
      throw new Error("That file is not a Writz test key.");
    }
    if (file.format !== FILE_FORMAT || file.network !== "signet" || typeof file.wif !== "string") {
      throw new Error("That file is not a Writz Signet test key.");
    }
    const created = typeof file.createdAt === "string" ? Date.parse(file.createdAt) : NaN;
    const key = keyFromPrivkey(fromWif(file.wif), Number.isFinite(created) ? created : Date.now());
    if (typeof file.address === "string" && file.address !== key.address) {
      throw new Error("The key and the address in that file do not match.");
    }
    return key;
  }
  return keyFromPrivkey(fromWif(trimmed));
}

/** Replaces the account's key with the one in `text`. */
export function importKey(storage: KeyStorage, accountId: string, text: string): SignetKey {
  const key = parseKeyFile(text);
  storeKey(storage, accountId, key);
  return key;
}

// ── Signing ─────────────────────────────────────────────────────────────

const signer = (key: SignetKey): bitcoin.Signer => ({
  publicKey: key.pubkey,
  sign: (hash: Buffer) => Buffer.from(ecc.sign(hash, key.privkey)),
});

/**
 * A BIP-137 signed message (base64, 65 bytes) with the P2WPKH header
 * (39 + recovery id), what `parseMessageSignature`, the relayer faucet and
 * the writz-lend deposit key proof accept.
 */
export function signBitcoinMessage(message: string, key: SignetKey): string {
  const hash = Buffer.from(sha256(sha256(signedMessageFrame(message))));
  const { signature, recoveryId } = ecc.signRecoverable(hash, key.privkey);
  return Buffer.concat([Buffer.from([39 + recoveryId]), Buffer.from(signature)]).toString("base64");
}

/**
 * Signs input 0 of a release PSBT (the Writz P2WSH lock) with SIGHASH_ALL,
 * without finalizing or broadcasting: the same contract as the extension
 * wallet's signPsbt, so the release flow merges and checks it unchanged.
 */
export function signReleasePsbt(psbtBase64: string, key: SignetKey): string {
  const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network: NETWORK });
  const input = psbt.data.inputs[0];
  if (!input?.witnessScript || !input.witnessUtxo) throw new Error("The release is missing its lock script.");
  if (!input.witnessScript.includes(key.pubkey)) throw new Error("This release is for a different Bitcoin key.");
  psbt.signInput(0, signer(key), [bitcoin.Transaction.SIGHASH_ALL]);
  return psbt.toBase64();
}

// ── Payments ────────────────────────────────────────────────────────────

export interface Utxo {
  txid: string;
  vout: number;
  value: number;
}

/** Below this a P2WPKH change output is dust; it goes to the fee instead. */
const DUST_SATS = 294;
const OUTPUT_VBYTES: Record<string, number> = { p2wpkh: 31, p2wsh: 43, p2tr: 43 };

function outputVbytes(script: Buffer): number {
  if (script.length === 22) return OUTPUT_VBYTES.p2wpkh;
  if (script.length === 34) return OUTPUT_VBYTES.p2wsh;
  return 34;
}

/** Virtual size of a P2WPKH spend: 10.5 vB overhead and about 68 vB per input. */
export function paymentVsize(inputs: number, outputScripts: Buffer[]): number {
  return Math.ceil(10.5 + 68 * inputs + outputScripts.reduce((s, o) => s + outputVbytes(o), 0));
}

export class NotEnoughBitcoin extends Error {
  constructor(
    readonly availableSats: number,
    readonly neededSats: number,
  ) {
    super(`Not enough test BTC: ${availableSats} sats available, ${neededSats} needed with the fee.`);
    this.name = "NotEnoughBitcoin";
  }
}

/**
 * Builds and signs a payment of `amountSats` to `to` from the key's own
 * P2WPKH coins, largest first, with change back to the same address.
 */
export function buildPayment(params: {
  key: SignetKey;
  utxos: Utxo[];
  to: string;
  amountSats: number;
  feeRate: number;
}): { txHex: string; txid: string; feeSats: number; changeSats: number } {
  const { key, to, amountSats } = params;
  if (!Number.isSafeInteger(amountSats) || amountSats <= DUST_SATS) throw new Error("The amount is too small to send.");
  const feeRate = Math.max(1, params.feeRate);
  const toScript = bitcoin.address.toOutputScript(to, NETWORK);
  const own = bitcoin.payments.p2wpkh({ pubkey: key.pubkey, network: NETWORK }).output!;
  const sorted = [...params.utxos].sort((a, b) => b.value - a.value);

  const chosen: Utxo[] = [];
  let total = 0;
  for (const u of sorted) {
    chosen.push(u);
    total += u.value;
    const withChange = Math.ceil(paymentVsize(chosen.length, [toScript, own]) * feeRate);
    if (total >= amountSats + withChange) break;
  }
  const feeWithChange = Math.ceil(paymentVsize(chosen.length, [toScript, own]) * feeRate);
  const feeNoChange = Math.ceil(paymentVsize(chosen.length, [toScript]) * feeRate);
  if (total < amountSats + feeNoChange) throw new NotEnoughBitcoin(total, amountSats + feeNoChange);

  let changeSats = total - amountSats - feeWithChange;
  if (changeSats < DUST_SATS) changeSats = 0;
  const feeSats = total - amountSats - changeSats;

  const psbt = new bitcoin.Psbt({ network: NETWORK });
  for (const u of chosen) {
    psbt.addInput({ hash: u.txid, index: u.vout, witnessUtxo: { script: own, value: u.value } });
  }
  psbt.addOutput({ script: toScript, value: amountSats });
  if (changeSats > 0) psbt.addOutput({ script: own, value: changeSats });
  psbt.signAllInputs(signer(key));
  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();
  return { txHex: tx.toHex(), txid: tx.getId(), feeSats, changeSats };
}
