//! Unit tests: layer 1 of the test plan. Run with `cargo test`.
use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, PromiseResult, RuntimeFeesConfig};

const USD: u128 = 1_000_000;
const T0: u64 = 1_800_000_000; // unix seconds
const NEAR_USD: &str = "NEAR-USD";
const GPU: &str = "GPU-H100";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn owner() -> AccountId {
    acc("owner.near")
}
fn oracle() -> AccountId {
    acc("oracle.near")
}
fn usdc() -> AccountId {
    acc("usdc.near")
}
fn alice() -> AccountId {
    acc("alice.near")
}
fn bob() -> AccountId {
    acc("bob.near")
}
fn lp() -> AccountId {
    acc("lp.near")
}
fn keeper() -> AccountId {
    acc("keeper.near")
}

fn ctx(pred: &AccountId, deposit_yocto: u128, ts_sec: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("perps.near"))
        .predecessor_account_id(pred.clone())
        .signer_account_id(pred.clone())
        .attached_deposit(NearToken::from_yoctonear(deposit_yocto))
        .block_timestamp(ts_sec * NS_PER_SEC);
    testing_env!(b.build());
}

fn near_cfg() -> MarketConfig {
    MarketConfig {
        max_leverage_bps: 100_000,
        maintenance_margin_bps: 500,
        fee_bps: 10,
        max_oi_bps_of_nav: 4_000,
        stale_after_sec: 600,
        max_price_jump_bps: 500,
        funding_k_bps_per_hour: 10,
        max_funding_bps_per_hour: 5,
        two_step: false,
    }
}

fn gpu_cfg() -> MarketConfig {
    MarketConfig {
        max_leverage_bps: 50_000,
        maintenance_margin_bps: 1_000,
        fee_bps: 10,
        max_oi_bps_of_nav: 2_000,
        stale_after_sec: 26 * 3600,
        max_price_jump_bps: 1_000,
        funding_k_bps_per_hour: 4,
        max_funding_bps_per_hour: 2,
        two_step: true,
    }
}

fn wide_limits() -> Limits {
    Limits {
        vault_cap: U128(100_000 * USD),
        max_user_collateral: U128(10_000 * USD),
        max_position_notional: U128(10_000 * USD),
        min_collateral: U128(USD),
        max_positions_per_account: 5,
        liquidator_reward_bps: 2_000,
        insurance_fee_share_bps: 1_000,
    }
}

/// Test harness tracking time and the real token balance held by the contract.
struct H {
    c: Contract,
    t: u64,
    token_balance: u128,
}

impl H {
    fn new(limits: Limits) -> Self {
        ctx(&owner(), 0, T0);
        let mut c = Contract::new(owner(), oracle(), usdc(), limits);
        ctx(&owner(), 1, T0);
        c.add_market(NEAR_USD.into(), near_cfg());
        ctx(&owner(), 1, T0);
        c.add_market(GPU.into(), gpu_cfg());
        let mut h = H { c, t: T0, token_balance: 0 };
        h.price(NEAR_USD, 3 * USD);
        h.price(GPU, 2 * USD);
        h
    }
    fn tick(&mut self, secs: u64) {
        self.t += secs;
    }
    fn price(&mut self, m: &str, p: u128) {
        self.tick(1);
        ctx(&oracle(), 0, self.t);
        self.c.set_price(m.into(), U128(p), U64(self.t));
    }
    /// Move price in steps of at most 4% so the jump limit is respected.
    fn walk_price(&mut self, m: &str, target: u128) {
        loop {
            let cur = self.c.get_market(m.into()).unwrap().price.0;
            if cur == target {
                break;
            }
            let step = cur * 400 / 10_000;
            let next = if target > cur { (cur + step).min(target) } else { cur.saturating_sub(step).max(target) };
            self.price(m, next);
        }
    }
    fn register(&mut self, a: &AccountId) {
        ctx(a, STORAGE_DEPOSIT.as_yoctonear(), self.t);
        self.c.storage_deposit(None, None);
    }
    /// Returns the refunded amount.
    fn deposit(&mut self, a: &AccountId, amount: u128, msg: &str) -> u128 {
        ctx(&usdc(), 0, self.t);
        let refunded = match self.c.ft_on_transfer(a.clone(), U128(amount), msg.into()) {
            PromiseOrValue::Value(v) => v.0,
            PromiseOrValue::Promise(_) => panic!("unexpected promise"),
        };
        self.token_balance += amount - refunded;
        refunded
    }
    fn open(&mut self, a: &AccountId, m: &str, long: bool, collateral: u128, lev_x: u32) -> u64 {
        ctx(a, 0, self.t);
        let r = self.c.open_position(m.into(), long, U128(collateral), lev_x * 10_000);
        r.position_id.or(r.order_id).unwrap().0
    }
    fn close(&mut self, a: &AccountId, id: u64) {
        ctx(a, 0, self.t);
        self.c.close_position(U64(id));
    }
    fn account(&self, a: &AccountId) -> AccountView {
        self.c.get_account(a.clone()).unwrap()
    }
    fn free(&self, a: &AccountId) -> u128 {
        self.account(a).free.0
    }
    /// Everything the contract owes must equal the tokens it holds.
    fn assert_solvent(&self, accounts: &[AccountId]) {
        let users: u128 = accounts
            .iter()
            .filter_map(|a| self.c.get_account(a.clone()))
            .map(|v| v.free.0 + v.locked.0)
            .sum();
        let v = self.c.get_vault();
        assert_eq!(users + v.assets.0 + v.insurance.0, self.token_balance, "accounting invariant broken");
    }
    fn withdraw(&mut self, a: &AccountId, amount: u128) {
        ctx(a, 1, self.t);
        let _ = self.c.withdraw(U128(amount));
        self.token_balance -= amount;
    }
}

