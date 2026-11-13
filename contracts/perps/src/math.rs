//! Pure integer math. All functions round against the trader and in favour of the vault.
use crate::types::*;

pub fn bps_of(amount: u128, bps: u128) -> u128 {
    amount * bps / BPS
}

/// Units bought for `notional` at `price` (floored).
pub fn units_for(notional: u128, price: u128) -> u128 {
    assert!(price > 0, "Price is zero");
    notional * UNIT_SCALE / price
}

/// Current value of `units` at `price`. Longs are valued down, shorts are valued up.
pub fn value_of(units: u128, price: u128, round_up: bool) -> u128 {
    let num = units * price;
    if round_up {
        num.div_ceil(UNIT_SCALE)
    } else {
        num / UNIT_SCALE
    }
}

/// Unrealised PnL of one position at `price`.
pub fn position_pnl(is_long: bool, units: u128, notional: u128, price: u128) -> i128 {
    if is_long {
        value_of(units, price, false) as i128 - notional as i128
    } else {
        notional as i128 - value_of(units, price, true) as i128
    }
}

/// Funding owed by a position (positive = trader pays the vault).
pub fn funding_owed(is_long: bool, notional: u128, index_open: i128, index_now: i128) -> i128 {
    let delta = index_now - index_open;
    let owed = delta * notional as i128;
    // Round towards the trader paying more.
    let owed = if owed >= 0 {
        (owed + FUNDING_SCALE - 1) / FUNDING_SCALE
    } else {
        owed / FUNDING_SCALE
    };
    if is_long {
        owed
    } else {
        -owed
    }
}

/// Funding rate per hour scaled by FUNDING_SCALE, positive = longs pay.
pub fn funding_rate_per_hour(cfg: &MarketConfig, long_notional: u128, short_notional: u128, nav: u128) -> i128 {
    if nav == 0 {
        return 0;
    }
    let skew = long_notional as i128 - short_notional as i128;
    // k bps/hour at 100% skew -> fraction scaled 1e12: k * 1e8
    let k = cfg.funding_k_bps_per_hour as i128 * (FUNDING_SCALE / BPS as i128);
    let max = cfg.max_funding_bps_per_hour as i128 * (FUNDING_SCALE / BPS as i128);
    let rate = k * skew / nav as i128;
    rate.clamp(-max, max)
}

/// Price at which equity equals maintenance margin.
/// Long:  C + U*P/S - N - f = mm  => P = (N + f + mm - C) * S / U
/// Short: C + N - U*P/S - f = mm  => P = (C + N - f - mm) * S / U
pub fn liquidation_price(
    is_long: bool,
    collateral: u128,
    notional: u128,
    units: u128,
    funding: i128,
    maintenance_margin: u128,
) -> u128 {
    if units == 0 {
        return 0;
    }
    let c = collateral as i128;
    let n = notional as i128;
    let mm = maintenance_margin as i128;
    let num = if is_long { n + funding + mm - c } else { c + n - funding - mm };
    if num <= 0 {
        return 0;
    }
    (num as u128) * UNIT_SCALE / units
}

/// Absolute move between two prices in bps (rounded up).
pub fn move_bps(old: u128, new: u128) -> u128 {
    if old == 0 {
        return 0;
    }
    let diff = old.abs_diff(new);
    (diff * BPS).div_ceil(old)
}

#[cfg(test)]
mod tests {
    use super::*;

    const USD: u128 = 1_000_000; // 1 USDC / 1 USD in micro units

    #[test]
    fn liquidation_price_matches_plan_example() {
        // Long NEAR at $3.00, C = $10, 10x, mm = 5% -> N = $100, liq = $2.85
        let entry = 3 * USD;
        let n = 100 * USD;
        let u = units_for(n, entry);
        let liq = liquidation_price(true, 10 * USD, n, u, 0, bps_of(n, 500));
        assert!((2_849_990..=2_850_010).contains(&liq), "liq = {liq}");
    }

    #[test]
    fn short_liquidation_price() {
        let entry = 3 * USD;
        let n = 100 * USD;
        let u = units_for(n, entry);
        let liq = liquidation_price(false, 10 * USD, n, u, 0, bps_of(n, 500));
        assert!((3_149_990..=3_150_010).contains(&liq), "liq = {liq}");
    }

    #[test]
    fn pnl_long_and_short() {
        let n = 100 * USD;
        let u = units_for(n, 3 * USD);
        // +10% move
        let up = 3_300_000;
        assert!((position_pnl(true, u, n, up) - 10 * USD as i128).abs() <= 1);
        assert!((position_pnl(false, u, n, up) + 10 * USD as i128).abs() <= 1);
        // never rounds in the trader's favour
        assert!(position_pnl(true, u, n, 3 * USD) <= 0);
        assert!(position_pnl(false, u, n, 3 * USD) <= 0);
    }

    #[test]
    fn funding_direction() {
        let cfg = MarketConfig {
            max_leverage_bps: 100_000,
            maintenance_margin_bps: 500,
            fee_bps: 10,
            max_oi_bps_of_nav: 4_000,
            stale_after_sec: 600,
            max_price_jump_bps: 500,
            funding_k_bps_per_hour: 10,
            max_funding_bps_per_hour: 5,
            two_step: false,
        };
        // long-heavy -> positive (longs pay), capped at 5 bps/h
        let r = funding_rate_per_hour(&cfg, 100 * USD, 0, 100 * USD);
        assert_eq!(r, 5 * 100_000_000);
        let r = funding_rate_per_hour(&cfg, 0, 20 * USD, 100 * USD);
        assert_eq!(r, -2 * 100_000_000);
        // long pays, short receives
        assert!(funding_owed(true, 100 * USD, 0, 1_000_000_000) > 0);
        assert!(funding_owed(false, 100 * USD, 0, 1_000_000_000) < 0);
    }

    #[test]
    fn move_bps_works() {
        assert_eq!(move_bps(100, 105), 500);
        assert_eq!(move_bps(100, 95), 500);
        assert_eq!(move_bps(0, 95), 0);
    }
}
