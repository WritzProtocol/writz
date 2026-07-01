import { sha256 } from "@noble/hashes/sha2.js";
import { Keypair, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { config } from "@/config";

type SignRawHashFn = (opts: {
  address: string;
  chainType: "stellar";
  hash: `0x${string}`;
}) => Promise<{ signature: `0x${string}` }>;

/**
 * Signs `message` via Privy raw-hash and returns a base64 string in the same
 * shape as the Stellar Wallets Kit `signMessage` output, so `deriveSeed` works
 * without modification on either backend.
 *
 * Privy signs the SHA-256 hash of the message (Tier 2 chains require a hash,
 * not the raw message). The resulting hex signature is base64-encoded before
 * returning to match the kit's format.
 */
export async function signMessageWithPrivy(
  message: string,
  address: string,
  signRawHash: SignRawHashFn,
): Promise<string> {
  const msgBytes = new TextEncoder().encode(message);
  const hashBytes = sha256(msgBytes);
  const hashHex = `0x${Buffer.from(hashBytes).toString("hex")}` as const;

  const { signature } = await signRawHash({
    address,
    chainType: "stellar",
    hash: hashHex,
  });

  return Buffer.from(signature.slice(2), "hex").toString("base64");
}

/**
 * Signs a Stellar transaction XDR via Privy raw-hash, attaches the decorated
 * signature to the envelope, and returns the signed XDR + signer address.
 *
 * FeeBumpTransactions are not supported — Privy embedded wallets are used for
 * end-user signing, not fee-bump sponsorship.
 */
export async function signTransactionWithPrivy(
  xdr: string,
  address: string,
  signRawHash: SignRawHashFn,
): Promise<{ signedTxXdr: string; signerAddress: string }> {
  const tx = TransactionBuilder.fromXDR(xdr, config.networkPassphrase);

  if (!(tx instanceof Transaction)) {
    throw new Error(
      "FeeBumpTransaction signing is not supported via Privy embedded wallet",
    );
  }

  const txHash = tx.hash();
  const hashHex = `0x${Buffer.from(txHash).toString("hex")}` as const;

  const { signature: hexSig } = await signRawHash({
    address,
    chainType: "stellar",
    hash: hashHex,
  });

  // addSignature verifies the signature internally before attaching it.
  const sigBase64 = Buffer.from(hexSig.slice(2), "hex").toString("base64");
  tx.addSignature(address, sigBase64);

  return {
    signedTxXdr: tx.toEnvelope().toXDR("base64"),
    signerAddress: address,
  };
}
