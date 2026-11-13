#!/usr/bin/env bash
# Shared settings for all deploy scripts. Source it, don't run it.
# Usage: NETWORK=testnet OWNER=yourname.testnet ./scripts/01-create-accounts.sh
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
OWNER="${OWNER:?Set OWNER to your main account, e.g. OWNER=yourname.near}"
CONTRACT="${CONTRACT:-perps.$OWNER}"
ORACLE="${ORACLE:-oracle.$OWNER}"
KEEPER="${KEEPER:-keeper.$OWNER}"
AGENT="${AGENT:-agent.$OWNER}"

if [[ "$NETWORK" == "mainnet" ]]; then
  # Native Circle USDC on NEAR (6 decimals)
  USDC="${USDC:-17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1}"
  # Guarded launch caps (micro-USDC)
  VAULT_CAP="${VAULT_CAP:-200000000}"            # 200 USDC
  MAX_USER_COLLATERAL="${MAX_USER_COLLATERAL:-20000000}"  # 20 USDC
  MAX_POSITION_NOTIONAL="${MAX_POSITION_NOTIONAL:-50000000}" # 50 USDC
else
  USDC="${USDC:-tusd.$OWNER}"
  VAULT_CAP="${VAULT_CAP:-100000000000}"
  MAX_USER_COLLATERAL="${MAX_USER_COLLATERAL:-10000000000}"
  MAX_POSITION_NOTIONAL="${MAX_POSITION_NOTIONAL:-10000000000}"
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# call <signer> <contract> <method> <json> <deposit> [gas]
call() {
  echo ">> $1 -> $2.$3 $4 (deposit $5)"
  near contract call-function as-transaction "$2" "$3" json-args "$4" \
    prepaid-gas "${6:-50.0 Tgas}" attached-deposit "$5" \
    sign-as "$1" network-config "$NETWORK" sign-with-legacy-keychain send
}

# view <contract> <method> [json]
view() {
  local empty='{}'   # "${3:-{\}}" keeps the backslash on bash 3.2 (macOS)
  near contract call-function as-read-only "$1" "$2" json-args "${3:-$empty}" network-config "$NETWORK" now
}

confirm_mainnet() {
  if [[ "$NETWORK" == "mainnet" ]]; then
    echo
    echo "MAINNET: this step spends real NEAR/USDC. Owner=$OWNER Contract=$CONTRACT"
    read -r -p "Type 'yes' to continue: " ans
    [[ "$ans" == "yes" ]] || { echo "Aborted."; exit 1; }
  fi
}
