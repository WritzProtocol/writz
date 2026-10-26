/**
 * Maps raw errors (contract failures, relayer HTTP errors, wallet errors,
 * thrown strings) to a message with three parts: what
 * happened, whether money moved, and what to do next. The raw text always
 * travels with it for the "Technical details" disclosure, so nothing is hidden
 * from a bug report.
 */

import { config } from "@/config";
import { GITHUB_ISSUES_URL } from "@/lib/links";
import { errorMessage, walletLabel } from "@/lib/wallet/rejection";
import { networkName, WrongNetworkError } from "@/lib/wallet/precheck";
import { resolveContractError, type ContractFailure, type ContractName } from "./contract";

export type ErrorFlow =
  | "deposit"
  | "borrow"
  | "repay"
  | "release"
  | "recover"
  | "lend"
  | "withdraw"
  | "earn-deposit"
  | "earn-withdraw"
  | "trustline"
  | "read";

export interface ErrorContext {
  /** Which flow the error came from, when the same error needs different wording per flow. */
  flow?: ErrorFlow;
  /** USDC available in the pool, for InsufficientLiquidity. */
  availableUsdc?: string;
  /** Caller's own supplied balance, for WithdrawExceedsBalance. */
  ownBalanceUsdc?: string;
  /** Caller's spendable wallet USDC, for a deposit larger than they hold. */
  walletUsdc?: string;
}

export interface ErrorLink {
  label: string;
  href: string;
}

export interface FriendlyError {
  /** What happened. */
  headline: string;
  /** Whether anything moved. */
  safety?: string;
  /** What to do next. */
  action?: string;
  /** A support route: always, or only if the action does not help. */
  report?: "always" | "if_repeats";
  link?: ErrorLink;
  /** The raw message, for "Technical details". */
  raw: string;
  /** The contract failure the raw message was mapped from, if any. */
  contract?: ContractFailure;
}

type Parts = Omit<FriendlyError, "raw" | "contract">;

interface Rule {
  match: RegExp;
  /** Only for a failure raised by this contract (rules without it also match raw text). */
  contract?: ContractName;
  build: (ctx: ErrorContext, subject: string, error: unknown) => Parts;
}

const NETWORK = networkName(config.networkPassphrase);
const ON_TESTNET = config.target !== "mainnet";
const FUND_LINK: ErrorLink | undefined = ON_TESTNET
  ? { label: "Fund with Friendbot", href: "https://lab.stellar.org/account/fund?$=network$id=testnet" }
  : undefined;

const BTC_DATA_CHECK: Parts = {
  headline: "The Bitcoin data from the Writz relayer failed a check.",
  safety: "Your transaction is fine and your BTC is safe.",
  action: "Don't send it again.",
  report: "always",
};

const NOT_READY: Parts = {
  headline: `Bitcoin verification on ${NETWORK} isn't ready right now.`,
  safety: "Nothing was sent.",
  action: "Try again later.",
};

function setupNoun(flow?: ErrorFlow): string {
  switch (flow) {
    case "deposit":
      return "deposits";
    case "release":
      return "releases";
    case "borrow":
    case "repay":
      return "loans";
    case "lend":
    case "withdraw":
      return "the pool";
    case "earn-deposit":
    case "earn-withdraw":
      return "the vault";
    case "trustline":
      return "USDC";
    default:
      return "this";
  }
}

function flowSafety(flow?: ErrorFlow): string {
  if (flow === "deposit" || flow === "release") return "Your BTC is safe in its lock.";
  if (flow === "lend" || flow === "withdraw" || flow === "earn-deposit" || flow === "earn-withdraw") {
    return "No USDC moved.";
  }
  return "Nothing was sent.";
}

