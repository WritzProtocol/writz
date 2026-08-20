/**
 * Key management utilities for Writz Protocol.
 *
 * `generateKeyPair`/`keyPairFromPrivkey` are for tests and local development
 * only. Production co-signing prefers `KmsSigner` below, which never holds
 * the protocol private key in process memory. `resolveProtocolSigner` also
 * supports a raw-WIF environment-variable fallback for testnet/signet use
 * while KMS isn't set up - see that function's doc comment for why it's
 * refused on mainnet.
 */

import * as bitcoin from 'bitcoinjs-lib';
import type { Signer, SignerAsync } from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { ECPairFactory, ECPairInterface } from 'ecpair';
import {
  KMSClient,
  SignCommand,
  GetPublicKeyCommand,
} from '@aws-sdk/client-kms';

const ECPair = ECPairFactory(ecc);

/** A Bitcoin key pair with an explicit network binding. */
export interface WritzKeyPair {
  /** 33-byte compressed public key. */
  publicKey: Buffer;
  /** The underlying ECPair - implements the bitcoinjs-lib Signer interface. */
  signer: ECPairInterface;
  /** The network this key is bound to. */
  network: bitcoin.networks.Network;
}

/**
 * Generates a fresh random key pair for the given network.
 * For tests and local development only - never log the private key in production.
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

// ── KMS-backed protocol signer ───────────────────────────────────────────────

/** secp256k1 curve order. Signatures with s > n/2 must be normalized to
 * n - s (BIP-62 low-S rule) - AWS KMS does not guarantee this. */
const SECP256K1_N = BigInt(
  '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141',
);
const SECP256K1_N_HALF = SECP256K1_N / 2n;

/**
 * A bitcoinjs-lib `SignerAsync` backed by an AWS KMS asymmetric key
 * (`ECC_SECG_P256K1` curve, `ECDSA_SHA_256` algorithm - the same curve
 * Bitcoin uses). The private key material never leaves KMS; every signature
 * is an authenticated `kms:Sign` API call, audit-logged via CloudTrail.
 *
 * Use with `psbt.signInputAsync(index, kmsSigner)` (not the sync
 * `signInput`, since every signature requires a network round-trip).
 *
 * This is the signer shared by the interactive `/api/cosign` route and the
 * automated repayment watcher - both call sites hold the same custody
 * guarantee.
 */
export class KmsSigner implements SignerAsync {
  publicKey: Buffer;
  network?: bitcoin.networks.Network;

  private readonly client: KMSClient;
  private readonly keyId: string;

  private constructor(
    keyId: string,
    publicKey: Buffer,
    client: KMSClient,
    network?: bitcoin.networks.Network,
  ) {
    this.keyId = keyId;
    this.publicKey = publicKey;
    this.client = client;
    this.network = network;
  }

  /**
   * Fetches the key's public key from KMS and constructs a signer.
   * `client` is injectable for tests (pass a mocked `KMSClient`).
   */
  static async create(
    keyId: string,
    network?: bitcoin.networks.Network,
    client: KMSClient = new KMSClient({}),
  ): Promise<KmsSigner> {
    const res = await client.send(new GetPublicKeyCommand({ KeyId: keyId }));
    if (!res.PublicKey) {
      throw new Error(`KMS key ${keyId} returned no public key`);
    }
    const compressed = spkiToCompressedPubkey(Buffer.from(res.PublicKey));
    return new KmsSigner(keyId, compressed, client, network);
  }

  async sign(hash: Buffer): Promise<Buffer> {
    const res = await this.client.send(
      new SignCommand({
        KeyId: this.keyId,
        Message: hash,
        MessageType: 'DIGEST',
        SigningAlgorithm: 'ECDSA_SHA_256',
      }),
    );
    if (!res.Signature) {
      throw new Error('KMS Sign returned no signature');
    }
    return derEcdsaSignatureToCompactLowS(Buffer.from(res.Signature));
  }
}

// ── Protocol signer resolution (KMS, with a testnet/signet fallback) ────────

/** Whatever `resolveProtocolSigner` returns - either a `KmsSigner`
 * (`SignerAsync`) or a raw-WIF `ECPairInterface` (`Signer`, sync). Both
 * satisfy `psbt.signInputAsync`, so call sites don't need to distinguish. */
export type ProtocolSigner = Signer | SignerAsync;

export interface ProtocolSignerOptions {
  /** AWS KMS key ID or alias. Preferred whenever set. */
  kmsKeyId?: string;
  /** WIF-encoded private key (e.g. from a `PROTOCOL_SIGNING_KEY` env var).
   * Fallback only - see this function's doc comment for why it's rejected
   * on mainnet. */
  envPrivateKeyWif?: string;
  network: bitcoin.networks.Network;
  /** Injectable KMS client, for tests. */
  kmsClient?: KMSClient;
}

