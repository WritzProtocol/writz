import { Client } from "@/lib/contracts/generated";
import { Buffer } from "buffer";
import { config, requireContract } from "@/config";
import { proveDeposit } from "@/lib/prover";
import { simulateWithRetry } from "./submit";
import {
  computeCommitment,
  computeNullifier,
  seedToField,
  deriveSecret,
  deriveNonce,
  deriveViewingKey,
  sealNote,
  bytesToHex,
  savePosition,
  type Position,
} from "@/lib/position";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";

// Must match the contract's `min_deposit_satoshis` config (set at initialization).
const MIN_DEPOSIT_SATS = "100000"; // 0.001 BTC

async function sha256d(bytes: ArrayBuffer): Promise<Buffer> {
  const h1 = await crypto.subtle.digest("SHA-256", bytes);
  const h2 = await crypto.subtle.digest("SHA-256", h1);
  return Buffer.from(h2);
}

/**
 * Split the internal-order txid (SHA256d of raw tx) into the two 128-bit
 * halves the deposit circuit expects as `btc_txid_lo` / `btc_txid_hi`.
 */
async function txidParts(rawTxHex: string): Promise<{ lo: string; hi: string }> {
  const raw = Buffer.from(rawTxHex, "hex");
  const buf = await sha256d(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const hi = BigInt("0x" + buf.subarray(0, 16).toString("hex")).toString();
  const lo = BigInt("0x" + buf.subarray(16, 32).toString("hex")).toString();
  return { lo, hi };
}

export interface SpvBundle {
  txid: string;
  rawTxNoWitness: string;
  confirmations: number;
  sorobanArgs: {
    headers: string[];
    merkle_proof: string[];
    tx_index: number;
    raw_tx: string;
    min_confirmations: number;
  };
}

export async function pollSpvBundle(
  txid: string,
  onStatus: (msg: string) => void,
  intervalMs = 10_000,
  maxAttempts = 72,
): Promise<SpvBundle> {
  const relayerUrl = config.services.relayerUrl;
  if (!relayerUrl) throw new Error("NEXT_PUBLIC_RELAYER_URL is not configured.");

  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const res = await fetch(`${relayerUrl}/spv-proof/${txid}`);
      if (res.status === 404 || res.status === 409) {
        const body = (await res.json()) as { available?: number };
        onStatus(`Waiting for confirmations… (${body.available ?? 0}/6)`);
        await new Promise((r) => setTimeout(r, intervalMs));
        continue;
      }
      if (!res.ok) throw new Error(`Relayer error ${res.status}`);
      return (await res.json()) as SpvBundle;
    } catch (e) {
      if (i === maxAttempts) throw e;
      onStatus(`Relayer unreachable — retrying… (attempt ${i})`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw new Error("SPV proof not available after maximum wait.");
}

export interface DepositResult {
  txHash?: string;
  position: Position;
}

export async function deposit(params: {
  txid: string;
  collateralSats: bigint;
  depositor: string;
  seed: Uint8Array;
  index: number;
  signTransaction: SignTransaction;
  onStatus: (step: string) => void;
  btcPubkey?: string;
  timelockHeight?: number;
  vout?: number;
}): Promise<DepositResult> {
  const {
    txid,
    collateralSats,
    depositor,
    seed,
    index,
    signTransaction,
    onStatus,
    btcPubkey,
    timelockHeight,
    vout,
  } = params;

  // 1. Fetch SPV bundle from the relayer (polls until confirmed).
  const bundle = await pollSpvBundle(txid, onStatus);

  // 2. Split txid into the two 128-bit halves the deposit circuit expects.
  const { lo, hi } = await txidParts(bundle.rawTxNoWitness);

  // 3. Derive keys from the session seed (version 0 for a fresh deposit).
  const f = seedToField(seed);
  const secret = deriveSecret(f, index);
  const nonce = deriveNonce(f, index, 0);

  // 4. ZK deposit proof — generated entirely in the browser.
  onStatus("Generating ZK proof in browser… (may take ~10s)");
  const { proof, publicSignals } = await proveDeposit({
    collateral_satoshis: collateralSats.toString(),
    secret: secret.toString(),
    nonce: nonce.toString(),
    btc_txid_lo: lo,
    btc_txid_hi: hi,
    min_deposit_satoshis: MIN_DEPOSIT_SATS,
  });

  // Public signals (deposit circuit): commitment[0], nullifier[1], ...
  const commitmentBuf = publicSignals[0];
  const commitment = BigInt("0x" + commitmentBuf.toString("hex"));
  const nullifier = computeNullifier(secret, nonce);

  const localCommitment = computeCommitment(collateralSats, 0n, secret, nonce);
  if (commitment !== localCommitment) {
    throw new Error("Commitment mismatch — circuit output does not match local computation.");
  }

  // Seal the recovery note for the deposit state (debt 0) to the viewing key.
  const encNote = sealNote(
    { index, version: 0, collateralSats: collateralSats.toString(), debtStroops: "0" },
    deriveViewingKey(seed).publicKey,
  );

  // 5. Submit deposit() — user signs with their Stellar wallet.
  onStatus("Submitting deposit to Soroban… (step 1/2)");
  const client = new Client({
    contractId: requireContract(config.contracts.commitmentTree, "commitment-tree"),
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    allowHttp: config.rpcUrl.startsWith("http://"),
    publicKey: depositor,
  });

  const { sorobanArgs } = bundle;
  const tx = await simulateWithRetry(() =>
    client.deposit({
      depositor,
      headers: sorobanArgs.headers.map((h) => Buffer.from(h, "hex")),
      merkle_proof_btc: sorobanArgs.merkle_proof.map((h) => Buffer.from(h, "hex")),
      tx_index: sorobanArgs.tx_index,
      raw_tx: Buffer.from(sorobanArgs.raw_tx, "hex"),
      zk_proof: proof,
      public_signals: publicSignals,
      enc_note: Buffer.from(encNote),
    }),
  );
  const sent = await tx.signAndSend({ signTransaction });

  // 6. Admin inserts the commitment into the Merkle tree (Phase 1: trusted relay).
  onStatus("Finalizing position in Merkle tree… (step 2/2)");
  const relayerUrl = config.services.relayerUrl;
  if (!relayerUrl) throw new Error("NEXT_PUBLIC_RELAYER_URL is not configured");
  const insertRes = await fetch(`${relayerUrl}/insert-commitment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commitment: commitment.toString(16).padStart(64, "0"),
      encNote: bytesToHex(encNote),
    }),
  });
  if (!insertRes.ok) {
    const body = (await insertRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(`Merkle insertion failed: ${body.error ?? insertRes.status}`);
  }
  const insertBody = (await insertRes.json().catch(() => ({}))) as { leafIndex?: number };
  const leafIndex = insertBody.leafIndex;

  // 7. Persist the position (no secret/nonce — derived from the seed + index/version).
  const position: Position = {
    id: commitment.toString(),
    owner: depositor,
    txid,
    collateralSats: collateralSats.toString(),
    debtStroops: "0",
    index,
    version: 0,
    commitment: commitment.toString(),
    nullifier: nullifier.toString(),
    status: "active",
    createdAt: Date.now(),
    btcPubkey,
    timelockHeight,
    vout,
    leafIndex,
  };
  savePosition(position);

  return { txHash: sent.sendTransactionResponse?.hash, position };
}
