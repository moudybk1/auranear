//! Aura: pool-based perpetual futures on NEAR.
//!
//! * Traders deposit a NEP-141 stablecoin (USDC) and open long/short positions.
//! * The LP vault is the counterparty to every position.
//! * Prices are pushed by a single oracle account (stored on-chain, read synchronously).
//! * Funding uses a cumulative index, so no call ever loops over all positions.
//! * Markets with `two_step = true` (GPU index) execute orders only at the next oracle price.
//!
//! Hackathon prototype. Not audited. Guarded by hard caps and a pause switch.

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds};
use near_sdk::json_types::{I128, U128, U64};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    assert_one_yocto, env, ext_contract, log, near, require, AccountId, Gas, NearToken, PanicOnDefault,
    Promise, PromiseError, PromiseOrValue,
};

pub mod math;
pub mod types;

#[cfg(test)]
mod tests;

use math::*;
use types::*;

/// NEAR locked per registered account to pay for its storage (account + up to a few positions).
pub const STORAGE_DEPOSIT: NearToken = NearToken::from_millinear(20); // 0.02 NEAR
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_WITHDRAW_CALLBACK: Gas = Gas::from_tgas(10);

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    oracle: AccountId,
    collateral_token: AccountId,
    paused: bool,
    limits: Limits,
    vault: Vault,
    accounts: LookupMap<AccountId, Account>,
    markets: IterableMap<String, Market>,
    positions: IterableMap<u64, Position>,
    orders: IterableMap<u64, Order>,
    next_position_id: u64,
    next_order_id: u64,
}