fn funded() -> H {
    let mut h = H::new(wide_limits());
    for a in [alice(), bob(), lp(), keeper()] {
        h.register(&a);
    }
    assert_eq!(h.deposit(&lp(), 1_000 * USD, "lp"), 0);
    assert_eq!(h.deposit(&alice(), 100 * USD, "deposit"), 0);
    assert_eq!(h.deposit(&bob(), 100 * USD, "deposit"), 0);
    h
}

fn all() -> Vec<AccountId> {
    vec![alice(), bob(), lp(), keeper()]
}

// ---------------- deposits ----------------

#[test]
#[should_panic(expected = "Unsupported token")]
fn fake_token_is_rejected() {
    let mut h = funded();
    ctx(&acc("evil.near"), 0, h.t);
    let _ = h.c.ft_on_transfer(alice(), U128(USD), "deposit".into());
}

#[test]
fn unregistered_over_cap_and_paused_deposits_are_refunded() {
    let mut limits = wide_limits();
    limits.max_user_collateral = U128(20 * USD);
    let mut h = H::new(limits);
    assert_eq!(h.deposit(&alice(), 5 * USD, "deposit"), 5 * USD, "unregistered");
    h.register(&alice());
    assert_eq!(h.deposit(&alice(), 15 * USD, "deposit"), 0);
    assert_eq!(h.deposit(&alice(), 6 * USD, "deposit"), 6 * USD, "over cap");
    assert_eq!(h.deposit(&alice(), 1 * USD, "bogus"), USD, "unknown msg");
    ctx(&owner(), 1, h.t);
    h.c.set_paused(true);
    assert_eq!(h.deposit(&alice(), 1 * USD, "deposit"), USD, "paused");
    assert_eq!(h.free(&alice()), 15 * USD);
}

#[test]
fn vault_cap_is_enforced() {
    let mut limits = wide_limits();
    limits.vault_cap = U128(200 * USD);
    let mut h = H::new(limits);
    h.register(&lp());
    assert_eq!(h.deposit(&lp(), 150 * USD, "lp"), 0);
    assert_eq!(h.deposit(&lp(), 60 * USD, "lp"), 60 * USD);
}

// ---------------- withdrawals ----------------

#[test]
fn withdraw_and_failed_transfer_restores_balance() {
    let mut h = funded();
    h.withdraw(&alice(), 30 * USD);
    assert_eq!(h.free(&alice()), 70 * USD);
    // simulate the ft_transfer failing
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("perps.near")).predecessor_account_id(acc("perps.near"));
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Failed]
    );
    assert!(!h.c.on_withdraw(alice(), U128(30 * USD), U128(0)));
    h.token_balance += 30 * USD;
    assert_eq!(h.free(&alice()), 100 * USD);
    h.assert_solvent(&all());
}

