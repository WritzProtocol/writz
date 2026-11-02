import { describe, expect, it } from "bun:test";
import type { Position as RawPosition } from "./writzLendGenerated";
import {
  INDEX_ONE,
  accrueBalance,
  supplyRate,
  borrowRateBp,
  debtAt,
  displayTxid,
  internalTxid,
  poolStateAt,
  projectRates,
  toChainPosition,
  type RateState,
} from "./writzLend";

const STROOP = 10_000_000n;

/** 10,000 USDC supplied, `borrowed` out, indexes at one, last accrued at ledger 1,000. */
const state = (borrowed: bigint, over: Partial<RateState> = {}): RateState => ({
  borrow_index: INDEX_ONE,
  supply_index: INDEX_ONE,
  index_ledger: 1_000,
  total_borrowed: borrowed,
  total_scaled_supply: 10_000n * STROOP,
  ...over,
});

describe("borrowRateBp, the contract's kinked model", () => {
  it("is 0 with nothing borrowed, 8% at 75% utilization, and climbs steeply above", () => {
    expect(borrowRateBp(0n, 10_000n)).toBe(0n);
    expect(borrowRateBp(7_500n, 10_000n)).toBe(800n);
    expect(borrowRateBp(3_750n, 10_000n)).toBe(400n);
    expect(borrowRateBp(8_000n, 10_000n)).toBe(4_800n);
  });
});

describe("projectRates", () => {
  it("does nothing within the same ledger", () => {
    const p = state(7_500n * STROOP);
    expect(projectRates(p, 1_000)).toEqual({ borrowIndex: INDEX_ONE, supplyIndex: INDEX_ONE, totalBorrowed: 7_500n * STROOP });
  });

  it("grows the borrow index at the annual rate, simple within the interval", () => {
    const p = state(7_500n * STROOP);
    // One year of ledgers at 8%.
    const { borrowIndex, totalBorrowed, supplyIndex } = projectRates(p, 1_000 + 6_311_520);
    expect(borrowIndex).toBe((INDEX_ONE * 108n) / 100n);
    expect(totalBorrowed).toBe(8_100n * STROOP);
    // Lenders get 85% of the 600 USDC of interest on 10,000 supplied.
    expect(supplyIndex).toBe(INDEX_ONE + (510n * STROOP * INDEX_ONE) / (10_000n * STROOP));
  });
});

describe("debtAt", () => {
  it("scales the stored debt by the index growth since it was last touched", () => {
    expect(debtAt({ usdc_debt: 1_000n * STROOP, debt_index: INDEX_ONE }, (INDEX_ONE * 101n) / 100n)).toBe(1_010n * STROOP);
    expect(debtAt({ usdc_debt: 0n, debt_index: INDEX_ONE }, 2n * INDEX_ONE)).toBe(0n);
  });
});

describe("txid byte order", () => {
  it("reverses between the explorer's order and the contract's", () => {
    const display = "00".repeat(31) + "ff";
    expect(internalTxid(display)[0]).toBe(0xff);
    expect(displayTxid(internalTxid(display))).toBe(display);
  });
});

describe("toChainPosition", () => {
  it("shapes get_position with the debt brought up to the given ledger", () => {
    const raw: RawPosition = {
      btc_txid: internalTxid("ab".repeat(31) + "cd"),
      btc_satoshis: 5_000_000n,
      usdc_debt: 1_000n * STROOP,
      p2wsh_script_pubkey: Buffer.from("0020" + "11".repeat(32), "hex"),
      timelock_height: 300_000,
      last_update_ledger: 1_000,
      debt_index: INDEX_ONE,
      depositor: "GOWNER",
      status: { tag: "Active", values: undefined },
      user_pubkey: Buffer.from("02" + "22".repeat(32), "hex"),
    };
    const c = toChainPosition(raw, state(7_500n * STROOP), 1_000 + 6_311_520);
    expect(c).toMatchObject({
      txid: "ab".repeat(31) + "cd",
      status: "active",
      depositor: "GOWNER",
      collateralSats: 5_000_000n,
      debtStroops: 1_080n * STROOP,
      storedDebtStroops: 1_000n * STROOP,
      timelockHeight: 300_000,
      userPubkey: "02" + "22".repeat(32),
      scriptPubKey: "0020" + "11".repeat(32),
    });
    expect(toChainPosition({ ...raw, status: { tag: "Closed", values: undefined } }, state(0n), 1_000).status).toBe("closed");
  });
});

describe("poolStateAt", () => {
  it("reports supplied, borrowed and what is left to borrow", () => {
    expect(poolStateAt(state(4_000n * STROOP), 1_000)).toEqual({
      totalSupplied: 10_000n * STROOP,
      totalBorrowed: 4_000n * STROOP,
      available: 6_000n * STROOP,
    });
  });
});

describe("supplyRate, the lenders' share of the borrow rate", () => {
  it("is borrow rate x utilization x 0.85", () => {
    expect(supplyRate(800n, 7_500n * STROOP, 10_000n * STROOP)).toBeCloseTo(0.08 * 0.75 * 0.85, 12);
  });

  it("is above 0 where get_supply_rate_bp rounds to 0", () => {
    const supplied = 150n * STROOP;
    const borrowed = 4n * STROOP;
    const rate = supplyRate(borrowRateBp(borrowed, supplied), borrowed, supplied);
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThan(0.0001);
  });

  it("is 0 with nothing borrowed or nothing supplied", () => {
    expect(supplyRate(0n, 0n, 100n * STROOP)).toBe(0);
    expect(supplyRate(800n, 0n, 100n * STROOP)).toBe(0);
    expect(supplyRate(800n, 10n, 0n)).toBe(0);
  });
});

describe("accrueBalance", () => {
  const YEAR_MS = 6_311_520 * 5_000;

  it("grows a balance by the rate over the elapsed time, rounded down", () => {
    expect(accrueBalance(1_000n * STROOP, 0.05, YEAR_MS)).toBe(1_050n * STROOP);
    expect(accrueBalance(1_000n * STROOP, 0.05, YEAR_MS / 2)).toBe(1_025n * STROOP);
  });

  it("matches the supply index growth the contract credits a sole lender", () => {
    const p = state(5_000n * STROOP);
    const ledgers = 17_280;
    const { supplyIndex } = projectRates(p, 1_000 + ledgers);
    const chain = (10_000n * STROOP * supplyIndex) / INDEX_ONE;
    const rate = supplyRate(borrowRateBp(p.total_borrowed, 10_000n * STROOP), p.total_borrowed, 10_000n * STROOP);
    const local = accrueBalance(10_000n * STROOP, rate, ledgers * 5_000);
    expect(local <= chain).toBe(true);
    expect(chain - local <= 1n).toBe(true);
  });

  it("leaves the balance alone at rate 0, no elapsed time or a zero balance", () => {
    expect(accrueBalance(10n, 0, 60_000)).toBe(10n);
    expect(accrueBalance(10n, 0.05, 0)).toBe(10n);
    expect(accrueBalance(0n, 0.05, 60_000)).toBe(0n);
  });
});
