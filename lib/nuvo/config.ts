import type { Address, Ticker } from "./types";

// Brief 12: every value here is an open question. They are placeholders, kept in
// one file so agreeing on them later is a single edit.

export const MODE = (process.env.NEXT_PUBLIC_NUVO_MODE ?? "mock") as "mock" | "chain";

// Brief: the default network is Robinhood Chain mainnet, read from env. No
// testnet faucets, no testnet banners.
export const NETWORK = {
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 0),
  name: process.env.NEXT_PUBLIC_CHAIN_NAME ?? "Robinhood Chain",
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "",
  explorerUrl: process.env.NEXT_PUBLIC_EXPLORER_URL ?? "",
  usdg: (process.env.NEXT_PUBLIC_USDG_ADDRESS ?? "") as Address | "",
  nuvo: (process.env.NEXT_PUBLIC_NUVO_ADDRESS ?? "") as Address | "",
};

export const USDG = { symbol: "USDG", decimals: 6 };

/** Brief 12: the ticker list is not agreed yet. Addresses come from env. */
export const TICKERS: Ticker[] = [
  { symbol: "NVDA", name: "NVIDIA", uiMultiplier: 1, decimals: 18 },
  { symbol: "TSLA", name: "Tesla", uiMultiplier: 1, decimals: 18 },
  { symbol: "AAPL", name: "Apple", uiMultiplier: 1, decimals: 18 },
  { symbol: "MSFT", name: "Microsoft", uiMultiplier: 1, decimals: 18 },
  { symbol: "AMZN", name: "Amazon", uiMultiplier: 1, decimals: 18 },
  { symbol: "GOOGL", name: "Alphabet", uiMultiplier: 1, decimals: 18 },
  { symbol: "META", name: "Meta Platforms", uiMultiplier: 1, decimals: 18 },
  { symbol: "COIN", name: "Coinbase", uiMultiplier: 1, decimals: 18 },
];

/** Brief 12: the ladder. Buy Low goes under the reference, Sell High over it. */
export const LADDER = [2, 4, 6, 8] as const;

/** Brief 12: limits per product, in the deposited asset. */
export const LIMITS = {
  minUsdg: 100,
  maxUsdg: 50_000,
  minStockValueUsdg: 100,
};

/** Brief 1: subscriptions run Monday open to Thursday 4:00 PM ET, expiry Friday 4:00 PM ET. */
export const SCHEDULE = {
  timeZone: "America/New_York",
  /** Monday, 9:30 AM ET. */
  opensAt: { weekday: 1, hour: 9, minute: 30 },
  /** Thursday, 4:00 PM ET. */
  closesAt: { weekday: 4, hour: 16, minute: 0 },
  /** Friday, 4:00 PM ET. */
  expiresAt: { weekday: 5, hour: 16, minute: 0 },
  /** Brief 1: if the reference has not updated N hours after expiry, settle on the first fresh price. */
  staleReferenceHours: 6,
};

/** A quote is good for this long; after that the button asks for a refresh. */
export const QUOTE_TTL_MS = 30_000;

/** Brief 12: the protocol revenue model is undecided; nothing is charged in the UI yet. */
export const FEES = { spreadBps: 0, protocolFeeBps: 0 };

export const explorerTx = (hash: string) =>
  NETWORK.explorerUrl ? `${NETWORK.explorerUrl.replace(/\/$/, "")}/tx/${hash}` : undefined;

export const tickerOf = (symbol: string) => TICKERS.find((t) => t.symbol === symbol);

/** ERC-8056: stock amounts are shown through the token's UI multiplier. */
export const toUiAmount = (symbol: string, amount: number) =>
  amount * (tickerOf(symbol)?.uiMultiplier ?? 1);
