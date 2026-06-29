import { NextRequest, NextResponse } from "next/server";
import { readLeaves, writeLeaves } from "@/lib/server/leaf-store";
import { computeRoot } from "@/lib/merkle";

/**
 * POST /api/update-leaf
 *
 * Updates a single leaf in the server-side Merkle store after a borrow or
 * repay rotates the position's commitment. Must be called by the client after
 * the on-chain transaction confirms; until then the server's tree is stale.
 *
 * Body: { leafIndex: number; newCommitment: string (64-char hex) }
 *
 * Returns: { newRoot: string (decimal) }
 *
 * Phase 1 (trusted relay): the caller is trusted to supply the correct values.
 * No on-chain verification is performed here — the ZK proof submitted to the
 * contract already ensures correctness. Phase 2 will derive updates from an
 * on-chain event indexer instead.
 */
export async function POST(req: NextRequest) {
  let body: { leafIndex?: number; newCommitment?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { leafIndex, newCommitment } = body;

  if (typeof leafIndex !== "number" || !Number.isInteger(leafIndex) || leafIndex < 0) {
    return NextResponse.json(
      { error: "leafIndex must be a non-negative integer" },
      { status: 400 },
    );
  }

  if (!newCommitment || !/^[0-9a-f]{64}$/i.test(newCommitment)) {
    return NextResponse.json(
      { error: "newCommitment must be a 64-char hex string" },
      { status: 400 },
    );
  }

  const leaves = readLeaves();

  if (leafIndex >= leaves.length) {
    return NextResponse.json(
      { error: `leafIndex ${leafIndex} out of range — leaf store has ${leaves.length} leaves` },
      { status: 400 },
    );
  }

  leaves[leafIndex] = BigInt("0x" + newCommitment);
  writeLeaves(leaves);

  const newRoot = computeRoot(leaves);

  return NextResponse.json({ newRoot: newRoot.toString() });
}
