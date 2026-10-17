/**
 * BabyJubJub arithmetic for opening keeper notes (#212).
 *
 * Every borrow and repay proof encrypts the new position's liquidation witness
 * to the keeper's BabyJubJub key (circuits/src/position.circom, KeeperNote):
 *   eph_pub = eph_sk · B8,  shared = eph_sk · keeper_pub,
 *   ct[i]   = msg[i] + Poseidon(shared.x, shared.y, i)
 * The keeper recomputes `shared = keeper_sk · eph_pub` and strips the pads.
 * Twisted Edwards form, a = 168700, d = 168696, over the BN254 scalar field -
 * the same curve and formulas as circomlib's babyjub.
 */
import { poseidon3, poseidon5 } from "poseidon-lite";

export const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const A = 168700n;
const D = 168696n;

/** circomlib's Base8. */
export const BASE8: Point = [
  5299619240641551281634865583518297030282874472190772894086521144482721001553n,
  16950150798460657717958625567821834550301663161624707787222815936182638968203n,
];

export type Point = [bigint, bigint];

const mod = (x: bigint) => ((x % P) + P) % P;

function inv(x: bigint): bigint {
  // Fermat: x^(p-2).
  let result = 1n;
  let base = mod(x);
  let e = P - 2n;
  while (e > 0n) {
    if (e & 1n) result = (result * base) % P;
    base = (base * base) % P;
    e >>= 1n;
  }
  return result;
}

export function addPoints([x1, y1]: Point, [x2, y2]: Point): Point {
  const t = mod(D * x1 * x2 * y1 * y2);
  const x3 = mod((x1 * y2 + y1 * x2) * inv(1n + t));
  const y3 = mod((y1 * y2 - A * x1 * x2) * inv(1n - t));
  return [x3, y3];
}

export function mulPoint(p: Point, k: bigint): Point {
  let result: Point = [0n, 1n];
  let addend = p;
  let e = k;
  while (e > 0n) {
    if (e & 1n) result = addPoints(result, addend);
    addend = addPoints(addend, addend);
    e >>= 1n;
  }
  return result;
}

export function onCurve([x, y]: Point): boolean {
  const x2 = mod(x * x);
  const y2 = mod(y * y);
  return mod(A * x2 + y2) === mod(1n + D * x2 * y2);
}

/** The keeper's public key for its secret scalar. */
export function keeperPublicKey(sk: bigint): Point {
  return mulPoint(BASE8, sk);
}

export interface KeeperPosition {
  liqKey: bigint;
  nonce: bigint;
  collateralSats: bigint;
  debtStroops: bigint;
  timelockHeight: number;
}

const mask = (bits: number) => (1n << BigInt(bits)) - 1n;

/**
 * Opens a keeper note: [eph_x, eph_y, ct0, ct1, ct2]. Returns null when the
 * note is malformed, when the ephemeral key is not on the curve, or when the
 * opened values do not rebuild `commitment` - a note addressed to another key
 * opens to noise, and noise never hashes to the leaf.
 */
export function openKeeperNote(keeperSk: bigint, note: bigint[], commitment: bigint): KeeperPosition | null {
  if (note.length !== 5) return null;
  const eph: Point = [note[0]!, note[1]!];
  if (!onCurve(eph)) return null;
  const [sx, sy] = mulPoint(eph, keeperSk);
  const [liqKey, nonce, packed] = [0, 1, 2].map((i) => mod(note[2 + i]! - poseidon3([sx, sy, BigInt(i)])));
  const collateralSats = packed! & mask(52);
  const debtStroops = (packed! >> 52n) & mask(120);
  const timelock = packed! >> 172n;
  if (timelock > mask(32)) return null;
  if (poseidon5([collateralSats, debtStroops, liqKey!, nonce!, timelock]) !== commitment) return null;
  return { liqKey: liqKey!, nonce: nonce!, collateralSats, debtStroops, timelockHeight: Number(timelock) };
}
