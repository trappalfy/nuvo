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

The app has no demo data. Everything it shows comes from the chain and the
quote service configured in `.env.local` (see `.env.example`):

| What | Where it comes from |
|---|---|
| Wallet, network switch | RainbowKit + wagmi, on `NEXT_PUBLIC_CHAIN_ID` |
| Balances, allowances | ERC-20 reads on `NEXT_PUBLIC_USDG_ADDRESS` and the stock tokens |
| Reference prices, ladder | Chainlink feeds in `NEXT_PUBLIC_STOCK_TOKENS`, ladder from `lib/nuvo/config.ts` |
| Premiums, signed quotes | `NEXT_PUBLIC_QUOTE_API` |
| Subscribe, claim, positions | the Nuvo contract at `NEXT_PUBLIC_NUVO_ADDRESS` |

Until a value is set the matching screen shows an empty state, never a
made-up number.

### Contract

The interface the UI calls is in `lib/nuvo/abi.ts`: `subscribe`, `claim`,
`product`, `positionsOf`, `position`, and the three events. Product ids are
derived as `keccak256(abi.encodePacked(weekId, ticker, direction, targetBps))` —
the contract has to derive them the same way. Prices are 8-decimal fixed point.

### Schedule

Subscriptions are open around the clock (`lib/nuvo/schedule.ts`). The week on
offer is the one whose Thursday 4:00 PM ET cutoff is still ahead; it expires that
Friday at 4:00 PM ET. From the cutoff on, the app offers the next week, so
between Thursday 4:00 PM and the following Thursday it quotes and subscribes to
next Friday's expiry — including over the weekend. The contract has to accept
`subscribe` for a week until its cutoff and from the previous week's cutoff, and
the quote service has to price it, weekends included.

The cutoff stays: a day before expiry the outcome is close to known.

### Quote service

```
GET  /premiums?week=2026-09-14&direction=buyLow
  -> { "premiums": [{ "productId": "0x…", "premiumBps": 120 }] }

POST /quote  { "productId": "0x…", "amount": "1000000000", "account": "0x…" }
  -> { "premiumBps": 120, "signature": "0x…", "expiresAt": 1757520000000 }
```

`amount` is in the deposited token's base units. `expiresAt` is optional; the
app treats a quote as good for 30 seconds without it.
