/**
 * KmsSigner tests - exercised against a mocked KMS client, so
 * no AWS credentials or network access are needed. Validates:
 *   - public key extraction from KMS's DER SubjectPublicKeyInfo response
 *   - DER-to-compact signature conversion produces a signature that
 *     verifies against the real digest and public key
 *   - low-S normalization actually flips a high-S KMS response
 */

import * as ecc from '@bitcoinerlab/secp256k1';
import { ECPairFactory } from 'ecpair';
import { GetPublicKeyCommand, SignCommand, type KMSClient } from '@aws-sdk/client-kms';
import { KmsSigner, generateKeyPair, resolveProtocolSigner } from '../src/keys.js';
import * as bitcoin from 'bitcoinjs-lib';

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet;

const SECP256K1_N = BigInt(
  '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141',
);

// ── DER helpers (test-only - mirror what a real KMS response looks like) ────

/** DER-encodes an unsigned big-endian integer per ASN.1 INTEGER rules. */
function derInteger(value: Buffer): Buffer {
  let v = value;
  // Strip leading zero bytes, but keep at least one byte.
  while (v.length > 1 && v[0] === 0x00) v = v.subarray(1);
  // Prepend a 0x00 pad byte if the high bit is set (so it isn't read as negative).
  if (v[0]! & 0x80) v = Buffer.concat([Buffer.from([0x00]), v]);
  return Buffer.concat([Buffer.from([0x02, v.length]), v]);
}

/** Encodes a 64-byte compact (r||s) signature as a DER ECDSA-Sig-Value,
 * matching the format AWS KMS's `Sign` API returns. */
function compactToDer(compact: Buffer): Buffer {
  const r = derInteger(compact.subarray(0, 32));
  const s = derInteger(compact.subarray(32, 64));
  const content = Buffer.concat([r, s]);
  return Buffer.concat([Buffer.from([0x30, content.length]), content]);
}

/** Builds a DER SubjectPublicKeyInfo wrapping an uncompressed secp256k1
 * point, matching what KMS's `GetPublicKey` returns for an
 * ECC_SECG_P256K1 key. */
function buildSpki(uncompressedPubkey: Buffer): Buffer {
  const idEcPublicKey = Buffer.from('06072a8648ce3d0201', 'hex');
  const secp256k1Oid = Buffer.from('06052b8104000a', 'hex');
  const algId = Buffer.concat([
    Buffer.from([0x30, idEcPublicKey.length + secp256k1Oid.length]),
    idEcPublicKey,
    secp256k1Oid,
  ]);
  const bitStringContent = Buffer.concat([Buffer.from([0x00]), uncompressedPubkey]);
  const bitString = Buffer.concat([
    Buffer.from([0x03, bitStringContent.length]),
    bitStringContent,
  ]);
  const content = Buffer.concat([algId, bitString]);
  return Buffer.concat([Buffer.from([0x30, content.length]), content]);
}

function uncompressedPubkeyOf(compressedPubkey: Buffer): Buffer {
  return Buffer.from(ecc.pointCompress(compressedPubkey, false));
}

/** A fake KMSClient - routes GetPublicKeyCommand/SignCommand to canned
 * responses without any network access. */
