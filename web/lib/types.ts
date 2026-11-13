// View types of the perps contract (docs/API.md §A4). Amounts are integer strings.

export type MarketConfig = {
  max_leverage_bps: number;
  maintenance_margin_bps: number;
  fee_bps: number;
  max_oi_bps_of_nav: number;
  stale_after_sec: number;
  max_price_jump_bps: number;
  funding_k_bps_per_hour: number;
  max_funding_bps_per_hour: number;
  two_step: boolean;
};

export type Limits = {
  vault_cap: string;
  max_user_collateral: string;
  max_position_notional: string;
  min_collateral: string;
  max_positions_per_account: number;
  liquidator_reward_bps: number;
  insurance_fee_share_bps: number;
};

export type ConfigView = {
  owner: string;
  oracle: string;
  collateral_token: string;
  paused: boolean;
  limits: Limits;
  storage_deposit_yocto: string;
};

export type VaultView = {
  assets: string;
  insurance: string;
  total_shares: string;
  nav: string;
  share_price: string;
  pending_funding: string;
};

export type MarketView = {
  id: string;
  config: MarketConfig;
  price: string;
  price_ts_sec: string;
  is_fresh: boolean;
  long_notional: string;
  short_notional: string;
  funding_index: string;
  funding_rate_bps_per_hour_x1e6: string;
};

export type AccountView = {
  free: string;
  locked: string;
  lp_shares: string;
  lp_value: string;
  positions: string[];
  orders: string[];
};

export type PositionView = {
  id: string;
  owner: string;
  market_id: string;
  is_long: boolean;
  collateral: string;
  notional: string;
  entry_price: string;
  mark_price: string;
  pnl: string;
  funding_owed: string;
  equity: string;
  maintenance_margin: string;
  liquidation_price: string;
  liquidatable: boolean;
  opened_at_sec: string;
};

/** One function call, sent through the wallet (or the demo simulator). */
export type Tx = {
  receiverId: string;
  method: string;
  args: Record<string, unknown>;
  gas: string;
  deposit: string;
};
