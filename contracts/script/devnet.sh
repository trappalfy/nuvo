#!/usr/bin/env bash
# A local chain the site can talk to, left running.
#
# Deploys mocks, then the real Deploy.s.sol, seeds the inventory, and writes the
# site's .env.local pointing at it. Give it your wallet address and it funds
# that wallet with gas, USDG and stock, and puts it on the pool's allowlist — so
# you can click through every screen with your own wallet before any real money
# is involved.
#
#   bash script/devnet.sh 0xYourWalletAddress
#   bash script/devnet.sh                      # no wallet: reads only
#
# Stop it with:  kill $(cat .devnet.pid)
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=${PORT:-8545}
RPC=http://127.0.0.1:$PORT
YOU=${1:-}
# anvil's first account — a published key, worthless, local only.
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ME=$(cast wallet address --private-key $PRIVATE_KEY)
MAX_UINT=115792089237316195423570985008687907853269984665640564039457584007913129639935

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
send() { cast send --private-key $PRIVATE_KEY --rpc-url "$RPC" "$@" >/dev/null; }
call() { cast call --rpc-url "$RPC" "$@"; }

if cast block-number --rpc-url "$RPC" >/dev/null 2>&1; then
  echo "Something is already listening on $PORT. Stop it first:"
  echo "  kill \$(cat $(pwd)/.devnet.pid)   # if it was this script"
  exit 1
fi

say "anvil on $PORT"
nohup anvil --port "$PORT" --silent >/dev/null 2>&1 &
echo $! > .devnet.pid
until cast block-number --rpc-url "$RPC" >/dev/null 2>&1; do sleep 0.2; done
echo "pid $(cat .devnet.pid)"

say "mocks"
MOCKS=$(forge script script/Mocks.s.sol --rpc-url "$RPC" --broadcast 2>&1)
export USDG_ADDRESS=$(echo "$MOCKS" | grep -o 'MOCK_USDG 0x[0-9a-fA-F]*' | awk '{print $2}')
export TOKEN_ADDRESS=$(echo "$MOCKS" | grep -o 'MOCK_TOKEN 0x[0-9a-fA-F]*' | awk '{print $2}')
export FEED_ADDRESS=$(echo "$MOCKS" | grep -o 'MOCK_FEED 0x[0-9a-fA-F]*' | awk '{print $2}')

say "deploy"
export OWNER_ADDRESS=$ME GUARDIAN_ADDRESS=$ME
export MAX_PREMIUM_BPS=1000 MAX_PRICE_AGE=288000 MAX_PRICE_AGE_SETTLE=21600
export MIN_DEPOSIT_VALUE_WAD=100000000000000000000
export MAX_POSITION_VALUE_WAD=5000000000000000000000
export MAX_EXPIRY_LOCK_VALUE_WAD=50000000000000000000000
export MAX_LOCKED_SHARE_BPS=6000
export EXPIRIES=$(node script/expiries.mjs 8 | tr -d '[]')
OUT=$(forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast 2>&1)
FACTORY=$(echo "$OUT" | grep -o 'factory 0x[0-9a-fA-F]*' | awk '{print $2}')
POOL=$(echo "$OUT" | grep -o 'pool 0x[0-9a-fA-F]*' | awk '{print $2}')
echo "factory $FACTORY"
echo "pool    $POOL"

say "inventory"
send "$USDG_ADDRESS" "approve(address,uint256)" "$POOL" $MAX_UINT
send "$TOKEN_ADDRESS" "approve(address,uint256)" "$POOL" $MAX_UINT
send "$POOL" "addLiquidity(uint256,uint256,uint256)" 1000000000000 10000000000000000000000 0
echo "pool value $(call "$POOL" "poolValueWad()(uint256)")"

if [ -n "$YOU" ]; then
  say "funding $YOU"
  # Gas, then something to subscribe with, then a seat on the allowlist.
  cast send "$YOU" --value 10ether --private-key $PRIVATE_KEY --rpc-url "$RPC" >/dev/null
  send "$USDG_ADDRESS" "mint(address,uint256)" "$YOU" 100000000000
  send "$TOKEN_ADDRESS" "mint(address,uint256)" "$YOU" 1000000000000000000000
  send "$POOL" "setAllowed(address[],bool)" "[$YOU]" true
  echo "10 ETH, 100 000 USDG, 1 000 NVDA, and a place on the allowlist"
fi

say "the site"
cat > ../.env.local <<ENV
# Written by contracts/script/devnet.sh — a local chain, not the real one.
NEXT_PUBLIC_SITE_URL=http://localhost:3100
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_CHAIN_NAME=Devnet
NEXT_PUBLIC_RPC_URL=$RPC
NEXT_PUBLIC_EXPLORER_URL=
NEXT_PUBLIC_FACTORY_ADDRESS=$FACTORY
NEXT_PUBLIC_USDG_ADDRESS=$USDG_ADDRESS
NEXT_PUBLIC_USDG_SYMBOL=USDG
ENV
echo "wrote .env.local"

cat <<DONE

Next:
  npm run dev                 # from the NUVO folder, then http://localhost:3100

In your wallet, add the network:
  name      Devnet
  rpc       $RPC
  chain id  31337
  currency  ETH

Stop the chain when you are done:
  kill \$(cat $(pwd)/.devnet.pid)

Settle a week from here:
  RPC_URL=$RPC FACTORY_ADDRESS=$FACTORY PRIVATE_KEY=\$PRIVATE_KEY \\
    node script/settle.mjs
DONE