function makeMockKmsClient(opts: {
  privateKey: Buffer;
  compressedPubkey: Buffer;
  /** If set, the mock returns this exact DER signature instead of signing for real. */
  forceDerSignature?: (hash: Buffer) => Buffer;
}) {
  const uncompressed = uncompressedPubkeyOf(opts.compressedPubkey);
  return {
    send: async (command: unknown) => {
      if (command instanceof GetPublicKeyCommand) {
        return { PublicKey: buildSpki(uncompressed) };
      }
      if (command instanceof SignCommand) {
        const hash = Buffer.from(command.input.Message as Uint8Array);
        if (opts.forceDerSignature) {
          return { Signature: opts.forceDerSignature(hash) };
        }
        const compact = Buffer.from(ecc.sign(hash, opts.privateKey));
        return { Signature: compactToDer(compact) };
      }
      throw new Error(`unexpected KMS command: ${(command as object)?.constructor?.name}`);
    },
  } as unknown as KMSClient;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('KmsSigner.create', () => {
  test('extracts the correct compressed public key from a mocked GetPublicKeyCommand', async () => {
    const keypair = generateKeyPair(network);
    const client = makeMockKmsClient({
      privateKey: keypair.signer.privateKey!,
      compressedPubkey: keypair.publicKey,
    });

    const signer = await KmsSigner.create('alias/writz-protocol-key', network, client);
    expect(signer.publicKey.equals(keypair.publicKey)).toBe(true);
    expect(signer.publicKey.length).toBe(33);
    expect([0x02, 0x03]).toContain(signer.publicKey[0]);
  });

  test('throws if KMS returns no public key', async () => {
    const client = { send: async () => ({}) } as unknown as KMSClient;
    await expect(KmsSigner.create('alias/missing', network, client)).rejects.toThrow();
  });
});

describe('KmsSigner.sign', () => {
  test('produces a compact signature that verifies against the digest and public key', async () => {
    const keypair = generateKeyPair(network);
    const client = makeMockKmsClient({
      privateKey: keypair.signer.privateKey!,
      compressedPubkey: keypair.publicKey,
    });
    const signer = await KmsSigner.create('alias/writz-protocol-key', network, client);

    const hash = Buffer.alloc(32, 0x42);
    const sig = await signer.sign(hash);

    expect(sig.length).toBe(64);
    expect(ecc.verify(hash, keypair.publicKey, sig)).toBe(true);
  });

  test('normalizes a high-S KMS response to low-S, still verifying correctly', async () => {
    const keypair = generateKeyPair(network);
    const hash = Buffer.alloc(32, 0x99);

    // Compute the "natural" low-S signature once, then deliberately flip it
    // to the mathematically-equivalent high-S form and hand that back as
    // the mocked KMS response - exactly the failure mode KmsSigner's low-S
    // normalization must correct, since KMS does not guarantee low-S.
    const naturalCompact = Buffer.from(ecc.sign(hash, keypair.signer.privateKey!));
    const naturalS = BigInt('0x' + naturalCompact.subarray(32, 64).toString('hex'));
    const flippedS = SECP256K1_N - naturalS;
    // Sanity: exactly one of (naturalS, flippedS) is <= N/2. Force the
    // high-S one into the mocked response regardless of which the ECC lib
    // happened to produce natively.
    const highS = naturalS > SECP256K1_N / 2n ? naturalS : flippedS;
    const highSCompact = Buffer.concat([
      naturalCompact.subarray(0, 32),
      Buffer.from(highS.toString(16).padStart(64, '0'), 'hex'),
    ]);

    const client = makeMockKmsClient({
      privateKey: keypair.signer.privateKey!,
      compressedPubkey: keypair.publicKey,
      forceDerSignature: () => compactToDer(highSCompact),
    });
    const signer = await KmsSigner.create('alias/writz-protocol-key', network, client);

    const sig = await signer.sign(hash);
    const returnedS = BigInt('0x' + sig.subarray(32, 64).toString('hex'));

    expect(returnedS <= SECP256K1_N / 2n).toBe(true);
    expect(ecc.verify(hash, keypair.publicKey, sig)).toBe(true);
  });

  test('throws if KMS returns no signature', async () => {
    const keypair = generateKeyPair(network);
    const client = makeMockKmsClient({
      privateKey: keypair.signer.privateKey!,
      compressedPubkey: keypair.publicKey,
    });
    const signer = await KmsSigner.create('alias/writz-protocol-key', network, client);

    const brokenClient = { send: async () => ({}) } as unknown as KMSClient;
    (signer as unknown as { client: KMSClient }).client = brokenClient;

    await expect(signer.sign(Buffer.alloc(32))).rejects.toThrow();
  });
});

describe('resolveProtocolSigner', () => {
  test('uses the raw-WIF fallback on testnet when only envPrivateKeyWif is set', async () => {
    const keypair = generateKeyPair(network);
    const wif = keypair.signer.toWIF();

    const signer = await resolveProtocolSigner({ envPrivateKeyWif: wif, network });

    expect(signer.publicKey.equals(keypair.publicKey)).toBe(true);
  });

  test('prefers KMS over the raw-WIF fallback when both are configured', async () => {
    const kmsKeypair = generateKeyPair(network);
    const wifKeypair = generateKeyPair(network);
    const client = makeMockKmsClient({
      privateKey: kmsKeypair.signer.privateKey!,
      compressedPubkey: kmsKeypair.publicKey,
    });

    const signer = await resolveProtocolSigner({
      kmsKeyId: 'alias/writz-protocol-key',
      envPrivateKeyWif: wifKeypair.signer.toWIF(),
      network,
      kmsClient: client,
    });

    expect(signer.publicKey.equals(kmsKeypair.publicKey)).toBe(true);
    expect(signer.publicKey.equals(wifKeypair.publicKey)).toBe(false);
  });

  test('refuses the raw-WIF fallback on mainnet, even with a valid key', async () => {
    const mainnetKeypair = generateKeyPair(bitcoin.networks.bitcoin);
    const wif = mainnetKeypair.signer.toWIF();

    await expect(
      resolveProtocolSigner({ envPrivateKeyWif: wif, network: bitcoin.networks.bitcoin }),
    ).rejects.toThrow(/mainnet/i);
  });

  test('throws when neither kmsKeyId nor envPrivateKeyWif is configured', async () => {
    await expect(resolveProtocolSigner({ network })).rejects.toThrow(
      /No protocol signer configured/i,
    );
  });

  test('sanity: the fallback signer produces a valid signature usable by signInputAsync', async () => {
    const keypair = generateKeyPair(network);
    const signer = await resolveProtocolSigner({
      envPrivateKeyWif: keypair.signer.toWIF(),
      network,
    });

    const hash = Buffer.alloc(32, 0x7);
    const sig = signer.sign(hash);
    expect(ecc.verify(hash, keypair.publicKey, sig as Buffer)).toBe(true);
    // ECPair.fromWIF round-trips to the same key ECPair itself would produce.
    expect(signer.publicKey.equals(ECPair.fromWIF(keypair.signer.toWIF(), network).publicKey)).toBe(true);
  });
});
