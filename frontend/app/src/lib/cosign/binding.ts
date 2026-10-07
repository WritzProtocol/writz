/**
 * Pure binding checks for POST /api/cosign, isolated from the route's I/O
 * (Soroban RPC, KMS signing, PSBT parsing) so the security-critical
 * comparisons themselves are directly unit-testable.
 *
 * Before these checks existed, a valid zero-debt proof about position B
 * could authorize releasing position A's BTC: the proof carried no
 * indication of which position it was about (GHSA-6jmp-wf3x-3vxh), and
 * nothing tied the caller-claimed `commitment` to the PSBT's actual UTXO
 * (GHSA-9j8g-prh5-jhhj).
 */

export interface ReleaseBindingInput {
  /** zero_debt circuit's publicSignals, in order [commitment, nullifier, merkle_root]. */
  publicSignals: string[];
  /** The commitment hex string the caller claims to be releasing. */
  commitmentHex: string;
  /** The current on-chain Merkle root, as a hex string. */
  onChainRootHex: string;
  /** The real deposit txid (internal byte order) from the on-chain
   * DepositEvent for `commitmentHex` - undefined if none was found. */
  depositTxid: Buffer | undefined;
  /** The PSBT's input 0 outpoint hash (internal byte order). */
  psbtInputHash: Buffer | undefined;
}

export type ReleaseBindingResult = { ok: true } | { ok: false; error: string };

/** Verifies every binding the release flow needs, in order, short-circuiting
 * on the first failure. Does no I/O - callers fetch `onChainRootHex` and
 * `depositTxid` themselves. */
export function verifyReleaseBinding(input: ReleaseBindingInput): ReleaseBindingResult {
  const { publicSignals, commitmentHex, onChainRootHex, depositTxid, psbtInputHash } = input;

  const claimedCommitmentDecimal = BigInt("0x" + commitmentHex).toString();
  if (publicSignals[0] !== claimedCommitmentDecimal) {
    return {
      ok: false,
      error:
        "Proof commitment does not match the commitment this request " +
        "claims to release - this proof is for a different position",
    };
  }

  const onChainRootDecimal = BigInt("0x" + onChainRootHex).toString();
  if (publicSignals[2] !== onChainRootDecimal) {
    return {
      ok: false,
      error:
        "Proof merkle_root does not match the current on-chain root - " +
        "regenerate the proof against the latest tree state",
    };
  }

  if (!depositTxid) {
    return {
      ok: false,
      error:
        "No on-chain DepositEvent found for this commitment - it may be " +
        "too old for the RPC's event retention window, or was never deposited",
    };
  }

  if (!psbtInputHash || !psbtInputHash.equals(depositTxid)) {
    return {
      ok: false,
      error:
        "PSBT input does not spend the Bitcoin transaction that deposited " +
        "this commitment - this proof cannot authorize releasing this UTXO",
    };
  }

  return { ok: true };
}
