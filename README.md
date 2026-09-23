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

The launch order, the roles and the limits are in
`docs/superpowers/specs/2026-09-23-nuvo-protocol-design.md`. The interface the UI
calls is in `lib/nuvo/abi.ts`. Prices are 8-decimal fixed point from Chainlink,
strikes are 18-decimal, and the feed prices the token itself — the ERC-8056
multiplier is a label, never part of an amount.

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