const RULES: Rule[] = [
  // --- Wallet and account readiness ---
  {
    match: /^SignatureRejected$/,
    build: (_ctx, _s, error) => ({
      headline: `You declined in ${walletLabel(error)}.`,
      safety: "Nothing was sent.",
      action: "Sign again when you're ready.",
    }),
  },
  {
    match: /^WrongNetwork$/,
    build: (_ctx, _s, error) => {
      const e = error instanceof WrongNetworkError ? error : null;
      const on = e ? networkName(e.walletPassphrase) : "another network";
      return {
        headline: `Your wallet is on ${on}. Writz runs on ${NETWORK}.`,
        safety: "Nothing was sent.",
        action: `Switch network in ${e?.walletName ?? "your wallet"}, then try again.`,
      };
    },
  },
  {
    match: /^AccountUnfunded$|Account not found/,
    build: () => ({
      headline: "This Stellar account isn't funded yet.",
      safety: "Nothing was sent.",
      action: ON_TESTNET ? "Fund it with Friendbot, then try again." : "Add XLM to it, then try again.",
      link: FUND_LINK,
    }),
  },
  {
    match: /^LowXlm$|op_low_reserve|tx_insufficient_balance|txInsufficientBalance|opLowReserve/,
    build: () => ({
      headline: "Not enough XLM for this transaction.",
      safety: "Nothing was sent.",
      action: ON_TESTNET ? "Add XLM with Friendbot, then try again." : "Add XLM, then try again.",
      link: FUND_LINK,
    }),
  },
  {
    match: /^XverseError: /,
    build: (ctx) => ({
      headline: "Xverse didn't respond.",
      safety: ctx.flow === "release" ? "Your BTC is still locked." : "Nothing was sent.",
      action: "Open Xverse and try again.",
    }),
  },
  {
    match: /Connection rejected in your Bitcoin wallet/,
    build: () => ({
      headline: "You declined in Xverse.",
      safety: "Nothing was sent.",
      action: "Connect again when you're ready.",
    }),
  },

  // --- Configuration ---
  {
    match: /NEXT_PUBLIC_\w+ (is )?not configured|Missing contract address|No issuer configured/,
    build: (ctx) => ({
      headline: `This app isn't set up for ${setupNoun(ctx.flow)} right now.`,
      safety: "Nothing was sent.",
      report: "always",
    }),
  },

  // --- Writz relayer ---
  {
    match: /Relayer unreachable/,
    build: (ctx) =>
      ctx.flow === "read"
        ? {
            headline: "Can't reach the Writz relayer right now.",
            safety: "Your funds are not affected.",
            action: "Try again in a minute.",
          }
        : {
            headline: "Can't reach the Writz relayer.",
            safety: flowSafety(ctx.flow),
            action: "Try again in a minute.",
          },
  },
  {
    match: /out of sync/i,
    build: () => ({
      headline: "Writz is catching up with the chain.",
      safety: "Your funds are safe.",
      action: "Try again in a minute.",
    }),
  },
  {
    match: /Relayer error (\d+)/,
    build: (ctx, subject) => ({
      headline: `The Writz relayer returned an error (${/Relayer error (\d+)/.exec(subject)?.[1]}).`,
      safety: ctx.flow === "read" ? "Your funds are not affected." : "Nothing was sent.",
      action: "Try again.",
    }),
  },

  // --- Bitcoin release ---
  {
    match: /^ReleaseNotCosigned$/,
    build: () => ({
      headline: "Writz hasn't co-signed the release yet.",
      safety: "Your BTC is still locked and safe.",
      action: "Try again in a minute.",
      report: "if_repeats",
    }),
  },
  {
    match: /^ReleaseMismatch/,
    build: () => ({
      headline: "The release Writz prepared doesn't match this loan, so it was not sent to your wallet.",
      safety: "Your BTC is still locked and safe.",
      action: "Don't retry.",
      report: "always",
    }),
  },
  {
    match: /^LoanNotRepaid$/,
    build: () => ({
      headline: "This loan still has debt, so its BTC can't be released yet.",
      safety: "Your BTC is still locked and safe.",
      action: "Repay the loan in full, then release.",
    }),
  },
  {
    match: /Broadcast failed/,
    build: () => ({
      headline: "Bitcoin rejected the release.",
      safety: "Your BTC is still locked.",
      action: "Try again.",
      report: "if_repeats",
    }),
  },

  // --- Deposit input ---
  {
    match: /Bitcoin hasn't seen this transaction yet/,
    build: () => ({
      headline: "Bitcoin hasn't seen this transaction yet.",
      action: "If Xverse shows it as sent, wait a few more minutes and try again.",
    }),
  },
  {
    match: /does not pay your deposit address/,
    build: () => ({
      headline: "This transaction doesn't pay a Writz lock address for this Bitcoin wallet.",
      safety: "Nothing was sent.",
      action: "Check the ID.",
    }),
  },
  // --- Lending contracts ---
  {
    match: /^InsufficientLiquidity$/,
    build: (ctx) => {
      if (!ctx.availableUsdc) {
        return {
          headline: "The pool doesn't have enough USDC for this right now.",
          safety: "No USDC moved.",
          action: "Enter a smaller amount.",
        };
      }
      return ctx.flow === "withdraw"
        ? {
            headline: `Only ${ctx.availableUsdc} USDC can be withdrawn now because borrowers are using the rest.`,
            safety: "No USDC moved.",
            action: `Enter ${ctx.availableUsdc} or less, or try later.`,
          }
        : {
            headline: `The pool has ${ctx.availableUsdc} USDC available right now.`,
            safety: "No USDC moved.",
            action: `Enter ${ctx.availableUsdc} or less.`,
          };
    },
  },
  {
    match: /^ExceedsCollateralRatio$/,
    contract: "writz-lend",
    build: () => ({
      headline: "That would take this loan below the 150% borrow limit at the current BTC price.",
      safety: "No USDC moved.",
      action: "Enter a smaller amount.",
    }),
  },
  {
    match: /^ExposureCapExceeded$/,
    contract: "writz-lend",
    build: () => ({
      headline: "The pool has reached its borrowing limit for now.",
      safety: "No USDC moved.",
      action: "Enter a smaller amount, or try again later.",
    }),
  },
  {
    match: /^TimelockTooSoon$/,
    contract: "writz-lend",
    build: () => ({
      headline: "This deposit's Bitcoin lock opens in less than about 30 days, too soon to borrow against.",
      safety: "No USDC moved. Your BTC is safe in its lock.",
      action: "Repay what this loan owes, or make a new deposit with a later lock date to borrow.",
    }),
  },
  {
    match: /^StaleBitcoinTip$/,
    contract: "writz-lend",
    build: () => ({
      headline: "Writz can't confirm the latest Bitcoin block right now.",
      safety: "No USDC moved.",
      action: "Try again in a few minutes.",
      report: "if_repeats",
    }),
  },
  {
    match: /^RepayExceedsDebt$/,
    contract: "writz-lend",
    build: () => ({
      headline: "That's more than this loan owes right now.",
      safety: "No USDC moved.",
      action: "Refresh the loan and try again.",
    }),
  },
  {
    match: /^(OraclePriceUnavailable|OraclePriceStale)$/,
    contract: "writz-lend",
    build: () => ({
      headline: "The BTC price is unavailable right now.",
      safety: "Nothing changed.",
      action: "Try again in a few minutes.",
    }),
  },
  {
    match: /^PositionNotFound$/,
    contract: "writz-lend",
    build: () => ({
      headline: "This loan isn't on Stellar yet.",
      safety: "Nothing changed.",
      action: "If your deposit just finished, wait a minute and try again.",
    }),
  },
  {
    match: /^PositionNotActive$/,
    contract: "writz-lend",
    build: () => ({
      headline: "This loan is already closed.",
      safety: "Nothing changed.",
      action: "Refresh the loan to see where it stands.",
    }),
  },
  {
    match: /^PositionAlreadyExists$/,
    contract: "writz-lend",
    build: () => ({
      headline: "This Bitcoin transaction is already recorded as a deposit.",
      safety: "Your BTC is safe in its lock.",
      action: "Select Find my loans to load it.",
    }),
  },
  {
    match: /^InvalidKeyProof$/,
    contract: "writz-lend",
    build: () => ({
      headline: "The Bitcoin signature doesn't match the key this deposit is locked to.",
      safety: "Nothing changed. Your BTC is safe in its lock.",
      action: "Connect the Bitcoin wallet that sent this deposit, then try again.",
    }),
  },
  {
    match: /^(DepositTooSmall)$/,
    contract: "writz-lend",
    build: () => ({
      headline: "This deposit is below the minimum Writz accepts.",
      safety: "Your BTC is safe in its lock.",
      action: "Reclaim it after its lock date, then deposit at least the minimum.",
    }),
  },
  {
    match: /^(OutputNotFound|ScriptPubKeyMismatch|InvalidScriptPubKey|InvalidUserPubkey|InvalidTimelock|UserKeyIsProtocolKey)$/,
    contract: "writz-lend",
    build: () => ({
      headline: "Stellar didn't accept this deposit: it doesn't match a Writz lock for your Bitcoin key.",
      safety: "Nothing changed. Your BTC is safe in its lock.",
      action: "Check that the connected Bitcoin wallet sent this deposit.",
      report: "if_repeats",
    }),
  },
  {
    match: /^(SpvVerificationFailed|Overflow)$/,
    contract: "writz-lend",
    build: () => BTC_DATA_CHECK,
  },
  {
    match: /^Paused$/,
    build: () => ({
      headline: "Writz is paused for maintenance.",
      safety: "Nothing moved. Your BTC stays in its lock.",
      action: "Try again later.",
    }),
  },
  {
    match: /^WithdrawExceedsBalance$/,
    contract: "commitment-tree",
    build: (ctx) =>
      ctx.ownBalanceUsdc
        ? {
            headline: `You supplied ${ctx.ownBalanceUsdc} USDC.`,
            safety: "No USDC moved.",
            action: "Enter that or less.",
          }
        : {
            headline: "That's more than you supplied.",
            safety: "No USDC moved.",
            action: "Enter a smaller amount.",
          },
  },
  {
    match: /^Unauthorized$/,
    build: () => ({
      headline: "The connected wallet doesn't own this loan.",
      safety: "Nothing changed.",
      action: "Switch to the Stellar wallet you deposited with.",
    }),
  },
  {
    match: /^NotInitialized$/,
    contract: "writz-lend",
    build: () => ({
      headline: `Writz on ${NETWORK} isn't ready right now.`,
      safety: "Nothing was sent.",
      action: "Try again later.",
    }),
  },

  // --- Bitcoin SPV contract ---
  {
    match: /^InsufficientConfirmations$/,
    contract: "bitcoin-spv",
    build: () => {
      const m = config.bitcoin.minConfirmations;
      return {
        headline: `Your Bitcoin transaction has fewer than ${m} confirmation${m === 1 ? "" : "s"}.`,
        safety: "Your BTC is safe. Don't send BTC again.",
        action: `Wait until it reaches ${m}, then try again.`,
      };
    },
  },
  {
    match: /^MerkleProofInvalid$/,
    contract: "bitcoin-spv",
    build: () => ({
      headline: "Your transaction couldn't be matched to its Bitcoin block yet.",
      safety: "Your BTC is safe. Don't send BTC again.",
      action: "Wait for one more confirmation and try again.",
      report: "if_repeats",
    }),
  },
  {
    match:
      /^(NoHeaders|HeaderChainBroken|InvalidHeaderSlice|EmptyTransaction|InsufficientProofOfWork|InvalidDifficultyBits|DifficultyBelowCheckpointFloor|ZeroMinConfirmations)$/,
    contract: "bitcoin-spv",
    build: () => BTC_DATA_CHECK,
  },
  {
    match: /^(NotInitialized|CheckpointNotSet)$/,
    contract: "bitcoin-spv",
    build: () => NOT_READY,
  },

  // --- One transaction at a time per account ---
  {
    match: /TxLockBusy/,
    build: () => ({
      headline: "Waiting for your other transaction.",
      action: "Try again when it finishes.",
    }),
  },

  // --- Submission and confirmation ---
  {
    match: /SubmissionThrottled/,
    build: () => ({
      headline: `${NETWORK} is busy and didn't accept the transaction.`,
      safety: "Nothing moved.",
      action: "Try again in a minute.",
    }),
  },
  {
    match: /ConfirmationTimedOut/,
    build: () => ({
      headline: "Your transaction was sent but isn't confirmed yet. It may still go through.",
      safety: "Don't send it again.",
      action: "Refresh in a minute and check your balance.",
    }),
  },
  {
    match: /Transaction rejected by the network/,
    build: () => ({
      headline: `${NETWORK} rejected the transaction.`,
      safety: "Nothing moved.",
      action: "Try again.",
    }),
  },
  {
    match: /status code 5\d\d|\b(502|503|504) (Bad Gateway|Service Unavailable|Gateway Timeout)\b/i,
    build: () => ({
      headline: `Can't reach ${NETWORK} right now.`,
      safety: "Your funds are not affected.",
      action: "Try again.",
    }),
  },

  // --- Earn: DeFindex vault ContractError (names come from the relayer) ---
  {
    match: /AmountNotAllowed/,
    build: () => ({ headline: "Enter an amount above 0.", safety: "No USDC moved." }),
  },
  {
    match: /InsufficientAmount/,
    build: (ctx) => ({
      headline:
        ctx.flow === "earn-deposit"
          ? "That amount is too small for the vault."
          : "That amount is below the vault's minimum.",
      safety: "No USDC moved.",
      action: "Enter a larger amount.",
    }),
  },
  {
    match: /AmountOverTotalSupply/,
    build: () => ({
      headline: "That's more than your vault balance.",
      safety: "No USDC moved.",
      action: "Refresh to see your current balance, then try again.",
    }),
  },
  {
    match: /InsufficientOutputAmount/,
    build: () => ({
      headline: "The vault's share price moved, and you would have received less than expected.",
      safety: "Nothing was withdrawn.",
      action: "Try again.",
    }),
  },
  {
    match: /StrategyPaused|StrategyPausedOrNotFound/,
    build: (ctx) => ({
      headline: `The vault's Blend strategy is paused, so it can't ${
        ctx.flow === "earn-withdraw" ? "process withdrawals" : "take deposits"
      } right now.`,
      safety: "Your balance is safe.",
      action: "Try again later.",
    }),
  },
  {
    match: /StrategyWithdrawError|StrategyInvestError/,
    build: () => ({
      headline: "Blend couldn't process this.",
      safety: "Nothing moved.",
      action: "Try again.",
      report: "if_repeats",
    }),
  },
  {
    match: /StrategyDoesNotSupportAsset|WrongAssetAddress/,
    build: () => ({
      headline: "This app is set up with the wrong asset for the vault.",
      safety: "Nothing moved.",
      report: "always",
    }),
  },

  {
    match: /Transaction failed on-chain/,
    build: () => ({
      headline: `The transaction failed on ${NETWORK}.`,
      safety: "Nothing moved.",
      action: "Try again.",
    }),
  },
];