/**
 * Resolves the protocol's Bitcoin co-signing key: AWS KMS if configured,
 * otherwise a WIF-encoded key read from the environment.
 *
 * The raw-WIF fallback exists to unblock testnet/signet operation while AWS
 * KMS account setup is in progress or unavailable - it is the same custody
 * model Writz used before migrating to KMS, and reintroduces the same risk
 * that migration closed (a compromised host/environment leaks the key
 * outright, with no HSM boundary). It is refused unconditionally on
 * `bitcoin.networks.bitcoin` (mainnet): a misconfigured or copy-pasted
 * mainnet deployment must fail loudly at startup rather than silently
 * downgrade custody. See `docs/security/security-model.md`.
 *
 * `kmsKeyId` takes priority over `envPrivateKeyWif` when both are set.
 */
export async function resolveProtocolSigner(
  opts: ProtocolSignerOptions,
): Promise<ProtocolSigner> {
  if (opts.kmsKeyId) {
    return KmsSigner.create(opts.kmsKeyId, opts.network, opts.kmsClient);
  }

  if (opts.envPrivateKeyWif) {
    if (opts.network === bitcoin.networks.bitcoin) {
      throw new Error(
        'Refusing to use the raw-WIF protocol signer fallback on mainnet. ' +
          'Configure KMS_KEY_ID instead - see docs/security/security-model.md.',
      );
    }
    return ECPair.fromWIF(opts.envPrivateKeyWif, opts.network);
  }

  throw new Error(
    'No protocol signer configured: set KMS_KEY_ID (preferred), or ' +
      'PROTOCOL_SIGNING_KEY as a testnet/signet-only fallback.',
  );
}

/**
 * Extracts a compressed secp256k1 public key from the DER
 * SubjectPublicKeyInfo structure KMS's `GetPublicKey` returns.
 *
 * Rather than a full ASN.1 parser, this exploits a fixed structural fact:
 * the BIT STRING payload - an uncompressed SEC1 point
 * (`0x04 || X(32) || Y(32)`, 65 bytes) - is always the final component of
 * an EC SubjectPublicKeyInfo, so it's simply the last 65 bytes of the DER
 * blob. Validated by checking the point actually starts with `0x04`.
 */
function spkiToCompressedPubkey(spki: Buffer): Buffer {
  const point = spki.subarray(spki.length - 65);
  if (point.length !== 65 || point[0] !== 0x04) {
    throw new Error(
      'unexpected KMS public key encoding - expected an uncompressed secp256k1 point',
    );
  }
  const x = point.subarray(1, 33);
  const y = point.subarray(33, 65);
  const prefix = (y[y.length - 1]! & 1) === 0 ? 0x02 : 0x03;
  return Buffer.concat([Buffer.from([prefix]), x]);
}

/**
 * Converts a DER-encoded `ECDSA-Sig-Value ::= SEQUENCE { r INTEGER, s
 * INTEGER }` (what KMS's `Sign` API returns for `ECDSA_SHA_256`) into the
 * 64-byte compact `r(32) || s(32)` format bitcoinjs-lib's `Signer.sign()`
 * contract expects (matching `ecpair`'s return shape), with `s` normalized
 * to the low-S form Bitcoin policy requires.
 *
 * The outer SEQUENCE and both INTEGER length fields are always short-form
 * (single length byte, no 0x80 continuation) for a secp256k1 ECDSA
 * signature - the total DER encoding is at most ~72 bytes, far under the
 * 128-byte threshold where DER's long-form length encoding would apply.
 */
function derEcdsaSignatureToCompactLowS(der: Buffer): Buffer {
  if (der[0] !== 0x30) {
    throw new Error('KMS signature is not a DER SEQUENCE');
  }

  function readInteger(buf: Buffer, offset: number): { value: Buffer; next: number } {
    if (buf[offset] !== 0x02) {
      throw new Error('KMS signature: expected a DER INTEGER');
    }
    const len = buf[offset + 1]!;
    const start = offset + 2;
    let value = buf.subarray(start, start + len);
    // Strip a leading 0x00 padding byte (DER pads an integer whose high bit
    // is set, so it isn't misread as negative).
    if (value.length > 32 && value[0] === 0x00) value = value.subarray(1);
    return { value, next: start + len };
  }

  const r = readInteger(der, 2);
  const s = readInteger(der, r.next);

  let sBig = BigInt('0x' + s.value.toString('hex'));
  if (sBig > SECP256K1_N_HALF) sBig = SECP256K1_N - sBig;

  return Buffer.concat([
    leftPad32(r.value),
    leftPad32(Buffer.from(sBig.toString(16).padStart(64, '0'), 'hex')),
  ]);
}

function leftPad32(buf: Buffer): Buffer {
  if (buf.length === 32) return buf;
  if (buf.length > 32) throw new Error('integer too large for a 32-byte field');
  return Buffer.concat([Buffer.alloc(32 - buf.length, 0), buf]);
}