fn now_sec() -> u64 {
    env::block_timestamp() / NS_PER_SEC
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    log!(
        "EVENT_JSON:{}",
        near_sdk::serde_json::json!({
            "standard": "aura-perps",
            "version": "1.0.0",
            "event": event,
            "data": data,
        })
    );
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, oracle: AccountId, collateral_token: AccountId, limits: Limits) -> Self {
        Self {
            owner,
            oracle,
            collateral_token,
            paused: false,
            limits,
            vault: Vault::default(),
            accounts: LookupMap::new(StorageKey::Accounts),
            markets: IterableMap::new(StorageKey::Markets),
            positions: IterableMap::new(StorageKey::Positions),
            orders: IterableMap::new(StorageKey::Orders),
            next_position_id: 0,
            next_order_id: 0,
        }
    }

    // =====================================================================
    // Storage management (NEP-145, simplified: fixed deposit, no extra balance)
    // =====================================================================

    #[payable]
    pub fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        let _ = registration_only;
        let account_id = account_id.unwrap_or_else(env::predecessor_account_id);
        let attached = env::attached_deposit();
        if self.accounts.contains_key(&account_id) {
            if !attached.is_zero() {
                let _ = Promise::new(env::predecessor_account_id()).transfer(attached);
            }
        } else {
            require!(attached >= STORAGE_DEPOSIT, "Attach at least 0.02 NEAR for storage");
            self.accounts.insert(account_id.clone(), Account::default());
            let refund = attached.saturating_sub(STORAGE_DEPOSIT);
            if !refund.is_zero() {
                let _ = Promise::new(env::predecessor_account_id()).transfer(refund);
            }
        }
        self.storage_balance()
    }

    /// Unregister an empty account and get the storage deposit back.
    #[payable]
    pub fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        assert_one_yocto();
        require!(force != Some(true), "Force unregister is not supported");
        let account_id = env::predecessor_account_id();
        let Some(acc) = self.accounts.get(&account_id) else {
            return false;
        };
        require!(
            acc.free == 0 && acc.locked == 0 && acc.lp_shares == 0 && acc.positions.is_empty() && acc.orders.is_empty(),
            "Account is not empty"
        );
        self.accounts.remove(&account_id);
        let _ = Promise::new(account_id).transfer(STORAGE_DEPOSIT);
        true
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.accounts.contains_key(&account_id).then(|| self.storage_balance())
    }

    pub fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        StorageBalanceBounds { min: STORAGE_DEPOSIT, max: Some(STORAGE_DEPOSIT) }
    }

    // =====================================================================
    // Withdrawals (require a full-access key via 1 yocto)
    // =====================================================================

    #[payable]
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        assert_one_yocto();
        let account_id = env::predecessor_account_id();
        let amount = amount.0;
        require!(amount > 0, "Amount must be positive");
        let mut acc = self.get_account_or_panic(&account_id);
        require!(acc.free >= amount, "Not enough free balance");
        acc.free -= amount;
        self.accounts.insert(account_id.clone(), acc);
        emit("withdraw", near_sdk::serde_json::json!({"account_id": account_id, "amount": U128(amount)}));
        self.send_collateral(account_id, amount, 0)
    }

    #[payable]
    pub fn lp_withdraw(&mut self, shares: U128) -> Promise {
        assert_one_yocto();
        let account_id = env::predecessor_account_id();
        let shares = shares.0;
        require!(shares > 0, "Shares must be positive");
        let mut acc = self.get_account_or_panic(&account_id);
        require!(acc.lp_shares >= shares, "Not enough LP shares");
        require!(self.nav_is_reliable(), "A market with open interest has a stale price, try again later");
        self.accrue_all_funding();
        let nav = self.nav();
        let amount = shares * nav / self.vault.total_shares;
        require!(amount > 0, "Nothing to withdraw");
        require!(amount <= self.vault.assets, "Vault liquidity is locked, try a smaller amount");
        let new_nav = nav - amount;
        for (_, m) in self.markets.iter() {
            let max_side = bps_of(new_nav, m.config.max_oi_bps_of_nav as u128);
            require!(
                m.long_notional.max(m.short_notional) <= max_side,
                "Withdrawal would push open interest over the limit"
            );
        }
        acc.lp_shares -= shares;
        self.vault.total_shares -= shares;
        self.vault.assets -= amount;
        self.accounts.insert(account_id.clone(), acc);
        emit(
            "lp_withdraw",
            near_sdk::serde_json::json!({"account_id": account_id, "shares": U128(shares), "amount": U128(amount)}),
        );
        self.send_collateral(account_id, amount, shares)
    }

    /// Callback after a collateral transfer. Restores balances if the transfer failed.
    #[private]
    pub fn on_withdraw(&mut self, account_id: AccountId, amount: U128, lp_shares: U128) -> bool {
        // Only an explicit failure restores balances; any returned data counts as success,
        // so a successful transfer can never be credited twice.
        let ok = !matches!(env::promise_result_checked(0, 1024), Err(PromiseError::Failed));
        if !ok {
            let mut acc = self.accounts.get(&account_id).cloned().unwrap_or_default();
            if lp_shares.0 > 0 {
                acc.lp_shares += lp_shares.0;
                self.vault.total_shares += lp_shares.0;
                self.vault.assets += amount.0;
            } else {
                acc.free += amount.0;
            }
            self.accounts.insert(account_id.clone(), acc);
            emit(
                "withdraw_refunded",
                near_sdk::serde_json::json!({"account_id": account_id, "amount": amount, "lp_shares": lp_shares}),
            );
        }
        ok
    }

    // =====================================================================
    // Trading
    // =====================================================================

    /// Open a position. On two-step markets this creates an order executed at the next oracle price.
    pub fn open_position(
        &mut self,
        market_id: String,
        is_long: bool,
        collateral: U128,
        leverage_bps: u32,
    ) -> OpenResult {
        require!(!self.paused, "Paused");
        let owner = env::predecessor_account_id();
        let market = self.get_market_or_panic(&market_id).clone();
        let collateral = collateral.0;
        let notional = self.check_open_params(&market.config, collateral, leverage_bps);
        let fee = bps_of(notional, market.config.fee_bps as u128);
        let mut acc = self.get_account_or_panic(&owner);
        require!(
            acc.positions.len() + acc.orders.len() < self.limits.max_positions_per_account as usize,
            "Too many open positions or orders"
        );
        require!(acc.free >= collateral + fee, "Not enough free balance for collateral + fee");

        if market.config.two_step {
            acc.free -= collateral + fee;
            acc.locked += collateral + fee;
            let id = self.next_order_id;
            self.next_order_id += 1;
            acc.orders.push(id);
            self.accounts.insert(owner.clone(), acc);
            self.orders.insert(
                id,
                Order {
                    owner: owner.clone(),
                    market_id: market_id.clone(),
                    kind: OrderKind::Open { is_long, collateral: U128(collateral), leverage_bps },
                    created_at_sec: now_sec(),
                    reserved: collateral + fee,
                },
            );
            emit("order_created", near_sdk::serde_json::json!({"order_id": U64(id), "owner": owner, "market_id": market_id}));
            return OpenResult { position_id: None, order_id: Some(U64(id)) };
        }

        acc.free -= collateral + fee;
        self.accounts.insert(owner.clone(), acc);
        let id = self.open_internal(&owner, &market_id, is_long, collateral, leverage_bps, fee);
        OpenResult { position_id: Some(U64(id)), order_id: None }
    }

    /// Close a position. On two-step markets this creates a close order.
    pub fn close_position(&mut self, position_id: U64) -> Option<U64> {
        let caller = env::predecessor_account_id();
        let pos = self.get_position_or_panic(position_id.0).clone();
        require!(pos.owner == caller, "Not your position");
        let two_step = self.get_market_or_panic(&pos.market_id).config.two_step;
        if two_step {
            let mut acc = self.get_account_or_panic(&caller);
            require!(
                !self.orders.values().any(|o| matches!(o.kind, OrderKind::Close { position_id: p } if p.0 == position_id.0)),
                "Close order already pending"
            );
            let id = self.next_order_id;
            self.next_order_id += 1;
            acc.orders.push(id);
            self.accounts.insert(caller.clone(), acc);
            self.orders.insert(
                id,
                Order {
                    owner: caller.clone(),
                    market_id: pos.market_id.clone(),
                    kind: OrderKind::Close { position_id },
                    created_at_sec: now_sec(),
                    reserved: 0,
                },
            );
            emit("order_created", near_sdk::serde_json::json!({"order_id": U64(id), "owner": caller, "market_id": pos.market_id}));
            return Some(U64(id));
        }
        self.close_internal(position_id.0);
        None
    }

    /// Execute a pending order once an oracle price newer than the order exists. Callable by anyone.
    pub fn execute_order(&mut self, order_id: U64) -> bool {
        let order = self.orders.get(&order_id.0).cloned().unwrap_or_else(|| env::panic_str("Order not found"));
        let market = self.get_market_or_panic(&order.market_id).clone();
        require!(market.price_ts_sec > order.created_at_sec, "Waiting for the next oracle price");
        require!(self.is_fresh(&market), "Oracle price is stale");
        self.orders.remove(&order_id.0);
        let mut acc = self.get_account_or_panic(&order.owner);
        acc.orders.retain(|o| *o != order_id.0);

        match order.kind.clone() {
            OrderKind::Open { is_long, collateral, leverage_bps } => {
                acc.locked -= order.reserved;
                acc.free += order.reserved;
                self.accounts.insert(order.owner.clone(), acc);
                if self.paused || !self.open_would_succeed(&order.market_id, is_long, collateral.0, leverage_bps) {
                    emit("order_cancelled", near_sdk::serde_json::json!({"order_id": order_id, "reason": "limits"}));
                    return false;
                }
                let fee = bps_of(collateral.0 * leverage_bps as u128 / BPS, market.config.fee_bps as u128);
                let mut acc = self.get_account_or_panic(&order.owner);
                acc.free -= collateral.0 + fee;
                self.accounts.insert(order.owner.clone(), acc);
                self.open_internal(&order.owner, &order.market_id, is_long, collateral.0, leverage_bps, fee);
                true
            }
            OrderKind::Close { position_id } => {
                self.accounts.insert(order.owner.clone(), acc);
                if self.positions.get(&position_id.0).is_none() {
                    emit("order_cancelled", near_sdk::serde_json::json!({"order_id": order_id, "reason": "position gone"}));
                    return false;
                }
                self.close_internal(position_id.0);
                true
            }
        }
    }

    pub fn cancel_order(&mut self, order_id: U64) {
        let caller = env::predecessor_account_id();
        let order = self.orders.get(&order_id.0).cloned().unwrap_or_else(|| env::panic_str("Order not found"));
        require!(order.owner == caller, "Not your order");
        self.orders.remove(&order_id.0);
        let mut acc = self.get_account_or_panic(&caller);
        acc.orders.retain(|o| *o != order_id.0);
        acc.locked -= order.reserved;
        acc.free += order.reserved;
        self.accounts.insert(caller, acc);
        emit("order_cancelled", near_sdk::serde_json::json!({"order_id": order_id, "reason": "user"}));
    }

    /// Liquidate an under-margined position. Callable by any registered account; reward goes to the caller.
    pub fn liquidate(&mut self, position_id: U64) -> U128 {
        let liquidator = env::predecessor_account_id();
        require!(self.accounts.contains_key(&liquidator), "Liquidator must be registered (storage_deposit)");
        let pos = self.get_position_or_panic(position_id.0).clone();
        self.accrue_funding(&pos.market_id);
        let market = self.get_market_or_panic(&pos.market_id).clone();
        require!(self.is_fresh(&market), "Oracle price is stale");

        let pnl = position_pnl(pos.is_long, pos.units, pos.notional, market.price);
        let f = funding_owed(pos.is_long, pos.notional, pos.funding_index_open, market.funding_index);
        let equity = pos.collateral as i128 + pnl - f;
        let mm = bps_of(pos.notional, market.config.maintenance_margin_bps as u128);
        require!(equity <= mm as i128, "Position is not liquidatable");

        let remaining = equity.max(0) as u128;
        let reward = bps_of(remaining, self.limits.liquidator_reward_bps as u128);
        let bad_debt = if equity < 0 { (-equity) as u128 } else { 0 };
        let cover = bad_debt.min(self.vault.insurance);
        self.vault.insurance -= cover;

        self.remove_position_aggregates(&pos);
        self.vault.pending_funding -= f;
        self.vault.assets += pos.collateral - reward + cover;

        let mut owner_acc = self.get_account_or_panic(&pos.owner);
        owner_acc.locked -= pos.collateral;
        owner_acc.positions.retain(|p| *p != position_id.0);
        self.accounts.insert(pos.owner.clone(), owner_acc);
        let mut liq_acc = self.get_account_or_panic(&liquidator);
        liq_acc.free += reward;
        self.accounts.insert(liquidator.clone(), liq_acc);
        self.positions.remove(&position_id.0);

        emit(
            "liquidate",
            near_sdk::serde_json::json!({
                "position_id": position_id, "owner": pos.owner, "liquidator": liquidator,
                "price": U128(market.price), "equity": I128(equity), "reward": U128(reward),
                "bad_debt": U128(bad_debt), "insurance_cover": U128(cover),
            }),
        );
        U128(reward)
    }

    // =====================================================================
    // Oracle
    // =====================================================================

    pub fn set_price(&mut self, market_id: String, price: U128, ts_sec: U64) {
        require!(env::predecessor_account_id() == self.oracle, "Only the oracle");
        self.set_price_internal(market_id, price.0, ts_sec.0, false);
    }

    /// Owner override for large legitimate moves or oracle recovery.
    #[payable]
    pub fn set_price_force(&mut self, market_id: String, price: U128, ts_sec: U64) {
        assert_one_yocto();
        self.assert_owner();
        self.set_price_internal(market_id, price.0, ts_sec.0, true);
    }

    // =====================================================================
    // Admin
    // =====================================================================

    #[payable]
    pub fn add_market(&mut self, market_id: String, config: MarketConfig) {
        assert_one_yocto();
        self.assert_owner();
        require!(!self.markets.contains_key(&market_id), "Market exists");
        Self::validate_market_config(&config);
        self.markets.insert(
            market_id.clone(),
            Market {
                config,
                price: 0,
                price_ts_sec: 0,
                long_notional: 0,
                short_notional: 0,
                long_units: 0,
                short_units: 0,
                funding_index: 0,
                last_funding_ns: env::block_timestamp(),
            },
        );
        emit("market_added", near_sdk::serde_json::json!({"market_id": market_id}));
    }

    #[payable]
    pub fn update_market_config(&mut self, market_id: String, config: MarketConfig) {
        assert_one_yocto();
        self.assert_owner();
        Self::validate_market_config(&config);
        self.accrue_funding(&market_id);
        let mut m = self.get_market_or_panic(&market_id).clone();
        m.config = config;
        self.markets.insert(market_id, m);
    }

    #[payable]
    pub fn update_limits(&mut self, limits: Limits) {
        assert_one_yocto();
        self.assert_owner();
        require!(limits.liquidator_reward_bps as u128 <= BPS, "Bad liquidator reward");
        require!(limits.insurance_fee_share_bps as u128 <= BPS, "Bad insurance share");
        self.limits = limits;
    }

    #[payable]
    pub fn set_paused(&mut self, paused: bool) {
        assert_one_yocto();
        self.assert_owner();
        self.paused = paused;
        emit("paused", near_sdk::serde_json::json!({"paused": paused}));
    }

    #[payable]
    pub fn set_oracle(&mut self, oracle: AccountId) {
        assert_one_yocto();
        self.assert_owner();
        self.oracle = oracle;
    }

    #[payable]
    pub fn set_owner(&mut self, owner: AccountId) {
        assert_one_yocto();
        self.assert_owner();
        self.owner = owner;
    }

    // =====================================================================
    // Views
    // =====================================================================

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            owner: self.owner.clone(),
            oracle: self.oracle.clone(),
            collateral_token: self.collateral_token.clone(),
            paused: self.paused,
            limits: self.limits.clone(),
            storage_deposit_yocto: U128(STORAGE_DEPOSIT.as_yoctonear()),
        }
    }

    pub fn get_vault(&self) -> VaultView {
        let nav = self.nav_with_projected_funding();
        let share_price = if self.vault.total_shares == 0 {
            PRICE_SCALE
        } else {
            nav * PRICE_SCALE / self.vault.total_shares
        };
        VaultView {
            assets: U128(self.vault.assets),
            insurance: U128(self.vault.insurance),
            total_shares: U128(self.vault.total_shares),
            nav: U128(nav),
            share_price: U128(share_price),
            pending_funding: I128(self.vault.pending_funding),
        }
    }

    pub fn get_markets(&self) -> Vec<MarketView> {
        self.markets.keys().map(|id| self.market_view(id)).collect()
    }

    pub fn get_market(&self, market_id: String) -> Option<MarketView> {
        self.markets.contains_key(&market_id).then(|| self.market_view(&market_id))
    }

    pub fn get_account(&self, account_id: AccountId) -> Option<AccountView> {
        self.accounts.get(&account_id).map(|a| {
            let nav = self.nav_with_projected_funding();
            let lp_value = if self.vault.total_shares == 0 { 0 } else { a.lp_shares * nav / self.vault.total_shares };
            AccountView {
                free: U128(a.free),
                locked: U128(a.locked),
                lp_shares: U128(a.lp_shares),
                lp_value: U128(lp_value),
                positions: a.positions.iter().map(|p| U64(*p)).collect(),
                orders: a.orders.iter().map(|o| U64(*o)).collect(),
            }
        })
    }

    pub fn get_position(&self, position_id: U64) -> Option<PositionView> {
        self.positions.get(&position_id.0).map(|p| self.position_view(position_id.0, p))
    }

    pub fn get_positions_of(&self, account_id: AccountId) -> Vec<PositionView> {
        self.accounts
            .get(&account_id)
            .map(|a| {
                a.positions
                    .iter()
                    .filter_map(|id| self.positions.get(id).map(|p| self.position_view(*id, p)))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Paged list of liquidatable position ids (for keepers).
    pub fn get_liquidatable(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<U64> {
        self.positions
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(100) as usize)
            .filter(|(id, p)| self.position_view(**id, p).liquidatable)
            .map(|(id, _)| U64(*id))
            .collect()
    }

    pub fn get_positions(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<PositionView> {
        self.positions
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(100) as usize)
            .map(|(id, p)| self.position_view(*id, p))
            .collect()
    }

    pub fn get_orders(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<OrderView> {
        self.orders
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(100) as usize)
            .map(|(id, o)| {
                let m = self.markets.get(&o.market_id);
                OrderView {
                    id: U64(*id),
                    owner: o.owner.clone(),
                    market_id: o.market_id.clone(),
                    kind: o.kind.clone(),
                    created_at_sec: U64(o.created_at_sec),
                    reserved: U128(o.reserved),
                    executable: m.map(|m| m.price_ts_sec > o.created_at_sec && self.is_fresh(m)).unwrap_or(false),
                }
            })
            .collect()
    }

    pub fn get_num_positions(&self) -> u32 {
        self.positions.len()
    }
}

// =========================================================================
// Deposits via ft_transfer_call
// =========================================================================

#[near]
impl FungibleTokenReceiver for Contract {
    /// msg = "deposit" (trading collateral) or "lp" (LP vault). Anything not accepted is refunded.
    fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.collateral_token, "Unsupported token");
        let amount_v = amount.0;
        let refund = |reason: &str| {
            log!("Refunding deposit: {}", reason);
            PromiseOrValue::Value(amount)
        };
        if self.paused {
            return refund("paused");
        }
        let Some(mut acc) = self.accounts.get(&sender_id).cloned() else {
            return refund("account not registered, call storage_deposit first");
        };
        if amount_v == 0 {
            return refund("zero amount");
        }
        match msg.as_str() {
            "deposit" => {
                if acc.free + acc.locked + amount_v > self.limits.max_user_collateral.0 {
                    return refund("over per-user collateral cap");
                }
                acc.free += amount_v;
                self.accounts.insert(sender_id.clone(), acc);
                emit("deposit", near_sdk::serde_json::json!({"account_id": sender_id, "amount": amount}));
                PromiseOrValue::Value(U128(0))
            }
            "lp" => {
                if !self.nav_is_reliable() {
                    return refund("a market with open interest has a stale price, try again later");
                }
                self.accrue_all_funding();
                let nav = self.nav();
                if nav + amount_v > self.limits.vault_cap.0 {
                    return refund("over vault cap");
                }
                let shares = if self.vault.total_shares == 0 || nav == 0 {
                    amount_v
                } else {
                    amount_v * self.vault.total_shares / nav
                };
                if shares == 0 {
                    return refund("amount too small");
                }
                acc.lp_shares += shares;
                self.vault.total_shares += shares;
                self.vault.assets += amount_v;
                self.accounts.insert(sender_id.clone(), acc);
                emit(
                    "lp_deposit",
                    near_sdk::serde_json::json!({"account_id": sender_id, "amount": amount, "shares": U128(shares)}),
                );
                PromiseOrValue::Value(U128(0))
            }
            _ => refund("unknown msg, use \"deposit\" or \"lp\""),
        }
    }
}