#[test]
fn successful_transfer_does_not_credit_twice() {
    let mut h = funded();
    h.withdraw(&alice(), 30 * USD);
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("perps.near")).predecessor_account_id(acc("perps.near"));
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(vec![])]
    );
    assert!(h.c.on_withdraw(alice(), U128(30 * USD), U128(0)));
    assert_eq!(h.free(&alice()), 70 * USD);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn withdraw_requires_one_yocto() {
    let mut h = funded();
    ctx(&alice(), 0, h.t);
    let _ = h.c.withdraw(U128(USD));
}

#[test]
#[should_panic(expected = "Not enough free balance")]
fn cannot_withdraw_locked_collateral() {
    let mut h = funded();
    h.open(&alice(), NEAR_USD, true, 95 * USD, 2);
    h.withdraw(&alice(), 10 * USD);
}

// ---------------- positions, PnL, fees ----------------

#[test]
fn liquidation_price_example_from_plan() {
    let mut h = funded();
    let id = h.open(&alice(), NEAR_USD, true, 10 * USD, 10);
    let pv = h.c.get_position(U64(id)).unwrap();
    assert_eq!(pv.notional.0, 100 * USD);
    let liq = pv.liquidation_price.0;
    assert!((2_849_900..=2_850_100).contains(&liq), "liq = {liq}");

    h.walk_price(NEAR_USD, 2_860_000);
    ctx(&keeper(), 0, h.t);
    assert!(!h.c.get_position(U64(id)).unwrap().liquidatable);

    h.price(NEAR_USD, 2_850_000);
    assert!(h.c.get_position(U64(id)).unwrap().liquidatable);
    assert!(h.c.get_liquidatable(None, None).iter().any(|p| p.0 == id));
    ctx(&keeper(), 0, h.t);
    let reward = h.c.liquidate(U64(id)).0;
    assert!(reward > 0 && reward <= USD, "reward = {reward}");
    assert_eq!(h.free(&keeper()), reward);
    assert!(h.c.get_position(U64(id)).is_none());
    assert_eq!(h.account(&alice()).locked.0, 0);
    h.assert_solvent(&all());
}

#[test]
#[should_panic(expected = "Position is not liquidatable")]
fn healthy_position_cannot_be_liquidated() {
    let mut h = funded();
    let id = h.open(&alice(), NEAR_USD, true, 10 * USD, 10);
    h.walk_price(NEAR_USD, 2_860_000);
    ctx(&keeper(), 0, h.t);
    h.c.liquidate(U64(id));
}

#[test]
fn realised_pnl_long_and_short() {
    let mut h = funded();
    let a = h.open(&alice(), NEAR_USD, true, 10 * USD, 2); // long 20
    let b = h.open(&bob(), NEAR_USD, false, 10 * USD, 2); // short 20
    let fee = 20 * USD * 10 / 10_000; // 0.02 per side
    assert_eq!(h.free(&alice()), 90 * USD - fee);
    h.walk_price(NEAR_USD, 3_150_000); // +5%
    h.close(&alice(), a);
    h.close(&bob(), b);
    let alice_free = h.free(&alice()) as i128;
    let bob_free = h.free(&bob()) as i128;
    // alice: 90 - fee + 10 + 1 (pnl) - fee - funding ; bob: 90 - fee + 10 - 1 - fee + funding
    let exp_alice = (100 * USD + USD - 2 * fee) as i128;
    let exp_bob = (100 * USD - USD - 2 * fee) as i128;
    assert!((alice_free - exp_alice).abs() < 2_000, "alice {alice_free} vs {exp_alice}");
    assert!((bob_free - exp_bob).abs() < 2_000, "bob {bob_free} vs {exp_bob}");
    h.assert_solvent(&all());
}

#[test]
fn fees_split_between_vault_and_insurance() {
    let mut h = funded();
    let before = h.c.get_vault();
    h.open(&alice(), NEAR_USD, true, 10 * USD, 10); // N = 100, fee = 0.1
    let after = h.c.get_vault();
    let fee = 100_000;
    assert_eq!(after.insurance.0 - before.insurance.0, fee / 10);
    assert_eq!(after.assets.0 - before.assets.0, fee - fee / 10);
    h.assert_solvent(&all());
}

// ---------------- LP vault ----------------