function fallback(ctx: ErrorContext): Parts {
  if (ctx.flow === "read") {
    return {
      headline: `Can't reach ${NETWORK} right now.`,
      safety: "Your funds are not affected.",
      action: "Try again in a minute.",
    };
  }
  return {
    headline: "Something went wrong and the action may not have gone through.",
    action: "Refresh the page before trying again.",
    report: "if_repeats",
  };
}

/** Builds the headline, safety line and next step for a raw error. */
export function describeError(error: unknown, ctx: ErrorContext = {}): FriendlyError {
  const raw = errorMessage(error);
  const onVault = ctx.flow === "earn-deposit" || ctx.flow === "earn-withdraw";
  const onPool = ctx.flow === "lend" || ctx.flow === "withdraw";
  const contract = onVault ? null : resolveContractError(raw, undefined, onPool ? "commitment-tree" : "writz-lend");
  const subject = contract?.variant ?? raw;
  for (const rule of RULES) {
    if (rule.contract && contract && rule.contract !== contract.contract) continue;
    if (!rule.match.test(subject)) continue;
    return { ...rule.build(ctx, subject, error), raw, contract: contract ?? undefined };
  }
  return { ...fallback(ctx), raw, contract: contract ?? undefined };
}

/** The message as one plain sentence block, for places that can only show text. */
export function humanizeError(error: unknown, ctx: ErrorContext = {}): string {
  const e = describeError(error, ctx);
  const report =
    e.report === "always"
      ? `Report it on GitHub: ${GITHUB_ISSUES_URL}`
      : e.report === "if_repeats"
        ? `If it keeps happening, report it on GitHub: ${GITHUB_ISSUES_URL}`
        : undefined;
  return [e.headline, e.safety, e.action, report && `${report}.`].filter(Boolean).join(" ");
}