// =========================================================================
// Internal logic
// =========================================================================

impl Contract {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
    }

    fn storage_balance(&self) -> StorageBalance {
        StorageBalance { total: STORAGE_DEPOSIT, available: NearToken::from_yoctonear(0) }
    }

    fn get_account_or_panic(&self, id: &AccountId) -> Account {
        self.accounts
            .get(id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Account not registered, call storage_deposit first"))
    }

    fn get_market_or_panic(&self, id: &String) -> &Market {
        self.markets.get(id).unwrap_or_else(|| env::panic_str("Unknown market"))
    }

    fn get_position_or_panic(&self, id: u64) -> &Position {
        self.positions.get(&id).unwrap_or_else(|| env::panic_str("Position not found"))
    }

    fn validate_market_config(c: &MarketConfig) {
        require!(c.max_leverage_bps as u128 >= BPS, "Max leverage must be at least 1x");
        require!(c.max_leverage_bps <= 200_000, "Max leverage capped at 20x");
        require!(
            (c.maintenance_margin_bps as u128) < BPS * BPS / c.max_leverage_bps as u128,
            "Maintenance margin must be below initial margin"
        );
        require!(c.fee_bps <= 100, "Fee capped at 1%");
        require!(c.max_oi_bps_of_nav as u128 <= BPS, "OI limit capped at 100% of NAV");
        require!(c.stale_after_sec > 0, "stale_after_sec must be positive");
        require!(c.max_price_jump_bps > 0, "max_price_jump_bps must be positive");
    }

    fn is_fresh(&self, m: &Market) -> bool {
        m.price > 0 && now_sec() <= m.price_ts_sec + m.config.stale_after_sec
    }

    /// NAV is only trustworthy if every market with open interest has a fresh price.
    fn nav_is_reliable(&self) -> bool {
        self.markets
            .values()
            .all(|m| (m.long_notional == 0 && m.short_notional == 0) || self.is_fresh(m))
    }

    /// Validates leverage and size limits. Returns the notional.
    fn check_open_params(&self, cfg: &MarketConfig, collateral: u128, leverage_bps: u32) -> u128 {
        require!(leverage_bps as u128 >= BPS, "Leverage must be at least 1x");
        require!(leverage_bps <= cfg.max_leverage_bps, "Leverage above market maximum");
        require!(collateral >= self.limits.min_collateral.0, "Collateral below minimum");
        let notional = collateral * leverage_bps as u128 / BPS;
        require!(notional <= self.limits.max_position_notional.0, "Position notional above limit");
        notional
    }

    fn open_would_succeed(&self, market_id: &String, is_long: bool, collateral: u128, leverage_bps: u32) -> bool {
        let Some(m) = self.markets.get(market_id) else { return false };
        if !self.is_fresh(m) || (leverage_bps as u128) < BPS || leverage_bps > m.config.max_leverage_bps {
            return false;
        }
        if collateral < self.limits.min_collateral.0 {
            return false;
        }
        let notional = collateral * leverage_bps as u128 / BPS;
        if notional > self.limits.max_position_notional.0 {
            return false;
        }
        let side = if is_long { m.long_notional } else { m.short_notional };
        side + notional <= bps_of(self.nav(), m.config.max_oi_bps_of_nav as u128)
    }

    /// Opens a position. Collateral + fee must already be removed from the owner's free balance.
    fn open_internal(
        &mut self,
        owner: &AccountId,
        market_id: &String,
        is_long: bool,
        collateral: u128,
        leverage_bps: u32,
        fee: u128,
    ) -> u64 {
        self.accrue_funding(market_id);
        let nav = self.nav();
        let mut m = self.get_market_or_panic(market_id).clone();
        require!(self.is_fresh(&m), "Oracle price is stale");
        let notional = self.check_open_params(&m.config, collateral, leverage_bps);
        let side = if is_long { m.long_notional } else { m.short_notional };
        require!(
            side + notional <= bps_of(nav, m.config.max_oi_bps_of_nav as u128),
            "Open interest limit reached for this side"
        );
        let units = units_for(notional, m.price);
        if is_long {
            m.long_notional += notional;
            m.long_units += units;
        } else {
            m.short_notional += notional;
            m.short_units += units;
        }
        let funding_index_open = m.funding_index;
        let price = m.price;
        self.markets.insert(market_id.clone(), m);

        let insurance_part = bps_of(fee, self.limits.insurance_fee_share_bps as u128);
        self.vault.insurance += insurance_part;
        self.vault.assets += fee - insurance_part;

        let id = self.next_position_id;
        self.next_position_id += 1;
        self.positions.insert(
            id,
            Position {
                owner: owner.clone(),
                market_id: market_id.clone(),
                is_long,
                collateral,
                notional,
                units,
                entry_price: price,
                funding_index_open,
                opened_at_sec: now_sec(),
            },
        );
        let mut acc = self.get_account_or_panic(owner);
        acc.locked += collateral;
        acc.positions.push(id);
        self.accounts.insert(owner.clone(), acc);
        emit(
            "open",
            near_sdk::serde_json::json!({
                "position_id": U64(id), "owner": owner, "market_id": market_id, "is_long": is_long,
                "collateral": U128(collateral), "notional": U128(notional), "price": U128(price), "fee": U128(fee),
            }),
        );
        id
    }

    fn close_internal(&mut self, position_id: u64) {
        let pos = self.get_position_or_panic(position_id).clone();
        self.accrue_funding(&pos.market_id);
        let m = self.get_market_or_panic(&pos.market_id).clone();
        require!(self.is_fresh(&m), "Oracle price is stale");
        let pnl = position_pnl(pos.is_long, pos.units, pos.notional, m.price);
        let f = funding_owed(pos.is_long, pos.notional, pos.funding_index_open, m.funding_index);
        let fee = bps_of(pos.notional, m.config.fee_bps as u128);
        let mm = bps_of(pos.notional, m.config.maintenance_margin_bps as u128);
        let equity = pos.collateral as i128 + pnl - f;
        require!(equity > mm as i128, "Position is liquidatable, it can only be liquidated");
        let raw_payout = equity - fee as i128;
        require!(raw_payout >= 0, "Payout negative");
        let mut payout = raw_payout as u128;
        let insurance_part = bps_of(fee, self.limits.insurance_fee_share_bps as u128);

        // Vault receives collateral - payout - insurance_part (negative when the trader profits).
        let available = self.vault.assets + pos.collateral - insurance_part;
        if payout > available {
            // Should not happen with OI caps; never let the vault go negative.
            payout = available;
        }
        self.vault.assets = available - payout;
        self.vault.insurance += insurance_part;
        self.vault.pending_funding -= f;
        self.remove_position_aggregates(&pos);
        self.positions.remove(&position_id);

        let mut acc = self.get_account_or_panic(&pos.owner);
        acc.locked -= pos.collateral;
        acc.free += payout;
        acc.positions.retain(|p| *p != position_id);
        self.accounts.insert(pos.owner.clone(), acc);
        emit(
            "close",
            near_sdk::serde_json::json!({
                "position_id": U64(position_id), "owner": pos.owner, "price": U128(m.price),
                "pnl": I128(pnl), "funding": I128(f), "fee": U128(fee), "payout": U128(payout),
            }),
        );
    }

    fn remove_position_aggregates(&mut self, pos: &Position) {
        let mut m = self.get_market_or_panic(&pos.market_id).clone();
        if pos.is_long {
            m.long_notional -= pos.notional;
            m.long_units -= pos.units;
        } else {
            m.short_notional -= pos.notional;
            m.short_units -= pos.units;
        }
        self.markets.insert(pos.market_id.clone(), m);
    }

    fn set_price_internal(&mut self, market_id: String, price: u128, ts_sec: u64, force: bool) {
        require!(price > 0, "Price must be positive");
        // Settle funding up to now with the old price before changing it.
        self.accrue_funding(&market_id);
        let mut m = self.get_market_or_panic(&market_id).clone();
        require!(ts_sec > m.price_ts_sec, "Timestamp must be newer than the last price");
        require!(ts_sec <= now_sec() + MAX_FUTURE_DRIFT_SEC, "Timestamp is in the future");
        if !force && m.price > 0 {
            require!(
                move_bps(m.price, price) <= m.config.max_price_jump_bps as u128,
                "Price jump above limit, owner must use set_price_force"
            );
        }
        m.price = price;
        m.price_ts_sec = ts_sec;
        self.markets.insert(market_id.clone(), m);
        emit(
            "price",
            near_sdk::serde_json::json!({"market_id": market_id, "price": U128(price), "ts_sec": U64(ts_sec), "forced": force}),
        );
    }

    /// Unrealised PnL of all traders, summed over markets (O(markets)).
    fn traders_unrealized_pnl(&self) -> i128 {
        self.markets
            .values()
            .map(|m| {
                let long = value_of(m.long_units, m.price, false) as i128 - m.long_notional as i128;
                let short = m.short_notional as i128 - value_of(m.short_units, m.price, true) as i128;
                long + short
            })
            .sum()
    }

    /// NAV = assets - traders' unrealised PnL + funding owed to the vault. Never negative.
    fn nav(&self) -> u128 {
        let nav = self.vault.assets as i128 - self.traders_unrealized_pnl() + self.vault.pending_funding;
        nav.max(0) as u128
    }

    /// NAV including funding accrued since the last touch (for views).
    fn nav_with_projected_funding(&self) -> u128 {
        let nav = self.nav();
        let extra: i128 = self
            .markets
            .values()
            .map(|m| {
                let delta = self.funding_delta(m, nav);
                delta * (m.long_notional as i128 - m.short_notional as i128) / FUNDING_SCALE
            })
            .sum();
        (nav as i128 + extra).max(0) as u128
    }

    fn funding_delta(&self, m: &Market, nav: u128) -> i128 {
        let now = env::block_timestamp();
        if now <= m.last_funding_ns {
            return 0;
        }
        let rate = funding_rate_per_hour(&m.config, m.long_notional, m.short_notional, nav);
        rate * (now - m.last_funding_ns) as i128 / NS_PER_HOUR
    }

    fn accrue_funding(&mut self, market_id: &String) {
        let nav = self.nav();
        let mut m = self.get_market_or_panic(market_id).clone();
        let delta = self.funding_delta(&m, nav);
        if delta != 0 {
            m.funding_index += delta;
            self.vault.pending_funding += delta * (m.long_notional as i128 - m.short_notional as i128) / FUNDING_SCALE;
        }
        m.last_funding_ns = env::block_timestamp();
        self.markets.insert(market_id.clone(), m);
    }

    fn accrue_all_funding(&mut self) {
        let ids: Vec<String> = self.markets.keys().cloned().collect();
        for id in ids {
            self.accrue_funding(&id);
        }
    }

    fn send_collateral(&self, to: AccountId, amount: u128, lp_shares: u128) -> Promise {
        ext_ft::ext(self.collateral_token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(to.clone(), U128(amount), Some("aura withdrawal".to_string()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_WITHDRAW_CALLBACK)
                    .on_withdraw(to, U128(amount), U128(lp_shares)),
            )
    }

    fn market_view(&self, id: &String) -> MarketView {
        let m = self.markets.get(id).unwrap();
        let rate = funding_rate_per_hour(&m.config, m.long_notional, m.short_notional, self.nav());
        MarketView {
            id: id.clone(),
            config: m.config.clone(),
            price: U128(m.price),
            price_ts_sec: U64(m.price_ts_sec),
            is_fresh: self.is_fresh(m),
            long_notional: U128(m.long_notional),
            short_notional: U128(m.short_notional),
            funding_index: I128(m.funding_index),
            // rate in bps/hour * 1e6 for display (FUNDING_SCALE / 1e4 bps = 1e8 per bps)
            funding_rate_bps_per_hour_x1e6: I128(rate / 100),
        }
    }

    fn position_view(&self, id: u64, p: &Position) -> PositionView {
        let m = self.markets.get(&p.market_id).unwrap();
        let index_now = m.funding_index + self.funding_delta(m, self.nav());
        let pnl = position_pnl(p.is_long, p.units, p.notional, m.price);
        let f = funding_owed(p.is_long, p.notional, p.funding_index_open, index_now);
        let equity = p.collateral as i128 + pnl - f;
        let mm = bps_of(p.notional, m.config.maintenance_margin_bps as u128);
        PositionView {
            id: U64(id),
            owner: p.owner.clone(),
            market_id: p.market_id.clone(),
            is_long: p.is_long,
            collateral: U128(p.collateral),
            notional: U128(p.notional),
            entry_price: U128(p.entry_price),
            mark_price: U128(m.price),
            pnl: I128(pnl),
            funding_owed: I128(f),
            equity: I128(equity),
            maintenance_margin: U128(mm),
            liquidation_price: U128(liquidation_price(p.is_long, p.collateral, p.notional, p.units, f, mm)),
            liquidatable: self.is_fresh(m) && equity <= mm as i128,
            opened_at_sec: U64(p.opened_at_sec),
        }
    }
}