#[test]
fn lp_shares_track_trader_pnl() {
    let mut h = funded();
    let v = h.c.get_vault();
    assert_eq!(v.total_shares.0, 1_000 * USD, "first deposit is 1:1");
    assert_eq!(v.share_price.0, 1_000_000);
    h.open(&alice(), NEAR_USD, true, 50 * USD, 4); // long 200
    h.walk_price(NEAR_USD, 3_300_000); // +10%: trader +20, vault -20
    let v = h.c.get_vault();
    assert!(v.share_price.0 < 1_000_000, "LP loses when trader wins");
    h.walk_price(NEAR_USD, 2_850_000); // -5%: trader -10
    let v = h.c.get_vault();
    assert!(v.share_price.0 > 1_000_000, "LP gains when trader loses");
    // a second LP joins at the current share price
    h.register(&acc("lp2.near"));
    h.deposit(&acc("lp2.near"), 100 * USD, "lp");
    let s2 = h.account(&acc("lp2.near")).lp_shares.0;
    assert!(s2 < 100 * USD);
}

#[test]
#[should_panic(expected = "Withdrawal would push open interest over the limit")]
fn lp_withdraw_blocked_by_open_interest() {
    let mut h = funded();
    h.open(&alice(), NEAR_USD, true, 50 * USD, 7); // 350 long of max 400
    ctx(&lp(), 1, h.t);
    let _ = h.c.lp_withdraw(U128(500 * USD));
}

#[test]
fn lp_withdraw_and_failed_transfer_restores_shares() {
    let mut h = funded();
    ctx(&lp(), 1, h.t);
    let _ = h.c.lp_withdraw(U128(100 * USD));
    h.token_balance -= 100 * USD;
    assert_eq!(h.account(&lp()).lp_shares.0, 900 * USD);
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("perps.near")).predecessor_account_id(acc("perps.near"));
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Failed]
    );
    h.c.on_withdraw(lp(), U128(100 * USD), U128(100 * USD));
    h.token_balance += 100 * USD;
    assert_eq!(h.account(&lp()).lp_shares.0, 1_000 * USD);
    h.assert_solvent(&all());
}

#[test]
fn lp_actions_need_fresh_prices_when_there_is_open_interest() {
    let mut h = funded();
    h.open(&alice(), NEAR_USD, true, 10 * USD, 2);
    h.tick(601); // NEAR-USD price is now stale
    assert_eq!(h.deposit(&lp(), 10 * USD, "lp"), 10 * USD, "refunded");
    ctx(&lp(), 1, h.t);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = h.c.lp_withdraw(U128(10 * USD));
    }));
    assert!(r.is_err());
    h.price(NEAR_USD, 3 * USD);
    assert_eq!(h.deposit(&lp(), 10 * USD, "lp"), 0);
}

// ---------------- limits ----------------

#[test]
#[should_panic(expected = "Open interest limit reached for this side")]
fn open_interest_cap() {
    let mut h = funded();
    h.open(&alice(), NEAR_USD, true, 41 * USD, 10); // 410 > 40% of 1000
}

#[test]
#[should_panic(expected = "Position notional above limit")]
fn position_notional_cap() {
    let mut limits = wide_limits();
    limits.max_position_notional = U128(50 * USD);
    let mut h = H::new(limits);
    h.register(&alice());
    h.register(&lp());
    h.deposit(&lp(), 1_000 * USD, "lp");
    h.deposit(&alice(), 20 * USD, "deposit");
    h.open(&alice(), NEAR_USD, true, 10 * USD, 6);
}

#[test]
#[should_panic(expected = "Too many open positions or orders")]
fn max_positions_per_account() {
    let mut h = funded();
    for _ in 0..6 {
        h.open(&alice(), NEAR_USD, true, 2 * USD, 2);
    }
}

#[test]
#[should_panic(expected = "Leverage above market maximum")]
fn leverage_cap() {
    let mut h = funded();
    h.open(&alice(), NEAR_USD, true, 2 * USD, 11);
}

// ---------------- oracle ----------------

#[test]
#[should_panic(expected = "Oracle price is stale")]
fn stale_price_blocks_open() {
    let mut h = funded();
    h.tick(601);
    h.open(&alice(), NEAR_USD, true, 2 * USD, 2);
}

#[test]
#[should_panic(expected = "Oracle price is stale")]
fn stale_price_blocks_close() {
    let mut h = funded();
    let id = h.open(&alice(), NEAR_USD, true, 2 * USD, 2);
    h.tick(601);
    h.close(&alice(), id);
}

