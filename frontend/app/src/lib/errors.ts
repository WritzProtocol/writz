/**
 * Maps raw errors (contract error variant names embedded in Soroban simulation
 * failures, relayer HTTP errors, or plain thrown strings) to plain-language
 * messages with a suggested next step. Falls back to the raw message if
 * nothing matches, so an unrecognized error is never swallowed - the user
 * just sees the underlying text instead of a friendlier one.
 *
 * Extends the pattern already used in LenderPanel's local `friendlyError` -
 * shared here so every flow (deposit, borrow, repay, recover, release, lend)
 * benefits instead of re-deriving it per component.
 */

import { GITHUB_ISSUES_URL } from "@/lib/links";

const REPORT = GITHUB_ISSUES_URL;

export interface ErrorContext {
  /** Which flow the error came from, when the same contract error code needs different wording per flow. */
  flow?:
    | "deposit"
    | "borrow"
    | "repay"
    | "release"
    | "recover"
    | "lend"
    | "withdraw"
    | "earn-deposit"
    | "earn-withdraw";
  /** USDC available in the pool, for InsufficientLiquidity. */
  availableUsdc?: string;
  /** Caller's own supplied balance, for WithdrawExceedsBalance. */
  ownBalanceUsdc?: string;
  /** Caller's spendable wallet USDC, for a deposit larger than they hold. */
  walletUsdc?: string;
}

interface Rule {
  pattern: RegExp;
  message: (ctx: ErrorContext) => string;
}

