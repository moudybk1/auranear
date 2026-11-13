#!/usr/bin/env bash
# Seeds the LP vault from the owner account. Usage: AMOUNT=50000000 ./scripts/04-seed-vault.sh  (micro-USDC)
source "$(dirname "$0")/config.sh"
AMOUNT="${AMOUNT:-50000000}"
confirm_mainnet
call "$OWNER" "$USDC" ft_transfer_call "{\"receiver_id\":\"$CONTRACT\",\"amount\":\"$AMOUNT\",\"msg\":\"lp\"}" '1 yoctoNEAR' '100.0 Tgas'
view "$CONTRACT" get_vault