#[test]
#[should_panic(expected = "Price jump above limit")]
fn price_jump_rejected() {
    let mut h = funded();
    h.price(NEAR_USD, 3_200_000); // +6.7%
}

#[test]
fn owner_can_force_price() {
    let mut h = funded();
    h.tick(1);
    ctx(&owner(), 1, h.t);
    h.c.set_price_force(NEAR_USD.into(), U128(3_300_000), U64(h.t));
    assert_eq!(h.c.get_market(NEAR_USD.into()).unwrap().price.0, 3_300_000);
}

#[test]
#[should_panic(expected = "Only the oracle")]
fn only_oracle_sets_price() {
    let mut h = funded();
    ctx(&alice(), 0, h.t + 1);
    h.c.set_price(NEAR_USD.into(), U128(3 * USD), U64(h.t + 1));
}

#[test]
#[should_panic(expected = "Timestamp must be newer than the last price")]
fn old_timestamp_rejected() {
    let mut h = funded();
    ctx(&oracle(), 0, h.t);
    h.c.set_price(NEAR_USD.into(), U128(3 * USD), U64(h.t - 5));
}

// ---------------- funding ----------------

#[test]
fn funding_long_pays_when_skewed_long() {
    let mut h = funded();
    let a = h.open(&alice(), NEAR_USD, true, 40 * USD, 5); // long 200 vs NAV 1000 -> rate = 10 * 0.2 = 2 bps/h
    for _ in 0..10 {
        h.tick(359);
        h.price(NEAR_USD, 3 * USD); // touches the market, accrues funding
    }
    let pa = h.c.get_position(U64(a)).unwrap();
    // ~1 hour at 2 bps/h on 200 = 0.04 USDC
    assert!((35_000..=45_000).contains(&pa.funding_owed.0), "funding = {}", pa.funding_owed.0);
    // a short opened now owes nothing yet
    let b = h.open(&bob(), NEAR_USD, false, 10 * USD, 2);
    assert!(h.c.get_position(U64(b)).unwrap().funding_owed.0.abs() <= 1);
    assert!(h.c.get_vault().pending_funding.0 > 0);
    h.close(&alice(), a);
    h.assert_solvent(&all());
}

// ---------------- bad debt ----------------

#[test]
fn bad_debt_is_covered_by_insurance_first() {
    let mut h = funded();
    // build up insurance with round trips
    for _ in 0..4 {
        let id = h.open(&bob(), NEAR_USD, true, 20 * USD, 10);
        h.close(&bob(), id);
    }
    let ins_before = h.c.get_vault().insurance.0;
    assert!(ins_before > 0);
    let id = h.open(&alice(), NEAR_USD, true, 10 * USD, 10);
    // gap down 10% past the liquidation price without anyone liquidating
    h.tick(1);
    ctx(&owner(), 1, h.t);
    h.c.set_price_force(NEAR_USD.into(), U128(2_600_000), U64(h.t));
    let eq = h.c.get_position(U64(id)).unwrap().equity.0;
    assert!(eq < 0, "equity should be negative, got {eq}");
    ctx(&keeper(), 0, h.t);
    let reward = h.c.liquidate(U64(id)).0;
    assert_eq!(reward, 0);
    let ins_after = h.c.get_vault().insurance.0;
    assert_eq!(ins_after, ins_before.saturating_sub((-eq) as u128));
    h.assert_solvent(&all());
}

// ---------------- two-step market ----------------

#[test]
fn two_step_open_and_close() {
    let mut h = funded();
    let order = h.open(&alice(), GPU, true, 10 * USD, 2);
    assert_eq!(h.account(&alice()).orders.len(), 1);
    assert_eq!(h.account(&alice()).locked.0, 10 * USD + 20_000);
    // same-price execution is impossible
    ctx(&keeper(), 0, h.t);
    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        h.c.execute_order(U64(order));
    }));
    assert!(res.is_err(), "must wait for a newer price");

    h.tick(3600);
    h.price(GPU, 2_100_000);
    ctx(&keeper(), 0, h.t);
    assert!(h.c.execute_order(U64(order)));
    let positions = h.c.get_positions_of(alice());
    assert_eq!(positions.len(), 1);
    assert_eq!(positions[0].entry_price.0, 2_100_000, "executed at the new price, not the old one");

    let pid = positions[0].id.0;
    ctx(&alice(), 0, h.t);
    let close_order = h.c.close_position(U64(pid)).expect("two-step close returns an order");
    h.tick(3600);
    h.price(GPU, 2_200_000);
    ctx(&keeper(), 0, h.t);
    assert!(h.c.execute_order(close_order));
    assert!(h.c.get_positions_of(alice()).is_empty());
    assert_eq!(h.account(&alice()).locked.0, 0);
    h.assert_solvent(&all());
}

