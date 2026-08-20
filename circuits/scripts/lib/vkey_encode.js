'use strict';
/**
 * Shared point/hex encoding helpers for turning snarkjs verification-key
 * and proof output into the byte formats Writz's on-chain and off-chain
 * consumers expect.
 *
 * Extracted from `gen_test_vectors.js` so the ceremony export
 * script (`ceremony/04_export.js`) can produce the exact same
 * `VerificationKey{alpha_g1, beta_g2, gamma_g2, delta_g2, ic}` shape the
 * `zk-verifier` Soroban contract expects, without re-deriving or
 * duplicating this encoding a second time.
 */

// Convert a decimal string to a 32-byte big-endian hex string.
function decToHex32(s) {
  const n = BigInt(s);
  const hex = n.toString(16).padStart(64, '0');
  if (hex.length > 64) throw new Error(`Value too large: ${s}`);
  return hex;
}

// Convert a G1 point [x_dec, y_dec, "1"] to 64-byte hex.
// Format: be(x) || be(y) - Ethereum-compatible, matches G1Point in
// contracts/contracts/zk-verifier/src/types.rs.
function g1ToHex(point) {
  return decToHex32(point[0]) + decToHex32(point[1]);
}

// Convert a G2 point [[x0,x1],[y0,y1],["1","0"]] to 128-byte hex.
// Soroban / EIP-197 format: be(x.c1) || be(x.c0) || be(y.c1) || be(y.c0) -
// matches G2Point in contracts/contracts/zk-verifier/src/types.rs.
function g2ToHex(point) {
  const xc0 = point[0][0], xc1 = point[0][1];
  const yc0 = point[1][0], yc1 = point[1][1];
  return decToHex32(xc1) + decToHex32(xc0) + decToHex32(yc1) + decToHex32(yc0);
}

// Convert a hex string to a Rust byte array literal (used by gen_test_vectors.js).
function hexToRustBytes(hex, name, comment = '') {
  const bytes = hex.match(/.{2}/g).map((b) => `0x${b}`).join(', ');
  const commentLine = comment ? `    // ${comment}\n` : '';
  return `${commentLine}    pub const ${name}: [u8; ${hex.length / 2}] = [${bytes}];`;
}

/**
 * Converts a full snarkjs verification-key JSON object (as produced by
 * `snarkjs zkey export verificationkey`) into the plain-object shape the
 * `zk-verifier` Soroban contract's `set_verification_key` call expects:
 * hex strings for alpha_g1/beta_g2/gamma_g2/delta_g2, and an array of hex
 * strings for `ic`. Byte lengths match `G1Point`/`G2Point` exactly (64 and
 * 128 bytes respectively).
 */
function vkeyToContractShape(vkey) {
  return {
    alpha_g1: g1ToHex(vkey.vk_alpha_1),
    beta_g2: g2ToHex(vkey.vk_beta_2),
    gamma_g2: g2ToHex(vkey.vk_gamma_2),
    delta_g2: g2ToHex(vkey.vk_delta_2),
    ic: vkey.IC.map(g1ToHex),
  };
}

module.exports = {
  decToHex32,
  g1ToHex,
  g2ToHex,
  hexToRustBytes,
  vkeyToContractShape,
};
