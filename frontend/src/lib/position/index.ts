import { computeCommitment, computeNullifier } from "./crypto";
import { seedToField, deriveSecret, deriveNonce } from "./derive";
import type { Position } from "./types";

export * from "./types";
export * from "./crypto";
export * from "./store";
export * from "./derive";
export * from "./notes";

/**
 * Derive a position's spending keys from the in-memory session seed. The secret
 * is fixed per `index`; the nonce rotates with `version`.
 */
export function positionKeys(
  seed: Uint8Array,
  p: Pick<Position, "index" | "version">,
): { secret: bigint; nonce: bigint } {
  const f = seedToField(seed);
  return { secret: deriveSecret(f, p.index), nonce: deriveNonce(f, p.index, p.version) };
}

/**
 * Create a fresh position for a new deposit (debt 0, version 0) with keys derived
 * from the session seed at `index`. Not yet persisted — the caller stamps
 * `txid`/`leafIndex` and calls `savePosition`.
 */
export function createDepositPosition(args: {
  owner: string;
  collateralSats: bigint;
  seed: Uint8Array;
  index: number;
  txid?: string | null;
  createdAt: number;
}): Position {
  const f = seedToField(args.seed);
  const secret = deriveSecret(f, args.index);
  const nonce = deriveNonce(f, args.index, 0);
  const debt = 0n;
  const commitment = computeCommitment(args.collateralSats, debt, secret, nonce);
  const nullifier = computeNullifier(secret, nonce);

  return {
    id: commitment.toString(),
    owner: args.owner,
    txid: args.txid ?? null,
    collateralSats: args.collateralSats.toString(),
    debtStroops: debt.toString(),
    index: args.index,
    version: 0,
    commitment: commitment.toString(),
    nullifier: nullifier.toString(),
    status: "pending",
    createdAt: args.createdAt,
  };
}

/** Private witness fields a position contributes to a ZK proof (decimal strings). */
export interface PositionWitness {
  collateral_satoshis: string;
  debt_stroops: string;
  secret: string;
  nonce: string;
}

/** Extract the private witness for proving (derives keys from the session seed). */
export function positionWitness(seed: Uint8Array, p: Position): PositionWitness {
  const { secret, nonce } = positionKeys(seed, p);
  return {
    collateral_satoshis: p.collateralSats,
    debt_stroops: p.debtStroops,
    secret: secret.toString(),
    nonce: nonce.toString(),
  };
}
