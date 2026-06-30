import { Router, Request, Response } from "express";
import { Keypair, Transaction } from "@stellar/stellar-sdk";
import { Client } from "commitment-tree";
import { config } from "../config.js";
import { computePath, computeRoot } from "../merkle.js";
import { readLeaves, writeLeaves } from "../leaf-store.js";

const COMMITMENT_RE = /^[0-9a-f]{64}$/i;

export const merkleRouter = Router();

// ---------------------------------------------------------------------------
// Retry wrapper for Soroban simulations that can fail transiently right after
// a prior transaction (RPC state lag, sequence mismatch, root mismatch).
// ---------------------------------------------------------------------------
const TRANSIENT = /Error\(Contract, #5\)|RootMismatch|txBadSeq|NotFound|not found/i;

async function simulateWithRetry<T>(
  build: () => Promise<T>,
  attempts = 8,
  baseDelayMs = 2500,
): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await build();
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (TRANSIENT.test(msg) && i < attempts) {
        await new Promise((r) => setTimeout(r, Math.min(baseDelayMs + (i - 1) * 1000, 6000)));
        continue;
      }
      throw e;
    }
  }
  throw last;
}

// ---------------------------------------------------------------------------
// POST /insert-commitment
// ---------------------------------------------------------------------------
merkleRouter.post("/insert-commitment", async (req: Request, res: Response): Promise<void> => {
  if (!config.adminSecret) {
    res.status(500).json({ error: "ADMIN_SECRET not configured" });
    return;
  }
  if (!config.commitmentTreeId) {
    res.status(500).json({ error: "COMMITMENT_TREE_ID not configured" });
    return;
  }

  const { commitment: commitmentHex } = req.body as { commitment?: string };
  if (!commitmentHex || !COMMITMENT_RE.test(commitmentHex)) {
    res.status(400).json({ error: "commitment must be a 64-char hex string" });
    return;
  }

  try {
    const keypair = Keypair.fromSecret(config.adminSecret);
    const admin = keypair.publicKey();
    const commitment = BigInt("0x" + commitmentHex);
    const toBytes = (n: bigint) => Buffer.from(n.toString(16).padStart(64, "0"), "hex");

    // Verify local leaf store matches on-chain root before inserting.
    const existingLeaves = readLeaves();
    const computedRoot = computeRoot(existingLeaves);

    const readClient = new Client({
      contractId: config.commitmentTreeId,
      networkPassphrase: config.networkPassphrase,
      rpcUrl: config.stellarRpcUrl,
      allowHttp: config.stellarRpcUrl.startsWith("http://"),
      publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    });

    const { result: onChainRootBytes } = await readClient.get_merkle_root();
    const onChainRoot = BigInt("0x" + Buffer.from(onChainRootBytes).toString("hex"));

    if (computedRoot !== onChainRoot) {
      res.status(409).json({
        error:
          "Leaf store is out of sync with the on-chain Merkle root. " +
          "Manual resync required before new insertions can proceed.",
        onChainRoot: onChainRoot.toString(16).padStart(64, "0"),
        computedRoot: computedRoot.toString(16).padStart(64, "0"),
        leafCount: existingLeaves.length,
      });
      return;
    }

    const newLeaves = [...existingLeaves, commitment];
    const newRoot = computeRoot(newLeaves);

    const writeClient = new Client({
      contractId: config.commitmentTreeId,
      networkPassphrase: config.networkPassphrase,
      rpcUrl: config.stellarRpcUrl,
      allowHttp: config.stellarRpcUrl.startsWith("http://"),
      publicKey: admin,
    });

    const signTransaction = async (xdr: string) => {
      const tx = new Transaction(xdr, config.networkPassphrase);
      tx.sign(keypair);
      return { signedTxXdr: tx.toXDR(), signerAddress: admin };
    };

    const tx = await simulateWithRetry(() =>
      writeClient.insert_commitment({
        caller: admin,
        commitment: toBytes(commitment),
        new_root: toBytes(newRoot),
      }),
    );
    const sent = await tx.signAndSend({ signTransaction });

    writeLeaves(newLeaves);

    res.json({
      txHash: sent.sendTransactionResponse?.hash,
      leafIndex: existingLeaves.length,
      newRoot: newRoot.toString(16).padStart(64, "0"),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(502).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// GET /merkle-path?leafIndex=<n>&commitment=<hex>
// GET /merkle-path?commitment=<hex>   (legacy — only works for deposit commitment)
//
// Validates the local leaf store against the current on-chain Merkle root before
// computing a path. If they diverge (e.g. a borrow/repay update-leaf was dropped),
// returns 409 rather than silently handing back an incorrect path that would
// produce an unsatisfiable ZK witness or a failed cosign root-match check.
// ---------------------------------------------------------------------------
merkleRouter.get("/merkle-path", async (req: Request, res: Response): Promise<void> => {
  const { commitment: commitmentHex, leafIndex: leafIndexParam } = req.query as {
    commitment?: string;
    leafIndex?: string;
  };

  if (!commitmentHex || !COMMITMENT_RE.test(commitmentHex)) {
    res.status(400).json({ error: "commitment must be a 64-char hex query parameter" });
    return;
  }

  const leaves = readLeaves();

  // ── Root freshness check ────────────────────────────────────────────────────
  // If the local store has drifted from the on-chain tree (e.g. a prior
  // update-leaf call was lost), fail fast with a clear error rather than
  // returning a path whose siblings don't match the chain.
  if (config.commitmentTreeId) {
    try {
      const readClient = new Client({
        contractId: config.commitmentTreeId,
        networkPassphrase: config.networkPassphrase,
        rpcUrl: config.stellarRpcUrl,
        allowHttp: config.stellarRpcUrl.startsWith("http://"),
        publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      });
      const { result: onChainRootBytes } = await readClient.get_merkle_root();
      const onChainRoot = BigInt("0x" + Buffer.from(onChainRootBytes).toString("hex"));
      const localRoot = computeRoot(leaves);

      if (localRoot !== onChainRoot) {
        res.status(409).json({
          error:
            "Leaf store is out of sync with the on-chain Merkle root — " +
            "a prior borrow/repay update may not have been recorded. " +
            "Please contact the protocol operator to resync the relayer.",
          onChainRoot: onChainRoot.toString(16).padStart(64, "0"),
          localRoot: localRoot.toString(16).padStart(64, "0"),
        });
        return;
      }
    } catch (e) {
      // RPC unavailable — proceed without freshness check rather than blocking
      // all users. The ZK proof or cosign root-match check will catch staleness.
      console.warn("[merkle-path] root freshness check failed:", e instanceof Error ? e.message : e);
    }
  }

  // ── Path computation ────────────────────────────────────────────────────────
  const commitment = BigInt("0x" + commitmentHex);
  let leafIndex: number;

  if (leafIndexParam !== undefined) {
    leafIndex = parseInt(leafIndexParam, 10);
    if (!Number.isFinite(leafIndex) || leafIndex < 0 || leafIndex >= leaves.length) {
      res.status(400).json({
        error: `leafIndex ${leafIndexParam} is out of range [0, ${leaves.length})`,
      });
      return;
    }
    // Substitute the client-provided commitment (post-borrow/repay value) at
    // this index so the path is consistent with the NEW leaf value. The
    // siblings come from the store (validated against on-chain root above).
    leaves[leafIndex] = commitment;
  } else {
    leafIndex = leaves.findIndex((l) => l === commitment);
    if (leafIndex === -1) {
      res.status(404).json({
        error: "commitment not found in leaf store — deposit may not yet be finalized",
      });
      return;
    }
  }

  const { root, pathElements, pathIndices } = computePath(leaves, leafIndex);

  res.json({
    root: root.toString(),
    pathElements: pathElements.map(String),
    pathIndices,
    leafIndex,
  });
});

// ---------------------------------------------------------------------------
// POST /update-leaf
// ---------------------------------------------------------------------------
merkleRouter.post("/update-leaf", (req: Request, res: Response): void => {
  const { leafIndex, newCommitment } = req.body as {
    leafIndex?: number;
    newCommitment?: string;
  };

  if (typeof leafIndex !== "number" || !Number.isInteger(leafIndex) || leafIndex < 0) {
    res.status(400).json({ error: "leafIndex must be a non-negative integer" });
    return;
  }
  if (!newCommitment || !COMMITMENT_RE.test(newCommitment)) {
    res.status(400).json({ error: "newCommitment must be a 64-char hex string" });
    return;
  }

  const leaves = readLeaves();
  if (leafIndex >= leaves.length) {
    res.status(400).json({
      error: `leafIndex ${leafIndex} out of range — leaf store has ${leaves.length} leaves`,
    });
    return;
  }

  leaves[leafIndex] = BigInt("0x" + newCommitment);
  writeLeaves(leaves);

  const newRoot = computeRoot(leaves);
  res.json({ newRoot: newRoot.toString() });
});
