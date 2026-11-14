#!/usr/bin/env bash
# Demo helper, testnet only: the owner forces one market's price down by DROP percent (default 20), so that a
# high-leverage long becomes liquidatable. The keeper liquidates it and the oracle service walks the price back.
# Keep the drop large: after a 6% drop the oracle repaired the price before the keeper's next scan (15 s apart)
# and nothing was liquidated.
# Usage: OWNER=yourname.testnet ./scripts/07-force-price.sh [MARKET] [DROP]
source "$(dirname "$0")/config.sh"
[[ "$NETWORK" != "mainnet" ]] || { echo "Testnet only."; exit 1; }
market="${1:-NEAR-USD}" drop="${2:-20}"

price=$(view "$CONTRACT" get_markets | jq -er --arg m "$market" '.[] | select(.id == $m) | .price')
forced=$((price * (100 - drop) / 100))
echo "$market: $price -> $forced (-$drop%)"
call "$OWNER" "$CONTRACT" set_price_force \
  "{\"market_id\":\"$market\",\"price\":\"$forced\",\"ts_sec\":\"$(date +%s)\"}" '1 yoctoNEAR' '30.0 Tgas'
