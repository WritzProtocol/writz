/// Writz Protocol — Kinked interest rate model.
///
/// Parameters (from research doc):
///   Base rate:      0%
///   Uoptimal:      75%  (7_500 bp)
///   Slope 1:        8%  (  800 bp)  — annual rate at 100% utilization below optimal
///   Slope 2:      200%  (20_000 bp) — annual rate added per unit above optimal
///   Protocol fee:  15%  (1_500 bp)  — share of borrow interest kept by protocol
///
/// At U = Uoptimal (75%):  borrow rate =   8%,  supply rate = 5.1%
/// At U = 80%:             borrow rate =  48%,  supply rate ≈ 32.6%
/// At U = 90%:             borrow rate = 128%,  supply rate ≈ 97.9%

/// 100% expressed in basis points.
pub const BP_SCALE: i128 = 10_000;
/// Optimal utilization: 75%.
pub const U_OPTIMAL_BP: i128 = 7_500;
/// Slope below optimal: 8% annual.
pub const SLOPE1_BP: i128 = 800;
/// Slope above optimal: 200% annual.
pub const SLOPE2_BP: i128 = 20_000;
/// Protocol fee on interest income: 15%.
pub const PROTOCOL_FEE_BP: i128 = 1_500;
/// Approximate Stellar ledgers per year at 5-second average close time.
/// 60s/5s × 60min × 24h × 365.25d = 6_311_520
pub const LEDGERS_PER_YEAR: i128 = 6_311_520;

/// Returns the annual borrow rate in basis points given the current pool state.
///
/// ```text
/// if U ≤ Uoptimal:
///     rate = (U / Uoptimal) × slope1
/// else:
///     rate = slope1 + ((U - Uoptimal) / (1 - Uoptimal)) × slope2
/// ```
pub fn borrow_rate_bp(total_borrowed: i128, total_supplied: i128) -> i128 {
    if total_supplied == 0 || total_borrowed == 0 {
        return 0;
    }
    // U in basis points, capped at 100%.
    let u_bp = (total_borrowed.saturating_mul(BP_SCALE) / total_supplied).min(BP_SCALE);

    if u_bp <= U_OPTIMAL_BP {
        u_bp.saturating_mul(SLOPE1_BP) / U_OPTIMAL_BP
    } else {
        let excess = u_bp - U_OPTIMAL_BP;
        let excess_rate = excess.saturating_mul(SLOPE2_BP) / (BP_SCALE - U_OPTIMAL_BP);
        SLOPE1_BP.saturating_add(excess_rate)
    }
}

/// Returns the annual supply rate in basis points.
///
/// ```text
/// supply_rate = borrow_rate × U × (1 − protocol_fee)
/// ```
pub fn supply_rate_bp(borrow_rate: i128, total_borrowed: i128, total_supplied: i128) -> i128 {
    if total_supplied == 0 || total_borrowed == 0 {
        return 0;
    }
    let u_bp = (total_borrowed.saturating_mul(BP_SCALE) / total_supplied).min(BP_SCALE);
    // supply_rate = borrow_rate × U × (1 − protocol_fee)
    let gross = borrow_rate.saturating_mul(u_bp) / BP_SCALE;
    gross.saturating_mul(BP_SCALE - PROTOCOL_FEE_BP) / BP_SCALE
}

/// Accrues simple interest on `debt` over `ledgers_elapsed` at the given
/// annual `rate_bp`, returning the new (higher) debt.
///
/// ```text
/// interest = debt × rate_bp × ledgers / (LEDGERS_PER_YEAR × BP_SCALE)
/// ```
///
/// Uses saturating arithmetic — overflow silently caps rather than panics.
pub fn accrue_interest(debt: i128, rate_bp: i128, ledgers_elapsed: i128) -> i128 {
    if ledgers_elapsed == 0 || debt == 0 || rate_bp == 0 {
        return debt;
    }
    let interest = debt
        .saturating_mul(rate_bp)
        .saturating_mul(ledgers_elapsed)
        / (LEDGERS_PER_YEAR.saturating_mul(BP_SCALE));
    debt.saturating_add(interest)
}

