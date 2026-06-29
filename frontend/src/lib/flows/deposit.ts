import { Client } from "commitment-tree";
import { Buffer } from "buffer";
import { config, requireContract } from "@/config";
import { proveDeposit } from "@/lib/prover";
import { singleLeafPath } from "@/lib/merkle";
import { simulateWithRetry } from "./submit";
import {
  computeCommitment,
  computeNullifier,
  randomFieldElement,
  savePosition,
  type Position,
} from "@/lib/position";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";

const MIN_DEPOSIT_SATS = "100000"; // 0.001 BTC — must match contract config

async function sha256d(bytes: ArrayBuffer): Promise<Buffer> {
  const h1 = await crypto.subtle.digest("SHA-256", bytes);
  const h2 = await crypto.subtle.digest("SHA-256", h1);
  return Buffer.from(h2);
}

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
  signTransaction: SignTransaction;
  onStatus: (step: string) => void;
  btcPubkey?: string;
  timelockHeight?: number;
  vout?: number;
}): Promise<DepositResult> {
  const { txid, collateralSats, depositor, signTransaction, onStatus, btcPubkey, timelockHeight, vout } = params;

  const bundle = await pollSpvBundle(txid, onStatus);
  const { lo, hi } = await txidParts(bundle.rawTxNoWitness);

  const secret = randomFieldElement();
  const nonce = randomFieldElement();

  onStatus("Generating ZK proof in browser… (may take ~10s)");
  const { proof, publicSignals } = await proveDeposit({
    collateral_satoshis: collateralSats.toString(),
    secret: secret.toString(),
    nonce: nonce.toString(),
    btc_txid_lo: lo,
    btc_txid_hi: hi,
    min_deposit_satoshis: MIN_DEPOSIT_SATS,
  });

  const commitmentBuf = publicSignals[0];
  const commitment = BigInt("0x" + commitmentBuf.toString("hex"));
  const nullifier = computeNullifier(secret, nonce);

  const localCommitment = computeCommitment(collateralSats, 0n, secret, nonce);
  if (commitment !== localCommitment) {
    throw new Error("Commitment mismatch — circuit output does not match local computation.");
  }

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
    }),
  );
  const sent = await tx.signAndSend({ signTransaction });

  onStatus("Finalizing position in Merkle tree… (step 2/2)");
  const newRoot = singleLeafPath(commitment).root;
  const insertRes = await fetch("/api/insert-commitment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commitment: commitment.toString(16).padStart(64, "0"),
      new_root: newRoot.toString(16).padStart(64, "0"),
    }),
  });
  if (!insertRes.ok) {
    const body = (await insertRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(`Merkle insertion failed: ${body.error ?? insertRes.status}`);
  }

  const position: Position = {
    id: commitment.toString(),
    owner: depositor,
    txid,
    collateralSats: collateralSats.toString(),
    debtStroops: "0",
    secret: secret.toString(),
    nonce: nonce.toString(),
    commitment: commitment.toString(),
    nullifier: nullifier.toString(),
    status: "active",
    createdAt: Date.now(),
    btcPubkey,
    timelockHeight,
    vout,
  };
  savePosition(position);

  return { txHash: sent.sendTransactionResponse?.hash, position };
}