const RULES: Rule[] = [
  // --- Network / relayer infrastructure ---
  {
    pattern: /NEXT_PUBLIC_RELAYER_URL is not configured/,
    message: () =>
      `This app can't reach the Writz relayer, so nothing was sent. Try again later. If it keeps happening, report it on GitHub: ${REPORT}.`,
  },
  {
    pattern: /Relayer unreachable/,
    message: () =>
      "We can't reach the relayer that tracks your Bitcoin confirmations right now. We'll keep retrying automatically - you don't need to do anything, but if this persists for more than a few minutes, your transaction is still safe on Bitcoin and you can check its status on a block explorer.",
  },
  {
    pattern: /SPV proof not available after maximum wait/,
    message: () =>
      "We stopped waiting for your Bitcoin transaction after the maximum wait time, but your BTC is still safely on Bitcoin. Refresh and try depositing again with the same txid once your transaction has enough confirmations - nothing was lost.",
  },
  {
    pattern: /Merkle insertion failed/,
    message: () =>
      `Your deposit is recorded on Stellar, but the last step failed, so you can't borrow against it yet. Your BTC is still locked and safe. Report it on GitHub with your Stellar transaction: ${REPORT}.`,
  },
  {
    pattern: /Failed to fetch notes/,
    message: () =>
      "We couldn't reach the relayer to scan for your positions. Check your connection and try 'Recover positions' again in a moment.",
  },
  {
    pattern: /Relayer error \d+/,
    message: () =>
      "The relayer returned an unexpected error. Nothing was submitted on-chain - it's safe to try again.",
  },

  // --- Wallet / input validation (already fairly clear, kept as-is via fallback) ---

  // --- ZK / local consistency ---
  {
    pattern: /Commitment mismatch/,
    message: () =>
      `This browser computed different deposit data than expected, so nothing was sent. Don't retry. Report it on GitHub with the BTC amount you entered: ${REPORT}.`,
  },

  // --- CommitmentTreeError ---
  {
    pattern: /InvalidZkProof/,
    message: (ctx) =>
      ctx.flow === "borrow" || ctx.flow === "repay"
        ? "The proof your browser generated for this action wasn't accepted on-chain. This is usually a transient client-side issue - try again. If it keeps happening, your position data may be out of sync; try 'Recover positions' first."
        : `Stellar didn't accept this deposit. Nothing changed. Try once more. If it fails again, report it on GitHub: ${REPORT}.`,
  },
  {
    pattern: /RootMismatch/,
    message: () =>
      "Your position tree changed while your transaction was in flight (someone else's deposit/borrow/repay landed first). This is expected under concurrent activity - just try again; your funds are unaffected.",
  },
  {
    pattern: /NullifierAlreadySpent/,
    message: () =>
      "This position has already been updated by a more recent transaction (possibly from another tab or device). Refresh the page - you're likely looking at stale local data, not a lost transaction.",
  },
  {
    pattern: /DuplicateDeposit/,
    message: () =>
      "A deposit for this exact Bitcoin transaction has already been processed. If you don't see it in your positions, try 'Recover positions' - it may already be linked to your wallet.",
  },
  {
    pattern: /CommitmentNotFound/,
    message: () =>
      "We couldn't find this position on-chain - it may not have finished depositing yet. Wait a moment and refresh; if the deposit step showed success, your funds are safe regardless.",
  },
  {
    pattern: /InsufficientLiquidity/,
    message: (ctx) =>
      ctx.availableUsdc
        ? `Only ${ctx.availableUsdc} USDC is available in the pool right now - the rest is currently borrowed by others. Try a smaller amount.`
        : "The USDC pool doesn't have enough available liquidity for this right now - the rest is currently borrowed. Try a smaller amount.",
  },
  {
    pattern: /WrongCircuitMode/,
    message: () =>
      `The app prepared the wrong kind of transaction. Nothing changed. Refresh and try again. If it repeats, report it on GitHub: ${REPORT}.`,
  },
  {
    pattern: /ProtocolParamMismatch/,
    message: () =>
      "The protocol's parameters (collateral ratio, liquidation threshold, or similar) changed between when your proof was generated and when it was submitted. Refresh the page and try again with current parameters.",
  },
  {
    pattern: /PriceMismatch/,
    message: () =>
      "The BTC/USD price used to generate your proof is no longer the current oracle price - prices update frequently. Try again; your browser will use the latest price.",
  },
  {
    pattern: /TxidMismatch/,
    message: () =>
      "The Bitcoin transaction in your proof doesn't match the one verified via SPV. Double-check you entered the correct txid for this deposit.",
  },
  {
    pattern: /SignalOverflow/,
    message: () =>
      "One of the values in your proof is out of the supported range. This usually means an unrealistic amount was entered - check your deposit/borrow amount.",
  },
  {
    pattern: /WithdrawExceedsBalance/,
    message: (ctx) =>
      ctx.ownBalanceUsdc
        ? `You can withdraw at most ${ctx.ownBalanceUsdc} USDC - that's your full supplied balance.`
        : "You're trying to withdraw more than you've supplied to the pool.",
  },

  // --- SPVError (Bitcoin verification) ---
  {
    pattern: /InsufficientConfirmations/,
    message: () =>
      "Your Bitcoin transaction doesn't have enough confirmations yet. Wait for the confirmation count shown above to reach the required minimum, then try again - no need to resend anything.",
  },
  {
    pattern: /HeaderChainBroken|InvalidHeaderSlice/,
    message: () =>
      `The Bitcoin data from the Writz relayer failed a check. Your transaction is fine and your BTC is safe. Don't send it again. Report it on GitHub with your transaction ID: ${REPORT}.`,
  },
  {
    pattern: /MerkleProofInvalid/,
    message: () =>
      `Your transaction couldn't be matched to its Bitcoin block yet. Wait for one more confirmation and try again. Don't send BTC again. If it keeps failing, report it on GitHub: ${REPORT}.`,
  },
  {
    pattern: /InsufficientProofOfWork|InvalidDifficultyBits|DifficultyBelowCheckpointFloor/,
    message: () =>
      `The Bitcoin data from the Writz relayer failed a check. Your transaction is fine and your BTC is safe. Don't send it again. Report it on GitHub with your transaction ID: ${REPORT}.`,
  },
  {
    pattern: /CheckpointNotSet|NotInitialized/,
    message: () =>
      "Bitcoin verification on Stellar isn't ready right now. Nothing was sent. Try again later.",
  },

  // --- One transaction at a time per account ---
  {
    pattern: /TxLockBusy/,
    message: () => "Waiting for your other transaction. Try again when it finishes.",
  },

  // --- Wallet signature ---
  {
    pattern: /SignatureRejected/,
    message: () =>
      "You declined the signature, so nothing was submitted and no funds moved. Enter the amount again whenever you're ready.",
  },

  // --- Earn: submission and confirmation ---
  {
    pattern: /SubmissionThrottled/,
    message: () =>
      "The network is refusing new transactions right now and did not accept yours. Nothing was submitted and no funds moved - try again in a moment.",
  },
  {
    pattern: /ConfirmationTimedOut/,
    message: () =>
      "Your transaction was signed and submitted, but we stopped waiting before the network confirmed it. It may still land. Do not send it again - refresh in a minute and check your balance first.",
  },

  // --- Earn: DeFindex vault ContractError (see integration-research/defindex.md) ---
  {
    pattern: /AmountNotAllowed/,
    message: () => "The vault rejected that amount. Enter a positive amount and try again.",
  },
  {
    pattern: /InsufficientAmount/,
    message: (ctx) =>
      ctx.flow === "earn-deposit"
        ? "That deposit is too small for the vault to issue any shares for it. Try a larger amount."
        : "The amount is below the vault's minimum for this operation. Try a larger amount.",
  },
  {
    pattern: /AmountOverTotalSupply/,
    message: () =>
      "You're trying to withdraw more shares than the vault has issued. Refresh to reload your position - the balance shown is likely stale.",
  },
  {
    pattern: /InsufficientOutputAmount/,
    message: () =>
      "The vault's price moved while your withdrawal was in flight, so it would have paid out less than the slippage limit allows. Nothing was withdrawn - try again.",
  },
  {
    pattern: /StrategyPaused|StrategyPausedOrNotFound/,
    message: () =>
      "The vault's yield strategy is paused right now, so deposits can't be invested. Your existing balance is unaffected - try again later.",
  },
  {
    pattern: /StrategyWithdrawError|StrategyInvestError/,
    message: () =>
      `Blend couldn't process this. Nothing moved. Try again. If it keeps failing, report it on GitHub: ${REPORT}.`,
  },
  {
    pattern: /StrategyDoesNotSupportAsset|WrongAssetAddress/,
    message: () =>
      `This app is set up with the wrong asset for the vault. Nothing moved. Report it on GitHub: ${REPORT}.`,
  },

  // --- Generic contract-level ---
  {
    pattern: /Unauthorized/,
    message: () =>
      "This action isn't authorized from the connected wallet. Make sure you're connected with the same wallet that owns this position.",
  },
];

/**
 * Convert a raw error (Error instance, thrown string, or contract error
 * substring) into a plain-language message with a suggested next step.
 * Returns the original message when no rule matches, so nothing is hidden.
 */
export function humanizeError(raw: unknown, ctx: ErrorContext = {}): string {
  const message = raw instanceof Error ? raw.message : String(raw);
  for (const rule of RULES) {
    if (rule.pattern.test(message)) return rule.message(ctx);
  }
  return message;
}
