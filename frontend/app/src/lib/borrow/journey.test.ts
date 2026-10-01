import { describe, expect, test } from "bun:test";
import {
  backTarget,
  btcBalanceOf,
  canEdit,
  depositStage,
  estimateFeeSats,
  exitDate,
  formatBtc,
  formatUsd,
  formatUsdc,
  fundingOf,
  journeyMinutes,
  liquidationPriceStroops,
  maxBorrowStroops,
  parseBtcAmount,
  routeStep,
  shortAddress,
  summaryValues,
  timeLeft,
  type RouteFacts,
} from "./journey";

const PRICE = 60_000n * 10_000_000n;

const facts = (over: Partial<RouteFacts> = {}): RouteFacts => ({
  done: false,
  stage: null,
  sending: false,
  amountConfirmed: true,
  editing: null,
  stellarReady: true,
  bitcoinReady: true,
  ...over,
});

describe("amounts", () => {
  test("formats BTC with 8 decimals and USDC with 2, rounded down", () => {
    expect(formatBtc(5_000_000n)).toBe("0.05000000");
    expect(formatBtc(150_000_000n)).toBe("1.50000000");
    expect(formatUsdc(20_000_009_999n)).toBe("2,000.00");
    expect(formatUsd(PRICE)).toBe("$60,000");
  });

  test("parses decimal BTC strictly", () => {
    expect(parseBtcAmount("0.05")).toEqual({ ok: true, sats: 5_000_000n });
    expect(parseBtcAmount("0,05")).toEqual({ ok: true, sats: 5_000_000n });
    expect(parseBtcAmount(" 1 ")).toEqual({ ok: true, sats: 100_000_000n });
    expect(parseBtcAmount("")).toEqual({ ok: false, error: "Enter an amount." });
    expect(parseBtcAmount("1e3")).toMatchObject({ ok: false });
    expect(parseBtcAmount("0.000000001")).toEqual({ ok: false, error: "BTC has at most 8 decimals." });
    expect(parseBtcAmount("0")).toEqual({ ok: false, error: "Enter an amount above 0." });
    expect(parseBtcAmount("0.00001")).toEqual({ ok: false, error: "Minimum 0.00010000 BTC." });
  });

  test("borrow limit is two thirds of the collateral value, liquidation at 80% of the price", () => {
    expect(formatUsdc(maxBorrowStroops(5_000_000n, PRICE))).toBe("2,000.00");
    expect(formatUsd(liquidationPriceStroops(PRICE))).toBe("$48,000");
  });
});

describe("time", () => {
  test("exit date counts ten minutes a block, in UTC", () => {
    expect(exitDate(144, Date.UTC(2026, 9, 1, 12))).toBe("2 Oct 2026");
  });

  test("time left and journey length", () => {
    expect(timeLeft(0)).toBe("Any moment now");
    expect(timeLeft(1)).toBe("About 10 min left");
    expect(timeLeft(6)).toBe("About 1 hour left");
    expect(timeLeft(9)).toBe("About 1.5 hours left");
    expect(journeyMinutes(1)).toBe(15);
    expect(journeyMinutes(6)).toBe(65);
    expect(estimateFeeSats(2.5)).toBe(353);
  });
});

describe("reads", () => {
  test("funding: missing account, low and enough XLM", () => {
    expect(fundingOf(null)).toEqual({ kind: "unfunded" });
    expect(fundingOf({ balances: [{ asset_type: "native", balance: "1.2000000" }] })).toEqual({ kind: "low", xlm: "1.20" });
    expect(fundingOf({ balances: [{ asset_type: "native", balance: "9850.0000000" }] })).toEqual({ kind: "ok" });
  });

  test("BTC balance counts unconfirmed coins", () => {
    expect(
      btcBalanceOf({
        chain_stats: { funded_txo_sum: 10_000, spent_txo_sum: 4_000 },
        mempool_stats: { funded_txo_sum: 500, spent_txo_sum: 0 },
      }),
    ).toBe(6_500n);
  });
});

