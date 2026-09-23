import { LADDER } from "./config";
import { currentWeek } from "./schedule";
import type { Address, Direction, Product } from "./types";

// The line-up shown until the chain is configured: the tickers, a reference
// figure for each and the weekly premium per rung. Once NEXT_PUBLIC_FACTORY_ADDRESS
// is set, listProducts reads the pools and none of this is used.
//
// TODO(launch): these are indicative figures, not market data. Refresh them, or
// configure the chain, before the site is public.

export const CATALOG: { symbol: string; name: string; reference: number }[] = [
  { symbol: "NVDA", name: "NVIDIA", reference: 184.6 },
  { symbol: "TSLA", name: "Tesla", reference: 342.15 },
  { symbol: "AAPL", name: "Apple", reference: 268.4 },
  { symbol: "MSFT", name: "Microsoft", reference: 512.8 },
  { symbol: "AMZN", name: "Amazon", reference: 236.9 },
  { symbol: "GOOGL", name: "Alphabet", reference: 292.35 },
  { symbol: "META", name: "Meta Platforms", reference: 748.2 },
  { symbol: "COIN", name: "Coinbase", reference: 396.7 },
];

/** Premium falls as the target moves away from the market. */
const PREMIUM_BPS: Record<number, number> = { 2: 120, 4: 85, 6: 60, 8: 40 };

/** Stable hash, so the figures do not move between reloads. */
const hash = (seed: string) => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
};

const premiumFor = (ticker: string, offset: number) => {
  const base = PREMIUM_BPS[Math.abs(offset)] ?? 50;
  return Math.max(5, base + Math.round((hash(`${ticker}:${offset}`) - 0.5) * base * 0.25));
};

export function catalogProducts(direction: Direction, ticker?: string): Product[] {
  const week = currentWeek();
  const items = ticker ? CATALOG.filter((item) => item.symbol === ticker.toUpperCase()) : CATALOG;

  return items.flatMap((item) =>
    LADDER.map((step) => {
      const offset = direction === "buyLow" ? -step : step;
      return {
        id: `catalog:${item.symbol}:${direction}:${step * 100}`,
        // No pool yet: the screens keep their buttons inert until the factory
        // is configured, so nothing is ever sent to this address.
        pool: "0x0000000000000000000000000000000000000000" as Address,
        ticker: item.symbol,
        direction,
        distanceBps: step * 100,
        targetOffset: offset,
        targetPrice: Number((item.reference * (1 + offset / 100)).toFixed(2)),
        strikeWad: 0n,
        reference: { price: item.reference, updatedAt: 0, stale: false, source: "catalog" },
        premiumBps: premiumFor(item.symbol, offset),
        expiresAt: week.expiresAt,
        status: week.isOpen ? "open" : "locked",
      } satisfies Product;
    }),
  );
}
