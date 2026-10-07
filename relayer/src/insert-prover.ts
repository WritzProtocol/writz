/**
 * Groth16 proof for commitment-tree::insert_commitment (#211,
 * GHSA-prw2-j3jx-43qh). The contract no longer accepts a root from the admin;
 * it accepts a proof that the new root is the old one with the commitment
 * written into the next empty leaf. The relayer builds that proof from public
 * data only: the current leaves and the commitment.
 *
 * Circuit: circuits/src/insert.circom. Artifacts: relayer/circuits/insert.wasm
 * and insert_final.zkey, which must come from the same trusted setup as the
 * `Insert` verification key registered on zk-verifier
 * (test/insert-artifacts.test.ts checks them against circuits/keys/).
 */
import path from "path";
import { groth16, type Groth16ProofJSON } from "snarkjs";
import { computePath, computeRoot } from "./merkle.js";

const CIRCUITS_DIR = process.env["INSERT_CIRCUIT_DIR"] ?? path.resolve(__dirname, "../circuits");
export const INSERT_WASM = path.join(CIRCUITS_DIR, "insert.wasm");
export const INSERT_ZKEY = path.join(CIRCUITS_DIR, "insert_final.zkey");

export interface InsertCircuitInput {
  old_root: string;
  commitment: string;
  leaf_index: string;
  path_elements: string[];
}

/**
 * The circuit input that writes `commitment` into the empty leaf right after
 * `leaves`, plus the root the proof must produce.
 */
export function buildInsertInput(
  leaves: bigint[],
  commitment: bigint,
): { input: InsertCircuitInput; newRoot: bigint } {
  const leafIndex = leaves.length;
  // The path of an empty slot is the path of a zero leaf at that index.
  const { pathElements } = computePath([...leaves, 0n], leafIndex);
  return {
    input: {
      old_root: computeRoot(leaves).toString(),
      commitment: commitment.toString(),
      leaf_index: leafIndex.toString(),
      path_elements: pathElements.map(String),
    },
    newRoot: computeRoot([...leaves, commitment]),
  };
}

export interface ContractProof {
  pi_a: { bytes: Buffer };
  pi_b: { bytes: Buffer };
  pi_c: { bytes: Buffer };
}

const fe = (dec: string) => Buffer.from(BigInt(dec).toString(16).padStart(64, "0"), "hex");

/** snarkjs proof → the contract's Proof (G1: X || Y; G2: X.c1 || X.c0 || Y.c1 || Y.c0). */
export function toContractProof(proof: Groth16ProofJSON): ContractProof {
  const g1 = (p: string[]) => Buffer.concat([fe(p[0]!), fe(p[1]!)]);
  const g2 = (p: string[][]) => Buffer.concat([fe(p[0]![1]!), fe(p[0]![0]!), fe(p[1]![1]!), fe(p[1]![0]!)]);
  return { pi_a: { bytes: g1(proof.pi_a) }, pi_b: { bytes: g2(proof.pi_b) }, pi_c: { bytes: g1(proof.pi_c) } };
}

/**
 * Proves the insertion of `commitment` after `leaves`. Throws if the proof's
 * new root differs from the locally computed one, which would mean the leaf
 * store and the circuit disagree about the tree.
 */
export async function proveInsertion(
  leaves: bigint[],
  commitment: bigint,
): Promise<{ proof: ContractProof; publicSignals: Buffer[]; newRoot: bigint; leafIndex: number }> {
  const { input, newRoot } = buildInsertInput(leaves, commitment);
  // singleThread: snarkjs's worker pool crashes Bun, which the relayer runs on.
  const { proof, publicSignals } = await groth16.fullProve(
    input as unknown as Record<string, unknown>,
    INSERT_WASM,
    INSERT_ZKEY,
    undefined,
    {},
    { singleThread: true },
  );
  if (BigInt(publicSignals[0]!) !== newRoot) {
    throw new Error("insertion proof root does not match the leaf store's root");
  }
  return { proof: toContractProof(proof), publicSignals: publicSignals.map(fe), newRoot, leafIndex: leaves.length };
}
