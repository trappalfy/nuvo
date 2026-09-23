# Nuvo

Dual investment on tokenized stocks, settled every Friday on Robinhood Chain.
Spec: `nuvo-site-brief.md`.

This folder is a standalone Next.js app. It lives inside the Recess repository
folder but is not part of it (`NUVO/` is listed in the parent `.gitignore`), and
it shares no code, tokens or routes with Recess.

```
npm install     # once
npm run dev     # http://localhost:3100
npm run video   # rebuild public/video from NUVO/background-nuvo.mp4
```

## Going live

The app has no demo data. Everything it shows comes from the chain, configured
in `.env.local` (see `.env.example`):

| What | Where it comes from |
|---|---|
| Wallet, network switch | RainbowKit + wagmi, on `NEXT_PUBLIC_CHAIN_ID` |
| Balances, allowances | ERC-20 reads on `NEXT_PUBLIC_USDG_ADDRESS` and the pools' tokens |
| Tickers, feeds | the pool registry at `NEXT_PUBLIC_FACTORY_ADDRESS` |
| Premiums, strikes, both outcomes, limits | `preview()` on the pool for that ticker |
| Subscribe, claim, positions, liquidity | the pool itself |

Until a value is set the matching screen shows an empty state, never a
made-up number.

## Contracts

The protocol lives in `contracts/`, a Foundry project of its own. The site needs
one address — the factory's: tickers, feeds, premiums and limits all come from it
and from the pools.

    cd contracts && forge test        # the whole suite; the fork run skips without RPC_URL
    node script/expiries.mjs 26       # the expiry calendar for addExpiries
    bash script/rehearse.sh           # a whole week on a throwaway local chain

### Rehearsing the deployment

`script/rehearse.sh` runs the real `script/Deploy.s.sol`, with the same env the
live run will use, against a throwaway anvil with a mock USDG, a mock stock and
a mock feed. It then plays a whole week: seed the inventory, subscribe, close
the week, settle, claim. Run it after any change to the contracts or the deploy
script, and before touching a live network.

### Settling a week

`settle(expiry)` is open to anyone and is the normal path: from Friday's close
until the feed moves again on Monday it takes the price that was in effect at
the bell. `script/settle.mjs` does this for every pool the factory knows:

    RPC_URL=… FACTORY_ADDRESS=0x… node script/settle.mjs --dry-run
    RPC_URL=… FACTORY_ADDRESS=0x… PRIVATE_KEY=0x… node script/settle.mjs

It exits 1 when a week is still waiting, so a scheduler can alarm on it. The
key it signs with needs nothing but gas — settling is permissionless and pays
no one. Run it shortly after Friday's close.

If the feed has already moved on, `settle` refuses: the latest round is no
longer the one that was in effect. The bot then falls back to
`findSettleRound` + `settleWithRound` on its own. By hand that is:

    cast call $POOL "findSettleRound(uint64,uint80,uint16)(uint80,bool)" $EXPIRY $LATEST_ROUND 64
    cast send $POOL "settleWithRound(uint64,uint80)" $EXPIRY $ROUND

Until a week is settled its positions cannot be claimed, so do not leave it. A
position still unclaimed a day after its expiry can be closed by anyone with
`resolve(id)`: the payout is recorded as a debt the owner withdraws later —
the Positions screen shows it and calls `withdrawOwed` — and the depositors'
inventory goes back to work. Deposits and withdrawals to the pool are closed
while a settled week is still unclaimed; that is what keeps a latecomer from
buying into an outcome that is already decided.

### Schedule

Subscriptions are open around the clock (`lib/nuvo/schedule.ts`). The week on
offer is the one whose Thursday 4:00 PM ET cutoff is still ahead; it expires that
Friday at 4:00 PM ET. From the cutoff on, the app offers the next week, so
between Thursday 4:00 PM and the following Thursday it quotes and subscribes to
next Friday's expiry — including over the weekend.

On chain the same rule comes from the factory's calendar: a subscription goes to
the first published expiry more than 24 hours away, which is exactly the site's
Thursday cutoff. The calendar is published ahead because "Friday 4:00 PM ET"
moves in UTC twice a year with daylight saving.

The cutoff stays: a day before expiry the outcome is close to known.
