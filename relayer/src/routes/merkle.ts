import { Router, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { Keypair, Transaction, rpc } from "@stellar/stellar-sdk";
import { Client } from "commitment-tree";
import { config } from "../config.js";
import { computePath, computeRoot } from "../merkle.js";
import { readLeaves, writeLeaves, saveNote, readNotes } from "../leaf-store.js";
import { verifyInsertAuth, lookupDepositorOnChain, InsertAuthError } from "../insert-auth.js";
import { proveInsertion } from "../insert-prover.js";

const COMMITMENT_RE = /^[0-9a-f]{64}$/i;
const HEX_RE = /^[0-9a-f]+$/i;

export const merkleRouter = Router();

// Per-IP limiter for the two mutating, previously-unauthenticated routes
// (js/missing-rate-limiting, flagged by CodeQL on /insert-commitment once it
// started doing real authorization - a check worth throttling regardless of
// outcome, since /insert-commitment's failure path still does a Soroban RPC
// event scan, and /update-leaf's still does a get_merkle_root() call). A
// generous but finite budget: real deposits/borrows/repays are infrequent
// per wallet, so this only bites a caller hammering the endpoint.
const writeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests - please slow down and try again shortly." },
});

// Read-only calls use this fixed dummy address as `publicKey` - the
// generated Client requires one to build a simulation envelope, but
// `get_merkle_root` never checks an auth source, so any syntactically valid
// account works.
const READ_ONLY_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/** Fetches the index of the next empty leaf the contract will accept. */
async function fetchOnChainNextLeafIndex(): Promise<number> {
  const readClient = new Client({
    contractId: config.commitmentTreeId,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.stellarRpcUrl,
    allowHttp: config.stellarRpcUrl.startsWith("http://"),
    publicKey: READ_ONLY_SOURCE,
  });
  const { result } = await readClient.get_next_leaf_index();
  return Number(result);
}

// Insertions run one at a time: each proof targets "the next leaf", so two
// concurrent requests would prove the same slot and one would fail on-chain.
let insertQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = insertQueue.then(task, task);
  insertQueue = run.catch(() => undefined);
  return run;
}

/** Fetches the real on-chain Merkle root. Throws if `COMMITMENT_TREE_ID` is
 * unset or the RPC call fails - callers decide how to respond to either. */
