use near_sdk::json_types::{I128, U128, U64};
use near_sdk::{near, AccountId, BorshStorageKey};

/// Prices are micro-USD per unit of the underlying (price * 1e6).
pub const PRICE_SCALE: u128 = 1_000_000;
/// Position units are stored with 1e12 precision: units = notional * 1e12 / entry_price.
pub const UNIT_SCALE: u128 = 1_000_000_000_000;
/// Funding index precision (fraction of notional * 1e12).
pub const FUNDING_SCALE: i128 = 1_000_000_000_000;
/// Basis points.
pub const BPS: u128 = 10_000;
pub const NS_PER_SEC: u64 = 1_000_000_000;
pub const NS_PER_HOUR: i128 = 3_600 * 1_000_000_000;
/// Oracle may report a timestamp at most this far in the future.
pub const MAX_FUTURE_DRIFT_SEC: u64 = 60;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
pub enum StorageKey {
    Accounts,
    Positions,
    Markets,
    Orders,
    /// Appended last so existing storage prefixes keep their meaning.
    PendingWithdrawals,
}

/// Global guarded-launch limits (all amounts in collateral base units, USDC = 6 decimals).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Limits {
    /// Max NAV of the LP vault.
    pub vault_cap: U128,
    /// Max collateral (free + locked) per trader account.
    pub max_user_collateral: U128,
    /// Max notional of a single position.
    pub max_position_notional: U128,
    /// Min collateral to open a position.
    pub min_collateral: U128,
    /// Max open positions + pending orders per account.
    pub max_positions_per_account: u32,
    /// Share of remaining equity paid to the liquidator.
    pub liquidator_reward_bps: u32,
    /// Share of trading fees routed to the insurance fund.
    pub insurance_fee_share_bps: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct MarketConfig {
    /// 100_000 = 10x.
    pub max_leverage_bps: u32,
    /// Maintenance margin as bps of notional.
    pub maintenance_margin_bps: u32,
    /// Open and close fee as bps of notional.
    pub fee_bps: u32,
    /// Max open interest per side as bps of vault NAV.
    pub max_oi_bps_of_nav: u32,
    /// Price older than this (seconds) is stale.
    pub stale_after_sec: u64,
    /// Max allowed price move per oracle update, bps.
    pub max_price_jump_bps: u32,
    /// Funding rate per hour (bps) when skew equals 100% of NAV.
    pub funding_k_bps_per_hour: u32,
    /// Cap on |funding rate| per hour, bps.
    pub max_funding_bps_per_hour: u32,
    /// Two-step execution: orders execute at the next oracle price.
    pub two_step: bool,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Market {
    pub config: MarketConfig,
    pub price: u128,
    pub price_ts_sec: u64,
    pub long_notional: u128,
    pub short_notional: u128,
    pub long_units: u128,
    pub short_units: u128,
    /// Cumulative funding paid by longs per unit of notional (scaled by FUNDING_SCALE).
    pub funding_index: i128,
    pub last_funding_ns: u64,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default)]
pub struct Account {
    /// Free collateral balance.
    pub free: u128,
    /// Collateral locked in positions and pending orders.
    pub locked: u128,
    pub lp_shares: u128,
    pub positions: Vec<u64>,
    pub orders: Vec<u64>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Position {
    pub owner: AccountId,
    pub market_id: String,
    pub is_long: bool,
    pub collateral: u128,
    pub notional: u128,
    pub units: u128,
    pub entry_price: u128,
    pub funding_index_open: i128,
    pub opened_at_sec: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub enum OrderKind {
    Open {
        is_long: bool,
        collateral: U128,
        leverage_bps: u32,
    },
    Close {
        position_id: U64,
    },
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Order {
    pub owner: AccountId,
    pub market_id: String,
    pub kind: OrderKind,
    pub created_at_sec: u64,
    /// Collateral + fee reserved for an Open order.
    pub reserved: u128,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default)]
pub struct Vault {
    /// Collateral owned by the LP vault (excludes trader balances and insurance).
    pub assets: u128,
    pub total_shares: u128,
    pub insurance: u128,
    /// Net funding owed by open positions to the vault (can be negative).
    pub pending_funding: i128,
}

// ---------- JSON views ----------

#[near(serializers = [json])]
pub struct MarketView {
    pub id: String,
    pub config: MarketConfig,
    pub price: U128,
    pub price_ts_sec: U64,
    pub is_fresh: bool,
    pub long_notional: U128,
    pub short_notional: U128,
    pub funding_index: I128,
    pub funding_rate_bps_per_hour_x1e6: I128,
}

#[near(serializers = [json])]
pub struct VaultView {
    pub assets: U128,
    pub insurance: U128,
    pub total_shares: U128,
    pub nav: U128,
    /// NAV per share scaled by 1e6 (1_000_000 = 1.0).
    pub share_price: U128,
    pub pending_funding: I128,
}

#[near(serializers = [json])]
pub struct AccountView {
    pub free: U128,
    pub locked: U128,
    pub lp_shares: U128,
    pub lp_value: U128,
    pub positions: Vec<U64>,
    pub orders: Vec<U64>,
}

#[near(serializers = [json])]
pub struct PositionView {
    pub id: U64,
    pub owner: AccountId,
    pub market_id: String,
    pub is_long: bool,
    pub collateral: U128,
    pub notional: U128,
    pub entry_price: U128,
    pub mark_price: U128,
    pub pnl: I128,
    pub funding_owed: I128,
    pub equity: I128,
    pub maintenance_margin: U128,
    pub liquidation_price: U128,
    pub liquidatable: bool,
    pub opened_at_sec: U64,
}

#[near(serializers = [json])]
pub struct OrderView {
    pub id: U64,
    pub owner: AccountId,
    pub market_id: String,
    pub kind: OrderKind,
    pub created_at_sec: U64,
    pub reserved: U128,
    pub executable: bool,
}

#[near(serializers = [json])]
pub struct OpenResult {
    pub position_id: Option<U64>,
    pub order_id: Option<U64>,
}

#[near(serializers = [json])]
pub struct ConfigView {
    pub owner: AccountId,
    pub oracle: AccountId,
    pub collateral_token: AccountId,
    pub paused: bool,
    pub limits: Limits,
    pub storage_deposit_yocto: U128,
}
