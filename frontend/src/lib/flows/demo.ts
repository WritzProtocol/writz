import { config } from "@/config";
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

// 0.01 BTC → ~$600 collateral at the fixed testnet price, enough to borrow
// a few hundred USDC against the demo pool.
const DEMO_COLLATERAL_SATS = 1_000_000n;

// Per-wallet flag so the demo can only be loaded once. insert_commitment
// consumes a pending commitment, so re-running for the same wallet would fail.
const DEMO_FLAG_PREFIX = "writz.demo.";

/** Whether a demo position has already been loaded for this wallet. */
export function isDemoLoaded(owner: string): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(`${DEMO_FLAG_PREFIX}${owner}`) === "1";
}

/**
 * Creates a position for testing the borrow/repay flow without a real BTC
 * deposit. The commitment is inserted into the on-chain Merkle tree (via the
 * relayer admin) so borrow/repay produce valid ZK proofs against the real root —
 * but no Bitcoin is locked, so the position has no `btcPubkey` and the release
 * flow stays hidden. Keys are derived from the wallet seed, so it's also
 * recoverable like any real position (#18).
 */
export async function createDemoPosition(params: {
  owner: string;
  seed: Uint8Array;
  index: number;
}): Promise<Position> {
  const { owner, seed, index } = params;

  const relayerUrl = config.services.relayerUrl;
  if (!relayerUrl) throw new Error("NEXT_PUBLIC_RELAYER_URL is not configured");

  const f = seedToField(seed);
  const secret = deriveSecret(f, index);
  const nonce = deriveNonce(f, index, 0);
  const collateral = DEMO_COLLATERAL_SATS;
  const commitment = computeCommitment(collateral, 0n, secret, nonce);
  const commitmentHex = commitment.toString(16).padStart(64, "0");

  const encNote = sealNote(
    { index, version: 0, collateralSats: collateral.toString(), debtStroops: "0" },
    deriveViewingKey(seed).publicKey,
  );

  const res = await fetch(`${relayerUrl}/insert-commitment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commitment: commitmentHex, encNote: bytesToHex(encNote) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`Demo insertion failed: ${body.error ?? res.status}`);
  }
  const body = (await res.json().catch(() => ({}))) as { leafIndex?: number };

  const position: Position = {
    id: commitment.toString(),
    owner,
    txid: null,
    collateralSats: collateral.toString(),
    debtStroops: "0",
    index,
    version: 0,
    commitment: commitment.toString(),
    nullifier: computeNullifier(secret, nonce).toString(),
    status: "active",
    createdAt: Date.now(),
    leafIndex: body.leafIndex,
    // No btcPubkey/timelockHeight/vout — no real BTC, so release stays hidden.
  };
  savePosition(position);
  if (typeof window !== "undefined") {
    localStorage.setItem(`${DEMO_FLAG_PREFIX}${owner}`, "1");
  }
  return position;
}
