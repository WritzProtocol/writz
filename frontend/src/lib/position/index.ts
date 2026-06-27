import {
  computeCommitment,
  computeNullifier,
  randomFieldElement,
} from "./crypto";
import type { Position } from "./types";

export * from "./types";
export * from "./crypto";
export * from "./store";

/**
 * Create a fresh position for a new deposit: generate a random secret + nonce,
 * derive the commitment (debt = 0) and nullifier. The returned position is not
 * yet persisted — the caller stamps `txid` and calls `savePosition`.
 */
export function createDepositPosition(args: {
  owner: string;
  collateralSats: bigint;
  txid?: string | null;
  createdAt: number;
}): Position {
  const secret = randomFieldElement();
  const nonce = randomFieldElement();
  const debt = 0n;
  const commitment = computeCommitment(args.collateralSats, debt, secret, nonce);
  const nullifier = computeNullifier(secret, nonce);

  return {
    id: commitment.toString(),
    owner: args.owner,
    txid: args.txid ?? null,
    collateralSats: args.collateralSats.toString(),
    debtStroops: debt.toString(),
    secret: secret.toString(),
    nonce: nonce.toString(),
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

/** Extract the private witness for the proving step (borrow/repay flows). */
export function positionWitness(p: Position): PositionWitness {
  return {
    collateral_satoshis: p.collateralSats,
    debt_stroops: p.debtStroops,
    secret: p.secret,
    nonce: p.nonce,
  };
}
