import { NextRequest, NextResponse } from "next/server";
import { computePath } from "@/lib/merkle";
import { readLeaves } from "@/lib/server/leaf-store";

/**
 * GET /api/merkle-path?leafIndex=<n>&commitment=<64-char-hex>
 *   Returns the Poseidon Merkle authentication path for the commitment at the
 *   given leaf index. The commitment value is provided by the caller (it may
 *   differ from the original deposit commitment after borrow/repay rotates the
 *   nonce), and the server uses all *other* leaves from its persistent store to
 *   compute sibling values. This is correct because a leaf's siblings are
 *   determined solely by the commitments of *other* positions.
 *
 * GET /api/merkle-path?commitment=<64-char-hex>   (legacy)
 *   Searches the leaf store by value — only works for the original deposit
 *   commitment (first borrow). Positions created before leafIndex was
 *   persisted fall back to this mode.
 */
export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const commitmentHex = params.get("commitment");
  const leafIndexParam = params.get("leafIndex");

  if (!commitmentHex || !/^[0-9a-f]{64}$/i.test(commitmentHex)) {
    return NextResponse.json(
      { error: "commitment must be a 64-char hex query parameter" },
      { status: 400 },
    );
  }

  const commitment = BigInt("0x" + commitmentHex);
  const leaves = readLeaves();

  let leafIndex: number;

  if (leafIndexParam !== null) {
    // Preferred path: caller provides the leaf index (stored in Position since
    // the deposit response). Replace the leaf at that index with the current
    // commitment (which may differ from the deposit commitment after borrows).
    leafIndex = parseInt(leafIndexParam, 10);
    if (!Number.isFinite(leafIndex) || leafIndex < 0 || leafIndex >= leaves.length) {
      return NextResponse.json(
        { error: `leafIndex ${leafIndexParam} is out of range [0, ${leaves.length})` },
        { status: 400 },
      );
    }
    // Overwrite the stored (possibly stale) value with the caller's current one.
    leaves[leafIndex] = commitment;
  } else {
    // Legacy path: search by commitment value. Works only for the deposit
    // commitment (before any borrow rotates it). Kept for backward compat.
    leafIndex = leaves.findIndex((l) => l === commitment);
    if (leafIndex === -1) {
      return NextResponse.json(
        { error: "commitment not found in leaf store — deposit may not yet be finalized" },
        { status: 404 },
      );
    }
  }

  const { root, pathElements, pathIndices } = computePath(leaves, leafIndex);

  return NextResponse.json({
    root: root.toString(),
    pathElements: pathElements.map(String),
    pathIndices,
    leafIndex,
  });
}
