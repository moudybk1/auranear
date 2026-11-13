#!/usr/bin/env bash
# Pushes ONE price per market from the oracle account. Testnet stopgap until the oracle service
# (services/, docs/SERVICES_SPEC.md) exists: prices go stale after 10 minutes, so re-run it before trying the UI.
# Single source (the Binance public mirror the web chart uses), no median, no outlier check. Never use on mainnet.
# A move above 5% since the last push is rejected by the contract; the owner then uses set_price_force.
source "$(dirname "$0")/config.sh"
[[ "$NETWORK" != "mainnet" ]] || { echo "Testnet only. Mainnet prices come from the oracle service."; exit 1; }

# "71460.03000000" -> "71460030000" (micro-USD, PRICE_SCALE 1e6), string math only, truncates past 6 decimals
to_micro() { local i="${1%.*}" f="${1#*.}000000"; echo "$((10#$i${f:0:6}))"; }

for pair in BTC-USD:BTCUSDT ETH-USD:ETHUSDT NEAR-USD:NEARUSDT; do
  market="${pair%%:*}"
  raw=$(curl -fsS -m 10 "https://data-api.binance.vision/api/v3/ticker/price?symbol=${pair##*:}" | jq -er .price)
  call "$ORACLE" "$CONTRACT" set_price \
    "{\"market_id\":\"$market\",\"price\":\"$(to_micro "$raw")\",\"ts_sec\":\"$(date +%s)\"}" '0 NEAR'
done
view "$CONTRACT" get_markets