async function fetchOnChainRoot(): Promise<bigint> {
  const readClient = new Client({
    contractId: config.commitmentTreeId,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.stellarRpcUrl,
    allowHttp: config.stellarRpcUrl.startsWith("http://"),
    publicKey: READ_ONLY_SOURCE,
  });
  const { result: onChainRootBytes } = await readClient.get_merkle_root();
  return BigInt("0x" + Buffer.from(onChainRootBytes).toString("hex"));
}

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
merkleRouter.post("/insert-commitment", writeLimiter, async (req: Request, res: Response): Promise<void> => {
  if (!config.adminSecret) {
    res.status(500).json({ error: "ADMIN_SECRET not configured" });
    return;
  }
  if (!config.commitmentTreeId) {
    res.status(500).json({ error: "COMMITMENT_TREE_ID not configured" });
    return;
  }

  const { commitment: commitmentHex, encNote, authTxXdr } = req.body as {
    commitment?: string;
    encNote?: string;
    authTxXdr?: string;
  };
  if (!commitmentHex || !COMMITMENT_RE.test(commitmentHex)) {
    res.status(400).json({ error: "commitment must be a 64-char hex string" });
    return;
  }
  if (encNote !== undefined && !HEX_RE.test(encNote)) {
    res.status(400).json({ error: "encNote must be a hex string" });
    return;
  }
  if (!authTxXdr || typeof authTxXdr !== "string") {
    res.status(400).json({ error: "authTxXdr is required - see docs/how-it-works for the deposit flow" });
    return;
  }

  try {
    // Authorization: authTxXdr must be signed by this commitment's real,
    // on-chain depositor (GHSA-wqp4-3573-552v, GHSA-prw2-j3jx-43qh) - not
    // just "any network-reachable caller", which is what let a third party
    // hijack someone else's pending deposit before this fix.
    try {
      await verifyInsertAuth(authTxXdr, commitmentHex, {
        networkPassphrase: config.networkPassphrase,
        lookupDepositor: (hex) =>
          lookupDepositorOnChain(
            new rpc.Server(config.stellarRpcUrl, { allowHttp: config.stellarRpcUrl.startsWith("http://") }),
            config.commitmentTreeId,
            hex,
          ),
      });
    } catch (e) {
      if (e instanceof InsertAuthError) {
        res.status(403).json({ error: e.message });
        return;
      }
      throw e;
    }

    const adminSecret = config.adminSecret;
    await serialized(async () => {
      const keypair = Keypair.fromSecret(adminSecret);
      const admin = keypair.publicKey();
      const commitment = BigInt("0x" + commitmentHex);

      // Verify local leaf store matches on-chain root before inserting.
      const existingLeaves = readLeaves();
      const computedRoot = computeRoot(existingLeaves);
      const [onChainRoot, onChainNextLeaf] = await Promise.all([fetchOnChainRoot(), fetchOnChainNextLeafIndex()]);

      if (computedRoot !== onChainRoot || onChainNextLeaf !== existingLeaves.length) {
        res.status(409).json({
          error:
            "Leaf store is out of sync with the on-chain Merkle root. " +
            "Manual resync required before new insertions can proceed.",
          onChainRoot: onChainRoot.toString(16).padStart(64, "0"),
          computedRoot: computedRoot.toString(16).padStart(64, "0"),
          leafCount: existingLeaves.length,
          onChainNextLeaf,
        });
        return;
      }

      // The contract only accepts a proof that the new root is the current one
      // with this commitment in the next empty leaf (#211) - it no longer
      // takes a root from us.
      const { proof, publicSignals, newRoot, leafIndex } = await proveInsertion(existingLeaves, commitment);
      const newLeaves = [...existingLeaves, commitment];

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
          zk_proof: proof,
          public_signals: publicSignals,
        }),
      );
      const sent = await tx.signAndSend({ signTransaction });

      writeLeaves(newLeaves);
      if (encNote) saveNote(leafIndex, encNote);

      res.json({
        txHash: sent.sendTransactionResponse?.hash,
        leafIndex,
        newRoot: newRoot.toString(16).padStart(64, "0"),
      });
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(502).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// GET /merkle-path?leafIndex=<n>&commitment=<hex>
// GET /merkle-path?commitment=<hex>   (legacy - only works for deposit commitment)
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
      const onChainRoot = await fetchOnChainRoot();
      const localRoot = computeRoot(leaves);

      if (localRoot !== onChainRoot) {
        res.status(409).json({
          error:
            "Leaf store is out of sync with the on-chain Merkle root - " +
            "a prior borrow/repay update may not have been recorded. " +
            "Please contact the protocol operator to resync the relayer.",
          onChainRoot: onChainRoot.toString(16).padStart(64, "0"),
          localRoot: localRoot.toString(16).padStart(64, "0"),
        });
        return;
      }
    } catch (e) {
      // RPC unavailable - proceed without freshness check rather than blocking
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
        error: "commitment not found in leaf store - deposit may not yet be finalized",
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
//
// Unauthenticated by design (the frontend calls this from the browser right
// after a real borrow/repay confirms - there's no admin key involved here,
// unlike /insert-commitment). That used to mean anyone could overwrite any
// leaf with arbitrary garbage (GHSA-ffx5-7x4m-939g): no auth, no validation
// that `newCommitment` came from a real on-chain event.
//
// Instead of adding identity-based auth (which the legitimate caller - any
// borrower/repayer - can't be meaningfully distinguished from an attacker by
// anyway), this validates the write against ground truth: a real borrow/repay
// has already advanced the on-chain Merkle root to exactly the value this
// update would produce. Only a write that reproduces the real root is
// accepted, so an attacker without a matching on-chain state transition can't
// get anything persisted, no matter what they submit.
// ---------------------------------------------------------------------------
merkleRouter.post("/update-leaf", writeLimiter, async (req: Request, res: Response): Promise<void> => {
  const { leafIndex, newCommitment, encNote } = req.body as {
    leafIndex?: number;
    newCommitment?: string;
    encNote?: string;
  };

  if (typeof leafIndex !== "number" || !Number.isInteger(leafIndex) || leafIndex < 0) {
    res.status(400).json({ error: "leafIndex must be a non-negative integer" });
    return;
  }
  if (!newCommitment || !COMMITMENT_RE.test(newCommitment)) {
    res.status(400).json({ error: "newCommitment must be a 64-char hex string" });
    return;
  }
  if (encNote !== undefined && !HEX_RE.test(encNote)) {
    res.status(400).json({ error: "encNote must be a hex string" });
    return;
  }
  if (!config.commitmentTreeId) {
    res.status(500).json({ error: "COMMITMENT_TREE_ID not configured; cannot validate leaf updates" });
    return;
  }

  const leaves = readLeaves();
  if (leafIndex >= leaves.length) {
    res.status(400).json({
      error: `leafIndex ${leafIndex} out of range - leaf store has ${leaves.length} leaves`,
    });
    return;
  }

  const candidate = [...leaves];
  candidate[leafIndex] = BigInt("0x" + newCommitment);
  const candidateRoot = computeRoot(candidate);

  let onChainRoot: bigint;
  try {
    onChainRoot = await fetchOnChainRoot();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(502).json({ error: message });
    return;
  }

  if (candidateRoot !== onChainRoot) {
    res.status(409).json({
      error:
        "This update does not reproduce the current on-chain Merkle root - " +
        "either it doesn't correspond to a real confirmed borrow/repay, or " +
        "the local leaf store has drifted and needs an operator resync.",
      onChainRoot: onChainRoot.toString(16).padStart(64, "0"),
      candidateRoot: candidateRoot.toString(16).padStart(64, "0"),
    });
    return;
  }

  writeLeaves(candidate);
  if (encNote) saveNote(leafIndex, encNote);

  res.json({ newRoot: candidateRoot.toString() });
});

// ---------------------------------------------------------------------------
// GET /notes
//
// Returns every sealed recovery note with its leaf index and current
// commitment. A client trial-decrypts each note with its viewing key to
// rebuild its positions on a fresh device (#18). Notes are sealed (x25519 +
// ChaCha20-Poly1305), so this endpoint leaks nothing about amounts or owners.
// ---------------------------------------------------------------------------
merkleRouter.get("/notes", (_req: Request, res: Response): void => {
  const leaves = readLeaves();
  const notes = readNotes().map((n) => ({
    leafIndex: n.leafIndex,
    encNote: n.encNote,
    commitment:
      n.leafIndex < leaves.length ? leaves[n.leafIndex].toString(16).padStart(64, "0") : null,
  }));
  res.json({ notes });
});
