import { Buffer } from "buffer";
import { Client } from "@/lib/contracts/generated";
import { config, requireContract } from "@/config";
import { proveBorrowRepay } from "@/lib/prover";
import { simulateWithRetry } from "./submit";
import {
  computeCommitment,
  computeNullifier,
  positionKeys,
  seedToField,
  deriveNonce,
  deriveViewingKey,
  sealNote,
  bytesToHex,
  removePosition,
  savePosition,
  type Position,
} from "@/lib/position";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";

const MIN_RATIO_BP = "15000"; // 150% — must match contract's min_collateral_ratio_bp

interface MerklePathResponse {
  root: string;
  pathElements: string[];
  pathIndices: number[];
  leafIndex: number;
}

async function fetchMerklePath(commitmentHex: string, leafIndex?: number): Promise<MerklePathResponse> {
  const relayerUrl = config.services.relayerUrl;
  if (!relayerUrl) throw new Error("NEXT_PUBLIC_RELAYER_URL is not configured");
  const qs =
    leafIndex !== undefined
      ? `?leafIndex=${leafIndex}&commitment=${commitmentHex}`
      : `?commitment=${commitmentHex}`;
  const res = await fetch(`${relayerUrl}/merkle-path${qs}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`Merkle path unavailable: ${body.error ?? res.status}`);
  }
  return res.json() as Promise<MerklePathResponse>;
}

export interface BorrowResult {
  txHash?: string;
  updated: Position;
}

/**
 * Borrow USDC against a position. Keys are derived from the session `seed`
 * (secret fixed per index; nonce rotated by bumping `version`). The recovery
 * note for the new state is sealed to the viewing key and emitted on-chain.
 */
export async function borrow(params: {
  position: Position;
  amountStroops: bigint;
  borrower: string;
  seed: Uint8Array;
  signTransaction: SignTransaction;
}): Promise<BorrowResult> {
  const { position, amountStroops, borrower, seed, signTransaction } = params;

  const collateral = BigInt(position.collateralSats);
  const oldDebt = BigInt(position.debtStroops);
  const f = seedToField(seed);
  const { secret, nonce } = positionKeys(seed, position);
  const newVersion = position.version + 1;
  const newNonce = deriveNonce(f, position.index, newVersion);

  const commitment = computeCommitment(collateral, oldDebt, secret, nonce);
  const commitmentHex = commitment.toString(16).padStart(64, "0");

  // Real Merkle path from the relayer; leafIndex looks up by position (the
  // commitment rotates each borrow, so value-based lookup fails after the first).
  const { root, pathElements, pathIndices } = await fetchMerklePath(commitmentHex, position.leafIndex);

  const { proof, publicSignals } = await proveBorrowRepay({
    collateral_satoshis: collateral.toString(),
    old_debt_stroops: oldDebt.toString(),
    secret: secret.toString(),
    nonce: nonce.toString(),
    new_nonce: newNonce.toString(),
    path_elements: pathElements,
    path_indices: pathIndices.map(String),
    old_root: root,
    delta_stroops: amountStroops.toString(),
    is_borrow: "1",
    // Must match the on-chain oracle (env NEXT_PUBLIC_BTC_PRICE_STROOPS) or the
    // contract rejects with PriceMismatch (#12).
    btc_price_stroops_per_btc: config.btcPriceStroops,
    min_ratio_bp: MIN_RATIO_BP,
  });

  const newDebt = oldDebt + amountStroops;
  // Seal the recovery note for the NEW (higher-debt) state to the viewing key.
  const encNote = sealNote(
    {
      index: position.index,
      version: newVersion,
      collateralSats: collateral.toString(),
      debtStroops: newDebt.toString(),
    },
    deriveViewingKey(seed).publicKey,
  );

  const client = new Client({
    contractId: requireContract(config.contracts.commitmentTree, "commitment-tree"),
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    allowHttp: config.rpcUrl.startsWith("http://"),
    publicKey: borrower,
  });

  const tx = await simulateWithRetry(() =>
    client.borrow({
      borrower,
      zk_proof: proof,
      public_signals: publicSignals,
      enc_note: Buffer.from(encNote),
    }),
  );
  const sent = await tx.signAndSend({ signTransaction });

  const newCommitment = computeCommitment(collateral, newDebt, secret, newNonce);
  const updated: Position = {
    ...position,
    id: newCommitment.toString(),
    debtStroops: newDebt.toString(),
    version: newVersion,
    commitment: newCommitment.toString(),
    nullifier: computeNullifier(secret, newNonce).toString(),
    status: "active",
  };
  removePosition(position.owner, position.id);
  savePosition(updated);

  // Sync the relayer leaf store so subsequent ops get correct sibling values.
  if (position.leafIndex !== undefined && config.services.relayerUrl) {
    const syncRes = await fetch(`${config.services.relayerUrl}/update-leaf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leafIndex: position.leafIndex,
        newCommitment: newCommitment.toString(16).padStart(64, "0"),
        encNote: bytesToHex(encNote),
      }),
    }).catch(() => null);
    if (!syncRes || !syncRes.ok) {
      throw new Error(
        "Borrowed on-chain, but failed to sync the relayer leaf store — resync the relayer before the next operation.",
      );
    }
  }

  return { txHash: sent.sendTransactionResponse?.hash, updated };
}