#[test]
fn cancel_order_refunds() {
    let mut h = funded();
    let order = h.open(&alice(), GPU, true, 10 * USD, 2);
    ctx(&alice(), 0, h.t);
    h.c.cancel_order(U64(order));
    assert_eq!(h.free(&alice()), 100 * USD);
    assert_eq!(h.account(&alice()).locked.0, 0);
    h.assert_solvent(&all());
}

// ---------------- admin ----------------

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn admin_requires_one_yocto() {
    let mut h = funded();
    ctx(&owner(), 0, h.t);
    h.c.set_paused(true);
}

#[test]
#[should_panic(expected = "Only the owner")]
fn admin_requires_owner() {
    let mut h = funded();
    ctx(&alice(), 1, h.t);
    h.c.set_paused(true);
}

#[test]
fn pause_blocks_open_but_not_close_or_withdraw() {
    let mut h = funded();
    let id = h.open(&alice(), NEAR_USD, true, 10 * USD, 2);
    ctx(&owner(), 1, h.t);
    h.c.set_paused(true);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        h.open(&alice(), NEAR_USD, true, 2 * USD, 2);
    }));
    assert!(r.is_err());
    h.close(&alice(), id);
    h.withdraw(&alice(), 50 * USD);
    h.assert_solvent(&all());
}

#[test]
fn storage_unregister_only_when_empty() {
    let mut h = H::new(wide_limits());
    h.register(&alice());
    ctx(&alice(), 1, h.t);
    assert!(h.c.storage_unregister(None));
    assert!(h.c.get_account(alice()).is_none());
}

/// Run the `on_withdraw` callback as if the token transfer had `result`.
fn resolve_withdraw(h: &mut H, who: &AccountId, amount: u128, result: PromiseResult) -> bool {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("perps.near")).predecessor_account_id(acc("perps.near"));
    testing_env!(b.build(), near_sdk::test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![result]);
    h.c.on_withdraw(who.clone(), U128(amount), U128(0))
}

#[test]
#[should_panic(expected = "A withdrawal is still in flight")]
fn cannot_unregister_while_a_withdrawal_is_in_flight() {
    let mut h = funded();
    h.withdraw(&alice(), 100 * USD);
    ctx(&alice(), 1, h.t);
    h.c.storage_unregister(None);
}

#[test]
fn failed_withdrawal_refunds_a_still_registered_account_then_unregister_works() {
    let mut h = funded();
    h.withdraw(&alice(), 100 * USD);
    assert!(!resolve_withdraw(&mut h, &alice(), 100 * USD, PromiseResult::Failed));
    h.token_balance += 100 * USD;
    assert_eq!(h.free(&alice()), 100 * USD);
    h.assert_solvent(&all());
    // The refund cleared the in-flight marker; after a real withdrawal that succeeds, unregister is allowed.
    h.withdraw(&alice(), 100 * USD);
    assert!(resolve_withdraw(&mut h, &alice(), 100 * USD, PromiseResult::Successful(vec![])));
    ctx(&alice(), 1, h.t);
    assert!(h.c.storage_unregister(None));
    assert!(h.c.get_account(alice()).is_none());
}

#[test]
fn two_withdrawals_in_flight_block_unregister_until_both_resolve() {
    let mut h = funded();
    h.withdraw(&alice(), 40 * USD);
    h.withdraw(&alice(), 60 * USD);
    assert!(resolve_withdraw(&mut h, &alice(), 40 * USD, PromiseResult::Successful(vec![])));
    ctx(&alice(), 1, h.t);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| h.c.storage_unregister(None))).is_err());
    assert!(resolve_withdraw(&mut h, &alice(), 60 * USD, PromiseResult::Successful(vec![])));
    ctx(&alice(), 1, h.t);
    assert!(h.c.storage_unregister(None));
}