/// Returns the interest that will accrue on `debt` over `ledgers_elapsed`
/// ledgers at `rate_bp` (without modifying the debt).
pub fn interest_delta(debt: i128, rate_bp: i128, ledgers_elapsed: i128) -> i128 {
    accrue_interest(debt, rate_bp, ledgers_elapsed) - debt
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── borrow_rate_bp ───────────────────────────────────────────────────────

    #[test]
    fn rate_zero_when_nothing_borrowed() {
        assert_eq!(borrow_rate_bp(0, 1_000_000), 0);
    }

    #[test]
    fn rate_zero_when_no_supply() {
        assert_eq!(borrow_rate_bp(100, 0), 0);
    }

    #[test]
    fn rate_at_optimal_utilization_equals_slope1() {
        // U = 75% exactly → rate = slope1 = 800 bp (8% APR)
        assert_eq!(borrow_rate_bp(75_000, 100_000), SLOPE1_BP);
    }

    #[test]
    fn rate_at_half_optimal_is_half_slope1() {
        // U = 37.5% → rate = 37.5/75 × 800 = 400 bp
        assert_eq!(borrow_rate_bp(37_500, 100_000), 400);
    }

    #[test]
    fn rate_at_80_pct_is_4800() {
        // U = 80% → excess = 5% over optimal
        // excess_rate = 5%/25% × 200% = 40% → total = 8% + 40% = 48% = 4800 bp
        assert_eq!(borrow_rate_bp(80_000, 100_000), 4_800);
    }

    #[test]
    fn rate_at_90_pct_is_12800() {
        // U = 90% → excess = 15%/25% × 200% = 120% → total = 128% = 12_800 bp
        assert_eq!(borrow_rate_bp(90_000, 100_000), 12_800);
    }

    #[test]
    fn rate_at_100_pct_is_slope1_plus_slope2() {
        // U = 100% → 8% + 200% = 208% = 20_800 bp
        assert_eq!(borrow_rate_bp(100_000, 100_000), SLOPE1_BP + SLOPE2_BP);
    }

    #[test]
    fn rate_caps_at_100_pct_utilization() {
        // Borrowed > supplied should clamp at 100% utilization
        assert_eq!(
            borrow_rate_bp(200_000, 100_000),
            borrow_rate_bp(100_000, 100_000)
        );
    }

    // ── supply_rate_bp ───────────────────────────────────────────────────────

    #[test]
    fn supply_rate_zero_when_nothing_borrowed() {
        assert_eq!(supply_rate_bp(800, 0, 100_000), 0);
    }

    #[test]
    fn supply_rate_at_optimal_approximately_510_bp() {
        // At U=75%, borrow=800 bp, fee=15%:
        // supply = 800 × 0.75 × 0.85 = 510 bp (5.1%)
        let rate = supply_rate_bp(800, 75_000, 100_000);
        assert_eq!(rate, 510);
    }

    // ── accrue_interest ──────────────────────────────────────────────────────

    #[test]
    fn accrual_zero_ledgers_returns_same_debt() {
        assert_eq!(accrue_interest(1_000_000, 800, 0), 1_000_000);
    }

    #[test]
    fn accrual_zero_rate_returns_same_debt() {
        assert_eq!(accrue_interest(1_000_000, 0, 1_000), 1_000_000);
    }

    #[test]
    fn accrual_one_year_at_8_pct_is_correct() {
        // debt = 1_000_000, rate = 800 bp, ledgers = LEDGERS_PER_YEAR
        // interest = 1_000_000 × 800 / 10_000 = 80_000 (8%)
        let new_debt = accrue_interest(1_000_000, 800, LEDGERS_PER_YEAR);
        assert_eq!(new_debt, 1_080_000);
    }

    #[test]
    fn accrual_is_linear_within_a_year() {
        let half = accrue_interest(1_000_000, 800, LEDGERS_PER_YEAR / 2);
        // Should be approximately 4% (40_000) more
        assert!(half > 1_039_000 && half < 1_041_000);
    }

    #[test]
    fn interest_delta_matches_difference() {
        let d = 5_000_000_i128;
        let r = 4_800_i128;
        let l = 100_000_i128;
        assert_eq!(
            interest_delta(d, r, l),
            accrue_interest(d, r, l) - d
        );
    }
}
