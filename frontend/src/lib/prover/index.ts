import { groth16, type Groth16ProofJSON } from "snarkjs";
import { Buffer } from "buffer";

/**
 * In-browser Groth16 proving. Inputs include the user's private witness, so
 * proofs are generated locally and never sent to a server. Artifacts (the
 * compiled `.wasm` circuit and `.zkey` proving key) are served from
 * `public/circuits/` and fetched at prove time.
 *
 * Output is shaped for the generated contract bindings: `pi_a`/`pi_c` are
 * 64-byte G1 points, `pi_b` is a 128-byte G2 point, and each public signal is a
 * 32-byte big-endian value — matching `zk-verifier`'s expectations.
 */

type Circuit = "deposit" | "borrow_repay" | "liquidation";

const ARTIFACTS: Record<Circuit, { wasm: string; zkey: string }> = {
  deposit: { wasm: "/circuits/deposit.wasm", zkey: "/circuits/deposit_final.zkey" },
  borrow_repay: {
    wasm: "/circuits/borrow_repay.wasm",
    zkey: "/circuits/borrow_repay_final.zkey",
  },
  liquidation: {
    wasm: "/circuits/liquidation.wasm",
    zkey: "/circuits/liquidation_final.zkey",
  },
};

function feToBytes(dec: string): Buffer {
  return Buffer.from(BigInt(dec).toString(16).padStart(64, "0"), "hex");
}

// G1 point → 64 bytes (X || Y).
function g1(point: string[]): Buffer {
  return Buffer.concat([feToBytes(point[0]), feToBytes(point[1])]);
}

// G2 point → 128 bytes (X.c1 || X.c0 || Y.c1 || Y.c0).
function g2(point: string[][]): Buffer {
  return Buffer.concat([
    feToBytes(point[0][1]),
    feToBytes(point[0][0]),
    feToBytes(point[1][1]),
    feToBytes(point[1][0]),
  ]);
}

/** Proof shaped for the generated bindings' `Proof` type. */
export interface ContractProof {
  pi_a: { bytes: Buffer };
  pi_b: { bytes: Buffer };
  pi_c: { bytes: Buffer };
}

export interface ProofResult {
  proof: ContractProof;
  publicSignals: Buffer[];
  /** Raw snarkjs outputs, useful for local verification/debugging. */
  raw: { proof: Groth16ProofJSON; publicSignals: string[] };
}

function toContractProof(proof: Groth16ProofJSON): ContractProof {
  return {
    pi_a: { bytes: g1(proof.pi_a) },
    pi_b: { bytes: g2(proof.pi_b) },
    pi_c: { bytes: g1(proof.pi_c) },
  };
}

async function prove(
  circuit: Circuit,
  input: Record<string, unknown>,
): Promise<ProofResult> {
  const { wasm, zkey } = ARTIFACTS[circuit];
  const { proof, publicSignals } = await groth16.fullProve(input, wasm, zkey);
  return {
    proof: toContractProof(proof),
    publicSignals: publicSignals.map(feToBytes),
    raw: { proof, publicSignals },
  };
}

// ── Typed circuit inputs (field values as decimal strings) ──────────────────

export interface DepositInput {
  collateral_satoshis: string;
  secret: string;
  nonce: string;
  btc_txid_lo: string;
  btc_txid_hi: string;
  min_deposit_satoshis: string;
}

export interface BorrowRepayInput {
  collateral_satoshis: string;
  old_debt_stroops: string;
  secret: string;
  nonce: string;
  new_nonce: string;
  path_elements: string[];
  path_indices: Array<string | number>;
  old_root: string;
  delta_stroops: string;
  is_borrow: string | number;
  btc_price_stroops_per_btc: string;
  min_ratio_bp: string;
}

export interface LiquidationInput {
  collateral_satoshis: string;
  debt_stroops: string;
  secret: string;
  nonce: string;
  path_elements: string[];
  path_indices: Array<string | number>;
  merkle_root: string;
  btc_price_stroops_per_btc: string;
  liquidation_threshold_bp: string;
}

const asInput = (i: object) => i as unknown as Record<string, unknown>;

export const proveDeposit = (input: DepositInput) =>
  prove("deposit", asInput(input));
export const proveBorrowRepay = (input: BorrowRepayInput) =>
  prove("borrow_repay", asInput(input));
export const proveLiquidation = (input: LiquidationInput) =>
  prove("liquidation", asInput(input));