#[test]
fn lp_deposit_is_refunded_when_shares_exist_but_nav_is_zero() {
    let mut h = funded();
    // alice goes long the max allowed and the price runs far enough to wipe out the vault's NAV.
    h.open(&alice(), NEAR_USD, true, 40 * USD, 10);
    h.walk_price(NEAR_USD, 12 * USD);
    assert_eq!(h.c.get_vault().nav.0, 0);
    assert!(h.c.get_vault().total_shares.0 > 0);
    h.register(&bob());
    let before = h.c.get_vault();
    assert_eq!(h.deposit(&bob(), 100 * USD, "lp"), 100 * USD, "refunded, not diluted");
    let after = h.c.get_vault();
    assert_eq!(before.total_shares.0, after.total_shares.0);
    assert_eq!(before.assets.0, after.assets.0);
    assert_eq!(h.account(&bob()).lp_shares.0, 0);
    h.assert_solvent(&all());
}

// ---------------- launch markets: BTC, ETH, NEAR ----------------

#[test]
fn three_crypto_markets_with_large_prices() {
    let mut h = funded();
    for (id, px) in [("BTC-USD", 100_000 * USD), ("ETH-USD", 3_500 * USD)] {
        ctx(&owner(), 1, h.t);
        h.c.add_market(id.into(), near_cfg());
        h.price(id, px);
    }
    assert_eq!(h.c.get_markets().len(), 4);
    let btc = h.open(&alice(), "BTC-USD", true, 10 * USD, 5); // long 50
    let eth = h.open(&bob(), "ETH-USD", false, 10 * USD, 5); // short 50
    let near = h.open(&alice(), NEAR_USD, true, 10 * USD, 5);
    h.walk_price("BTC-USD", 102_000 * USD); // +2% -> +1.00
    h.walk_price("ETH-USD", 3_430 * USD); // -2% -> short +1.00
    let p = h.c.get_position(U64(btc)).unwrap();
    assert!((p.pnl.0 - USD as i128).abs() <= 2, "btc pnl = {}", p.pnl.0);
    // 5x, 5% mm: liquidation at entry * (1 - 0.2 + 0.05) = 85_000
    assert!((p.liquidation_price.0 as i128 - (85_000 * USD) as i128).abs() < 200 * USD as i128 / 100);
    let p = h.c.get_position(U64(eth)).unwrap();
    assert!((p.pnl.0 - USD as i128).abs() <= 2, "eth pnl = {}", p.pnl.0);
    h.price(NEAR_USD, 3 * USD);
    h.close(&alice(), btc);
    h.close(&bob(), eth);
    h.close(&alice(), near);
    h.assert_solvent(&all());
}

// ---------------- full scenario ----------------

#[test]
fn many_operations_keep_accounting_exact() {
    let mut h = funded();
    let mut ids = vec![];
    ids.push(h.open(&alice(), NEAR_USD, true, 10 * USD, 5));
    ids.push(h.open(&bob(), NEAR_USD, false, 15 * USD, 3));
    ids.push(h.open(&alice(), NEAR_USD, false, 5 * USD, 8));
    h.walk_price(NEAR_USD, 3_250_000);
    h.tick(1800);
    h.price(NEAR_USD, 3_250_000);
    // alice's 8x short is now under water -> liquidate
    let liq = h.c.get_liquidatable(None, None);
    ctx(&keeper(), 0, h.t);
    for p in liq {
        h.c.liquidate(p);
    }
    h.assert_solvent(&all());
    for (who, id) in [(alice(), ids[0]), (bob(), ids[1])] {
        if h.c.get_position(U64(id)).is_some() {
            h.close(&who, id);
        }
    }
    h.assert_solvent(&all());
    let free = h.free(&alice());
    h.withdraw(&alice(), free);
    ctx(&lp(), 1, h.t);
    let shares = h.account(&lp()).lp_shares.0;
    let _ = h.c.lp_withdraw(U128(shares / 2));
    let v = h.c.get_vault();
    // LP withdrawal amount isn't returned; recompute from invariant
    let users: u128 = all().iter().filter_map(|a| h.c.get_account(a.clone())).map(|v| v.free.0 + v.locked.0).sum();
    assert!(users + v.assets.0 + v.insurance.0 <= h.token_balance);
}
