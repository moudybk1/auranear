#!/usr/bin/env bash
# Funds the hedging agent and gives it a function-call key that can ONLY trade on the perps contract.
# Usage: AMOUNT=5000000 ./scripts/05-fund-agent.sh   (micro-USDC)
source "$(dirname "$0")/config.sh"
AMOUNT="${AMOUNT:-5000000}"
confirm_mainnet

if [[ "$NETWORK" != "mainnet" ]]; then
  call "$OWNER" "$USDC" faucet "{\"account_id\":\"$AGENT\",\"amount\":\"$AMOUNT\"}" '0 NEAR'
else
  call "$OWNER" "$USDC" ft_transfer "{\"receiver_id\":\"$AGENT\",\"amount\":\"$AMOUNT\"}" '1 yoctoNEAR'
fi
# The agent deposits with its full-access key (kept on this laptop only).
call "$AGENT" "$USDC" ft_transfer_call "{\"receiver_id\":\"$CONTRACT\",\"amount\":\"$AMOUNT\",\"msg\":\"deposit\"}" '1 yoctoNEAR' '100.0 Tgas'

echo ">> adding a function-call key for the agent service (open/close/cancel only, no withdrawals)"
near account add-key "$AGENT" grant-function-call-access \
  --allowance '0.25 NEAR' --contract-account-id "$CONTRACT" \
  --function-names 'open_position, close_position, cancel_order' \
  autogenerate-new-keypair print-to-terminal \
  network-config "$NETWORK" sign-with-legacy-keychain send
echo "Copy the printed private key into AGENT_PRIVATE_KEY of services/.env"