describe("routeStep", () => {
  test("walks amount, Stellar, Bitcoin, review in order", () => {
    expect(routeStep(facts({ amountConfirmed: false, stellarReady: false, bitcoinReady: false }))).toBe("amount");
    expect(routeStep(facts({ stellarReady: false, bitcoinReady: false }))).toBe("stellar");
    expect(routeStep(facts({ bitcoinReady: false }))).toBe("bitcoin");
    expect(routeStep(facts())).toBe("review");
  });

  test("an edited step shows even when it is complete", () => {
    expect(routeStep(facts({ editing: "amount" }))).toBe("amount");
    expect(routeStep(facts({ editing: "stellar" }))).toBe("stellar");
  });

  test("once BTC is sent the deposit stage wins over everything", () => {
    expect(routeStep(facts({ stage: "wait", editing: "amount", amountConfirmed: false }))).toBe("wait");
    expect(routeStep(facts({ stage: "register" }))).toBe("register");
    expect(routeStep(facts({ sending: true, editing: "amount" }))).toBe("review");
    expect(routeStep(facts({ done: true, stage: "register" }))).toBe("done");
  });
});

describe("edit rules", () => {
  const free = { stage: null, sending: false, done: false } as const;

  test("only steps already passed are editable", () => {
    expect(canEdit("amount", "review", free)).toBe(true);
    expect(canEdit("bitcoin", "review", free)).toBe(true);
    expect(canEdit("bitcoin", "stellar", free)).toBe(false);
    expect(canEdit("amount", "amount", free)).toBe(false);
  });

  test("nothing is editable once BTC is sent or while Xverse is asking", () => {
    expect(canEdit("amount", "review", { ...free, sending: true })).toBe(false);
    expect(canEdit("amount", "wait", { ...free, stage: "wait" })).toBe(false);
    expect(canEdit("stellar", "register", { ...free, stage: "register" })).toBe(false);
  });

  test("Back goes one step up while editing is allowed", () => {
    expect(backTarget("stellar", free)).toBe("amount");
    expect(backTarget("bitcoin", free)).toBe("stellar");
    expect(backTarget("review", free)).toBe("bitcoin");
    expect(backTarget("amount", free)).toBeNull();
    expect(backTarget("review", { ...free, sending: true })).toBeNull();
    expect(backTarget("wait", { ...free, stage: "wait" })).toBeNull();
  });
});

describe("depositStage", () => {
  const idle = { phase: "idle" } as const;

  test("waits while Bitcoin confirms", () => {
    expect(depositStage({ step: "sent" }, "btc_sent", idle)).toBe("wait");
    expect(depositStage({ step: "confirming" }, "confirming", { phase: "waiting_btc", confirmations: 0, required: 1, relayerReachable: true })).toBe("wait");
    expect(depositStage({ step: "sent" }, "checking", { phase: "awaiting_signature", wallet: "bitcoin" })).toBe("wait");
  });

  test("registers once confirmed, signing, or resuming a submitted deposit", () => {
    expect(depositStage({ step: "confirming" }, "ready_to_register", idle)).toBe("register");
    expect(depositStage({ step: "confirming" }, "checking", { phase: "ready" })).toBe("register");
    expect(depositStage({ step: "confirming" }, "checking", { phase: "awaiting_signature", wallet: "stellar" })).toBe("register");
    expect(depositStage({ step: "submitted" }, "checking", idle)).toBe("register");
    expect(depositStage({ step: "registering" }, "register_failed", idle)).toBe("register");
  });
});

describe("summary", () => {
  test("labelled values appear once an amount exists", () => {
    expect(summaryValues(5_000_000n, PRICE)).toEqual({ locking: "0.05000000 BTC", borrowUpTo: "2,000.00 USDC" });
    expect(summaryValues(5_000_000n, null)).toEqual({ locking: "0.05000000 BTC", borrowUpTo: null });
    expect(summaryValues(null, PRICE)).toEqual({ locking: null, borrowUpTo: null });
  });

  test("addresses truncate in the middle", () => {
    expect(shortAddress("GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37")).toBe("GDQP…4W37");
    expect(shortAddress("short")).toBe("short");
  });
});
