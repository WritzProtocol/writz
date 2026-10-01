/**
 * UI mock mode, for screenshots and design review only. Off unless
 * NEXT_PUBLIC_UI_MOCK=1; the scenario comes from the URL query, e.g.
 *   /?w=both&unlocked=1&deposit=polling&borrow=error&trust=1&vault=1
 *
 *   w         none | stellar | both     which wallets look connected
 *   unlocked  0 | 1                     position keys derived (default 1)
 *   deposit   idle|address|sending|polling|proving|depositing|inserting|done|error
 *   borrow / repay / release / supply / withdraw / earnDeposit / earnWithdraw
 *             idle | working | done | error
 *   trust     0 | 1                     USDC trustline present (default 1)
 *   vault     0 | 1                     Earn vault position (default 1)
 *   balance   0 | 1                     wallet USDC balance (default 1)
 *   readfail  1                         contract reads on the overview fail
 */
export const MOCK = process.env.NEXT_PUBLIC_UI_MOCK === "1";

export function mockParam(key: string): string | null {
  if (!MOCK || typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

export type MockStatus = "idle" | "working" | "done" | "error";

export function mockStatus(key: string): MockStatus | null {
  const v = mockParam(key);
  return v === "idle" || v === "working" || v === "done" || v === "error" ? v : null;
}

const STROOP = 10_000_000n;

export const MOCK_STELLAR_ADDRESS = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
export const MOCK_BTC_ADDRESS = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
// secp256k1 generator point: a valid compressed pubkey, so the P2WSH address derives.
export const MOCK_BTC_PUBKEY = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
export const MOCK_SEED = new Uint8Array(32).map((_, i) => (i * 37 + 11) % 256);
export const MOCK_STELLAR_TX = "9a4f2c1e7b3d5a8f0c6e2b9d4a7f1c3e5b8d0a2f4c6e8b1d3a5f7c9e2b4d6a8f";
export const MOCK_BTC_TXID = "3b1f8e2a6c4d9b7f0a5e3c1d8b6f4a2e9c7d5b3f1a8e6c4d2b0f9a7e5c3d1b8f";

export const MOCK_ERRORS: Record<string, string> = {
  deposit: "The relayer has not seen enough confirmations for this transaction yet. Try again in a few minutes.",
  borrow: "Borrowing this much would drop the position below the 150% collateral ratio.",
  repay: "Your wallet does not hold enough USDC to repay this amount.",
  release: "Co-sign failed: the zero-debt proof did not verify against the current Merkle root.",
  supply: "Your wallet does not hold enough USDC to supply this amount.",
  withdraw: "The pool does not have enough idle liquidity to withdraw this amount right now.",
  earnDeposit: "The vault rejected the deposit: InsufficientAmount.",
  earnWithdraw: "The vault rejected the withdrawal: InsufficientBalance.",
};

export const MOCK_WORKING: Record<string, string> = {
  release: "Generating zero-debt proof (this may take ~30 s)…",
};

export const mockPool = {
  totalSupplied: 184_250n * STROOP,
  totalBorrowed: 61_430n * STROOP,
  available: (184_250n - 61_430n) * STROOP,
};

export const MOCK_MERKLE_ROOT = "1b7c0e9f4a2d6c8e3f5a7b9d1c3e5f7a9b2d4c6e8f0a1c3e5b7d9f2a4c6e8b0d";

export const mockSupplyBalance = () => (mockParam("balance") === "0" ? 0n : 2_500n * STROOP);
export const mockHasTrustline = () => mockParam("trust") !== "0";
export const mockAssetBalance = () =>
  mockParam("trust") === "0" ? null : mockParam("balance") === "0" ? 0n : 1_240n * STROOP + 5_000_000n;
export const mockApy = 0.0731;
export const mockVaultPosition = () =>
  mockParam("vault") === "0"
    ? { dfTokens: 0n, underlyingStroops: 0n }
    : { dfTokens: 9_812_345_678n, underlyingStroops: 1_003n * STROOP + 4_120_000n };
