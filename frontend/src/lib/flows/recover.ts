import { config } from "@/config";
import {
  computeCommitment,
  computeNullifier,
  seedToField,
  deriveSecret,
  deriveNonce,
  deriveViewingKey,
  openNote,
  hexToBytes,
  listPositions,
  removePosition,
  savePosition,
  type Position,
} from "@/lib/position";

interface RelayerNote {
  leafIndex: number;
  encNote: string;
  commitment: string | null;
}

export interface RecoverResult {
  recovered: number;
  scanned: number;
}

/**
 * Rebuild this wallet's positions on a fresh device (#18). Fetches every sealed
 * recovery note from the relayer, trial-decrypts each with the viewing key
 * derived from the session seed, and reconstructs the matching positions.
 *
 * Position STATE (collateral, debt, index, version → spending keys) is fully
 * recovered, so borrow/repay/release-proving work. Bitcoin release metadata
 * (txid, vout, btcPubkey, timelock) lives only on the originating device; when a
 * recovered position already exists locally that metadata is preserved, and a
 * note with no local match is restored state-only.
 */
export async function recoverPositions(params: {
  owner: string;
  seed: Uint8Array;
}): Promise<RecoverResult> {
  const { owner, seed } = params;

  const relayerUrl = config.services.relayerUrl;
  if (!relayerUrl) throw new Error("NEXT_PUBLIC_RELAYER_URL is not configured");

  const res = await fetch(`${relayerUrl}/notes`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`Failed to fetch notes: ${body.error ?? res.status}`);
  }
  const { notes } = (await res.json()) as { notes: RelayerNote[] };

  const f = seedToField(seed);
  const viewingSk = deriveViewingKey(seed).secretKey;
  const existing = listPositions(owner);

  let recovered = 0;
  for (const n of notes) {
    const note = openNote(hexToBytes(n.encNote), viewingSk);
    if (!note) continue; // not ours — trial decryption failed

    const collateral = BigInt(note.collateralSats);
    const debt = BigInt(note.debtStroops);
    const secret = deriveSecret(f, note.index);
    const nonce = deriveNonce(f, note.index, note.version);
    const commitment = computeCommitment(collateral, debt, secret, nonce);

    // Skip notes that don't reconstruct the on-chain commitment for their leaf
    // (a stale or tampered note) — only trust verifiable state.
    if (n.commitment !== null && commitment !== BigInt("0x" + n.commitment)) continue;

    const prior = existing.find((p) => p.index === note.index);
    if (prior) removePosition(owner, prior.id);

    const position: Position = {
      id: commitment.toString(),
      owner,
      txid: prior?.txid ?? null,
      collateralSats: note.collateralSats,
      debtStroops: note.debtStroops,
      index: note.index,
      version: note.version,
      commitment: commitment.toString(),
      nullifier: computeNullifier(secret, nonce).toString(),
      status: debt > 0n ? "active" : "closed",
      createdAt: prior?.createdAt ?? Date.now(),
      btcPubkey: prior?.btcPubkey,
      timelockHeight: prior?.timelockHeight,
      vout: prior?.vout,
      leafIndex: n.leafIndex,
    };
    savePosition(position);
    recovered++;
  }

  return { recovered, scanned: notes.length };
}
