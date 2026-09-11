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

### Quote service

```
GET  /premiums?week=2026-09-14&direction=buyLow
  -> { "premiums": [{ "productId": "0x…", "premiumBps": 120 }] }

POST /quote  { "productId": "0x…", "amount": "1000000000", "account": "0x…" }
  -> { "premiumBps": 120, "signature": "0x…", "expiresAt": 1757520000000 }
```

`amount` is in the deposited token's base units. `expiresAt` is optional; the
app treats a quote as good for 30 seconds without it.
