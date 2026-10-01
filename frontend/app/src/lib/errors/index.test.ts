import { describe, expect, it } from "bun:test";
import { CommitmentTreeError } from "@/lib/contracts/generated";
import { SignatureRejectedError } from "@/lib/wallet/rejection";
import { AccountUnfundedError, LowXlmError, WrongNetworkError } from "@/lib/wallet/precheck";
import { XverseError } from "@/lib/bitcoin/xverse";
import { BitcoinSpvError } from "./contract";
import { describeError, humanizeError, type ErrorContext, type FriendlyError } from "./index";

const code = (n: number) => new Error(`Transaction simulation failed: "HostError: Error(Contract, #${n})"`);

function text(e: FriendlyError): string {
  return [e.headline, e.safety, e.action].filter(Boolean).join(" ");
}

const SAMPLES: [unknown, ErrorContext?][] = [
  ...Object.keys(CommitmentTreeError).map((n) => [code(Number(n)), { flow: "borrow" }] as [unknown, ErrorContext]),
  ...Object.values(BitcoinSpvError).map(({ message }) => [new Error(message), { flow: "deposit" }] as [unknown, ErrorContext]),
  [new SignatureRejectedError("stellar", "Freighter")],
  [new WrongNetworkError("Public Global Stellar Network ; September 2015", "Freighter")],
  [new AccountUnfundedError()],
  [new LowXlmError(100n, 0n)],
  [new XverseError("Internal error"), { flow: "release" }],
  [new Error("NEXT_PUBLIC_RELAYER_URL not configured"), { flow: "release" }],
  [new Error("Relayer unreachable"), { flow: "earn-deposit" }],
  [new Error("Merkle path unavailable: Leaf store is out of sync")],
  [new Error("Merkle path fetch failed: 500")],
  [new Error("Merkle insertion failed: boom")],
  [new Error("Failed to fetch notes: 500")],
  [new Error("Relayer error 502")],
  [new Error("Co-sign failed: 500")],
  [new Error("Broadcast failed: bad-txns")],
  [new Error("Commitment mismatch - circuit output does not match local computation.")],
  [new Error("ProverUnavailable: fetch failed")],
  [new Error("TxLockBusy")],
  [new Error("SubmissionThrottled")],
  [new Error("ConfirmationTimedOut")],
  [new Error('Transaction rejected by the network: {"result":"tx_failed"}')],
  [new Error("Transaction failed on-chain: AAAA")],
  [new Error("Request failed with status code 503")],
  [new Error("StrategyPaused"), { flow: "earn-withdraw" }],
  [new Error("InsufficientOutputAmount"), { flow: "earn-withdraw" }],
  [new Error("something nobody planned for")],
];

describe("every message follows the copy rules", () => {
  it("has a headline, never shows the raw text as the message, and avoids banned forms", () => {
    for (const [error, ctx] of SAMPLES) {
      const e = describeError(error, ctx);
      const shown = text(e);
      expect(e.headline.length).toBeGreaterThan(0);
      expect(shown).not.toContain("HostError");
      expect(shown).not.toContain("Error(Contract");
      expect(shown).not.toMatch(/[—–~]/);
      expect(shown).not.toMatch(/\b(Soroban|nullifier|commitment|Merkle|we)\b/i);
      expect(e.raw.length).toBeGreaterThan(0);
    }
  });
});

describe("contract codes route through the deployed variant", () => {
  it("maps #15 to the withdraw-limit message with the caller's balance", () => {
    const e = describeError(code(15), { flow: "withdraw", ownBalanceUsdc: "250" });
    expect(e.contract).toEqual({ contract: "commitment-tree", code: 15, variant: "WithdrawExceedsBalance" });
    expect(text(e)).toBe("You supplied 250 USDC. No USDC moved. Enter that or less.");
  });

  it("words InsufficientLiquidity for borrowing and for withdrawing", () => {
    expect(describeError(code(9), { flow: "borrow", availableUsdc: "40" }).headline).toBe(
      "The pool has 40 USDC available right now.",
    );
    expect(describeError(code(9), { flow: "withdraw", availableUsdc: "40" }).headline).toContain(
      "Only 40 USDC can be withdrawn now",
    );
  });

  it("does not promise a retry fixes PriceMismatch, since the price is fixed at build time", () => {
    const e = describeError(code(12), { flow: "borrow" });
    expect(text(e)).not.toMatch(/latest price|new price/i);
    expect(e.action).toBe("Trying again won't help until the app is updated.");
    expect(e.report).toBe("always");
  });

  it("does not send NullifierAlreadySpent to a page refresh", () => {
    const e = describeError(code(6), { flow: "repay" });
    expect(text(e)).not.toMatch(/refresh/i);
    expect(e.action).toContain("Recover positions");
  });

  it("names the action Stellar refused for InvalidZkProof", () => {
    expect(describeError(code(4), { flow: "repay" }).headline).toBe("Stellar didn't accept this repay.");
    expect(describeError(code(4), { flow: "deposit" }).safety).toContain("Your BTC is safe in its lock.");
  });

  it("falls back for a code the deployed table doesn't have, keeping the code for support", () => {
    const e = describeError(code(16), { flow: "borrow" });
    expect(e.headline).toBe("Something went wrong and the action may not have gone through.");
    expect(e.contract?.code).toBe(16);
  });

  it("does not read vault failures with the commitment-tree table", () => {
    const e = describeError(code(15), { flow: "earn-withdraw" });
    expect(e.contract).toBeUndefined();
  });
});

describe("wallet and account messages", () => {
  it("names the wallet that was declined", () => {
    expect(text(describeError(new SignatureRejectedError("bitcoin", "Xverse")))).toBe(
      "You declined in Xverse. Nothing was sent. Sign again when you're ready.",
    );
  });

  it("names both networks for a wallet on the wrong one", () => {
    const e = describeError(new WrongNetworkError("Public Global Stellar Network ; September 2015", "Freighter"));
    expect(e.headline).toBe("Your wallet is on Stellar mainnet. Writz runs on Stellar testnet.");
    expect(e.action).toBe("Switch network in Freighter, then try again.");
  });

  it("offers Friendbot for an unfunded account and for low XLM", () => {
    for (const error of [new AccountUnfundedError(), new Error("Account not found: GABC"), new LowXlmError(1n, 0n)]) {
      expect(describeError(error).link?.label).toBe("Fund with Friendbot");
    }
    expect(describeError(new Error("tx_insufficient_balance")).headline).toBe("Not enough XLM for this transaction.");
  });

  it("does not show raw Xverse text", () => {
    const e = describeError(new XverseError("Internal error"), { flow: "release" });
    expect(text(e)).toBe("Xverse didn't respond. Your BTC is still locked. Open Xverse and try again.");
  });
});

describe("support route", () => {
  it("adds the GitHub link to the plain-text form", () => {
    expect(humanizeError(code(12), { flow: "borrow" })).toContain(
      "Report it on GitHub: https://github.com/WritzProtocol/writz/issues.",
    );
    expect(humanizeError(new Error("Co-sign failed: 500"))).toContain("If it keeps happening, report it on GitHub");
  });

  it("uses read wording for failed page loads", () => {
    expect(text(describeError(new Error("socket hang up"), { flow: "read" }))).toBe(
      "Can't reach Stellar testnet right now. Your funds are not affected. Try again in a minute.",
    );
  });
});
