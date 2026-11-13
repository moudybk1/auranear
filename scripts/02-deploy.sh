#!/usr/bin/env bash
# Builds and deploys the perps contract (and the test token on testnet), then registers storage.
source "$(dirname "$0")/config.sh"
confirm_mainnet

if [[ "$NETWORK" != "mainnet" ]]; then
  echo ">> deploying test token tUSD to $USDC"
  (cd "$ROOT/contracts/mock-ft" && cargo near deploy build-non-reproducible-wasm "$USDC" \
    with-init-call new json-args '{}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' \
    network-config "$NETWORK" sign-with-legacy-keychain send)
  call "$OWNER" "$USDC" faucet "{\"account_id\":\"$OWNER\",\"amount\":\"1000000000\"}" '0 NEAR'
fi

LIMITS=$(cat <<JSON
{"vault_cap":"$VAULT_CAP","max_user_collateral":"$MAX_USER_COLLATERAL","max_position_notional":"$MAX_POSITION_NOTIONAL","min_collateral":"1000000","max_positions_per_account":5,"liquidator_reward_bps":2000,"insurance_fee_share_bps":1000}
JSON
)

echo ">> building + deploying perps to $CONTRACT"
(cd "$ROOT/contracts/perps" && cargo near deploy build-non-reproducible-wasm "$CONTRACT" \
  with-init-call new json-args "{\"owner\":\"$OWNER\",\"oracle\":\"$ORACLE\",\"collateral_token\":\"$USDC\",\"limits\":$LIMITS}" \
  prepaid-gas '50.0 Tgas' attached-deposit '0 NEAR' \
  network-config "$NETWORK" sign-with-legacy-keychain send)

echo ">> registering the perps contract and the agent on the collateral token"
call "$OWNER" "$USDC" storage_deposit "{\"account_id\":\"$CONTRACT\"}" '0.0125 NEAR'
call "$OWNER" "$USDC" storage_deposit "{\"account_id\":\"$AGENT\"}" '0.0125 NEAR'

echo ">> registering owner, keeper and agent on the perps contract"
for a in "$OWNER" "$KEEPER" "$AGENT"; do
  call "$OWNER" "$CONTRACT" storage_deposit "{\"account_id\":\"$a\"}" '0.02 NEAR'
done

view "$CONTRACT" get_config
