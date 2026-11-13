#!/usr/bin/env bash
# Creates the contract, oracle, keeper and agent sub-accounts (and the test token on testnet).
# Keys are saved to the legacy keychain (~/.near-credentials/<network>/).
source "$(dirname "$0")/config.sh"
confirm_mainnet

create() {
  echo ">> creating $1 with $2"
  near account create-account fund-myself "$1" "$2" \
    autogenerate-new-keypair save-to-legacy-keychain \
    sign-as "$OWNER" network-config "$NETWORK" sign-with-legacy-keychain send
}

create "$CONTRACT" "${CONTRACT_NEAR:-7 NEAR}"   # code storage (~3-5 NEAR) + state buffer
create "$ORACLE" "${ORACLE_NEAR:-1 NEAR}"       # gas for price pushes
create "$KEEPER" "${KEEPER_NEAR:-0.5 NEAR}"     # gas for liquidations + storage registration
create "$AGENT" "${AGENT_NEAR:-0.5 NEAR}"       # gas for the hedging agent

if [[ "$NETWORK" != "mainnet" ]]; then
  create "$USDC" "${USDC_NEAR:-3 NEAR}"         # test token code storage (~1.5 NEAR)
fi

echo "Done. Keys are in ~/.near-credentials/$NETWORK/"
