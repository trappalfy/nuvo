#!/usr/bin/env bash
# A full week on a local chain: deploy, seed, subscribe, settle, claim.
#
# This rehearses the real deployment — it runs script/Deploy.s.sol itself, with
# the same env the mainnet run will use — against a throwaway anvil with mock
# USDG, a mock stock and a mock feed. Run it before touching a live network.
#
#   bash script/rehearse.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=${PORT:-8545}
RPC=http://127.0.0.1:$PORT
# anvil's first account — a published key, worthless, local only.
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ME=$(cast wallet address --private-key $PRIVATE_KEY)

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "anvil on $PORT"
anvil --port "$PORT" --silent &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null || true' EXIT
until cast block-number --rpc-url "$RPC" >/dev/null 2>&1; do sleep 0.2; done

say "mocks"
MOCKS=$(forge script script/Mocks.s.sol --rpc-url "$RPC" --broadcast 2>&1)
export USDG_ADDRESS=$(echo "$MOCKS" | grep -o 'MOCK_USDG 0x[0-9a-fA-F]*' | awk '{print $2}')
export TOKEN_ADDRESS=$(echo "$MOCKS" | grep -o 'MOCK_TOKEN 0x[0-9a-fA-F]*' | awk '{print $2}')
export FEED_ADDRESS=$(echo "$MOCKS" | grep -o 'MOCK_FEED 0x[0-9a-fA-F]*' | awk '{print $2}')
echo "usdg $USDG_ADDRESS / token $TOKEN_ADDRESS / feed $FEED_ADDRESS"

say "deploy (the real script, the real env)"
export OWNER_ADDRESS=$ME GUARDIAN_ADDRESS=$ME
export MAX_PREMIUM_BPS=1000 MAX_PRICE_AGE=288000 MAX_PRICE_AGE_SETTLE=21600
export MIN_DEPOSIT_VALUE_WAD=100000000000000000000
export MAX_POSITION_VALUE_WAD=5000000000000000000000
export MAX_EXPIRY_LOCK_VALUE_WAD=50000000000000000000000
export MAX_LOCKED_SHARE_BPS=6000
export EXPIRIES=$(node script/expiries.mjs 4 | tr -d '[]')
OUT=$(forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast 2>&1)
export FACTORY_ADDRESS=$(echo "$OUT" | grep -o 'factory 0x[0-9a-fA-F]*' | awk '{print $2}')
POOL=$(echo "$OUT" | grep -o 'pool 0x[0-9a-fA-F]*' | awk '{print $2}')
echo "factory $FACTORY_ADDRESS / pool $POOL"

send() { cast send --private-key $PRIVATE_KEY --rpc-url "$RPC" "$@" >/dev/null; }
call() { cast call --rpc-url "$RPC" "$@"; }

say "seed the inventory"
MAX_UINT=115792089237316195423570985008687907853269984665640564039457584007913129639935
send "$USDG_ADDRESS" "approve(address,uint256)" "$POOL" $MAX_UINT
send "$TOKEN_ADDRESS" "approve(address,uint256)" "$POOL" $MAX_UINT
send "$POOL" "addLiquidity(uint256,uint256,uint256)" 1000000000000 10000000000000000000000 0
echo "pool value $(call "$POOL" "poolValueWad()(uint256)")"

say "subscribe"
EXPIRY=$(call "$POOL" "preview(uint8,uint16,uint256)((uint64,uint16,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint8))" 0 200 1000000000 | grep -o '^(\?[0-9]*' | tr -d '(')
DEADLINE=$(( $(cast block --rpc-url "$RPC" latest -f timestamp) + 600 ))
send "$POOL" "subscribe(uint8,uint16,uint256,uint256,uint64)" 0 200 1000000000 \
  $MAX_UINT "$DEADLINE"
echo "expiry $EXPIRY, positions $(call "$POOL" "positionsOf(address)(uint256[])" "$ME")"

say "the week closes"
# The round in effect at the bell, then a chain that has moved past expiry.
send "$FEED_ADDRESS" "push(int256,uint256)" 9000000000 $((EXPIRY - 600))
cast rpc --rpc-url "$RPC" evm_setNextBlockTimestamp $((EXPIRY + 3600)) >/dev/null
cast rpc --rpc-url "$RPC" evm_mine >/dev/null

say "settle (dry run)"
RPC_URL=$RPC node script/settle.mjs --dry-run

say "settle"
RPC_URL=$RPC node script/settle.mjs

say "claim"
BEFORE=$(call "$TOKEN_ADDRESS" "balanceOf(address)(uint256)" "$ME")
send "$POOL" "claim(uint256)" 0
AFTER=$(call "$TOKEN_ADDRESS" "balanceOf(address)(uint256)" "$ME")
echo "stock before $BEFORE"
echo "stock after  $AFTER"

say "settle again: nothing left to do"
RPC_URL=$RPC node script/settle.mjs

say "rehearsal complete"
