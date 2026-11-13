#!/usr/bin/env bash
# Adds the three launch markets: BTC-USD, ETH-USD, NEAR-USD.
# With GPU=1 it also adds the GPU-H100 compute-price market (later phase).
source "$(dirname "$0")/config.sh"
confirm_mainnet

# Crypto markets: 10x, 5% maintenance, 0.1% fee, 30% of NAV per side each
# (three correlated markets -> at most 90% of NAV one-sided in total), instant execution.
CRYPTO_CFG='{"max_leverage_bps":100000,"maintenance_margin_bps":500,"fee_bps":10,"max_oi_bps_of_nav":3000,"stale_after_sec":600,"max_price_jump_bps":500,"funding_k_bps_per_hour":10,"max_funding_bps_per_hour":5,"two_step":false}'
GPU_CFG='{"max_leverage_bps":50000,"maintenance_margin_bps":1000,"fee_bps":10,"max_oi_bps_of_nav":2000,"stale_after_sec":93600,"max_price_jump_bps":1000,"funding_k_bps_per_hour":4,"max_funding_bps_per_hour":2,"two_step":true}'

for m in BTC-USD ETH-USD NEAR-USD; do
  call "$OWNER" "$CONTRACT" add_market "{\"market_id\":\"$m\",\"config\":$CRYPTO_CFG}" '1 yoctoNEAR'
done
if [[ "${GPU:-0}" == "1" ]]; then
  call "$OWNER" "$CONTRACT" add_market "{\"market_id\":\"GPU-H100\",\"config\":$GPU_CFG}" '1 yoctoNEAR'
fi
view "$CONTRACT" get_markets
echo "Now start the oracle service so the markets get a first price."
