/**
 * Maps raw errors (contract failures, relayer HTTP errors, wallet errors,
 * thrown strings) to a message with three parts (ux-spec 12.3, 13.6): what
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

const WRONG_TX: Parts = {
  headline: "The app prepared the wrong kind of transaction.",
  safety: "Nothing changed.",
  action: "Try again.",
  report: "if_repeats",
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
    match: /Merkle insertion failed/,
    build: () => ({
      headline:
        "Your deposit is recorded on Stellar, but the last step failed, so you can't borrow against it yet.",
      safety: "Your BTC is still locked and safe.",
      action: "Select Finish deposit to try again.",
      report: "if_repeats",
    }),
  },
  {
    match: /Merkle path (unavailable|fetch failed)/,
    build: () => ({
      headline: "Can't reach the Writz relayer to check your loan.",
      safety: "Nothing was sent.",
      action: "Try again in a minute.",
    }),
  },
  {
    match: /Failed to fetch notes/,
    build: () => ({
      headline: "Can't reach the Writz relayer to find your loans.",
      safety: "Your loans are not affected.",
      action: "Check your connection and select Recover positions again.",
    }),
  },
  {
    match: /Demo insertion failed/,
    build: () => ({
      headline: "Couldn't add a sample loan.",
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
    match: /Co-sign failed/,
    build: () => ({
      headline: "Writz didn't co-sign the release.",
      safety: "Your BTC is still locked and safe.",
      action: "Try again in a minute.",
      report: "if_repeats",
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
  {
    match: /Commitment mismatch/,
    build: () => ({
      headline: "This browser computed different deposit data than expected, so nothing was sent.",
      safety: "Your BTC is safe in its lock.",
      action: "Don't retry. Include the BTC amount you entered in your report.",
      report: "always",
    }),
  },
  {
    match: /^ProverUnavailable/,
    build: () => ({
      headline: "Couldn't load the files this browser needs to prepare the transaction.",
      safety: "Nothing was sent.",
      action: "Try again.",
    }),
  },
  {
    match: /Assert Failed/,
    build: () => ({
      headline: "That amount is outside what this loan allows.",
      safety: "Nothing was sent.",
      action: "Check the amount and try again.",
    }),
  },

  // --- Commitment tree contract ---
  {
    match: /^InvalidZkProof$/,
    contract: "commitment-tree",
    build: (ctx) =>
      ctx.flow === "borrow" || ctx.flow === "repay"
        ? {
            headline: `Stellar didn't accept this ${ctx.flow}.`,
            safety: "Nothing changed.",
            action: "Select Recover positions, then try again.",
          }
        : {
            headline: "Stellar didn't accept this deposit.",
            safety: "Nothing changed. Your BTC is safe in its lock.",
            action: "Try again.",
            report: "if_repeats",
          },
  },
  {
    match: /^RootMismatch$/,
    contract: "commitment-tree",
    build: () => ({
      headline: "Another transaction landed first, so this one wasn't applied.",
      safety: "Nothing changed.",
      action: "Try again.",
    }),
  },
  {
    match: /^NullifierAlreadySpent$/,
    contract: "commitment-tree",
    build: () => ({
      headline: "This loan was already updated, maybe from another tab or device.",
      safety: "Nothing changed.",
      action: "Select Recover positions to load its current state.",
    }),
  },
  {
    match: /^DuplicateDeposit$/,
    contract: "commitment-tree",
    build: () => ({
      headline: "This Bitcoin transaction is already recorded as a deposit.",
      safety: "Your BTC is safe in its lock.",
      action: "Select Recover positions to load it.",
    }),
  },
  {
    match: /^CommitmentNotFound$/,
    contract: "commitment-tree",
    build: () => ({
      headline: "This loan isn't on Stellar yet.",
      safety: "Nothing changed.",
      action: "If your deposit just finished, wait a minute and try again.",
    }),
  },
  {
    match: /^InsufficientLiquidity$/,
    contract: "commitment-tree",
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
    match: /^(WrongCircuitMode|SignalOverflow)$/,
    contract: "commitment-tree",
    build: () => WRONG_TX,
  },
  {
    match: /^ProtocolParamMismatch$/,
    contract: "commitment-tree",
    build: () => ({
      headline: "Loan settings changed while this was in progress.",
      safety: "Nothing changed.",
      action: "Refresh the page and try again.",
    }),
  },
  {
    // The proof's price is fixed when the app is built, so a retry repeats the mismatch.
    match: /^PriceMismatch$/,
    contract: "commitment-tree",
    build: () => ({
      headline: `The BTC price in this app doesn't match the oracle price on ${NETWORK}.`,
      safety: "Nothing changed.",
      action: "Trying again won't help until the app is updated.",
      report: "always",
    }),
  },
  {
    match: /^TxidMismatch$/,
    contract: "commitment-tree",
    build: () => ({
      headline: "That transaction ID doesn't match the Bitcoin transaction that was verified.",
      safety: "Nothing changed.",
      action: "Check the ID for this deposit and try again.",
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
    contract: "commitment-tree",
    build: () => ({
      headline: "The connected wallet doesn't own this loan.",
      safety: "Nothing changed.",
      action: "Switch to the Stellar wallet you deposited with.",
    }),
  },
  {
    match: /^NotInitialized$/,
    contract: "commitment-tree",
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
  const contract = onVault ? null : resolveContractError(raw);
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
