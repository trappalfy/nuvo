import { USDG } from "./nuvo/config";

// Numbers in the app are tabular, so widths stay put while values change.

export const usd = (value: number, places = 2) =>
  value.toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places });

/** Stock amounts go through the token's ERC-8056 UI multiplier before they are shown. */
export const qty = (value: number, places = 4, multiplier = 1) =>
  (value * multiplier).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: places,
  });

export const amountOf = (token: string, value: number, multiplier = 1) =>
  token === USDG.symbol ? `${usd(value)} ${token}` : `${qty(value, 4, multiplier)} ${token}`;

export const pct = (bps: number, places = 2) => `${(bps / 100).toFixed(places)}%`;

/** Brief 8: the ladder shows a simple annualisation of the weekly premium. */
export const apr = (bps: number) => `${Math.round((bps * 52) / 100)}%`;

export const signedPct = (value: number) => `${value > 0 ? "+" : ""}${value}%`;

/** "4m ago", "3h ago", "2d ago". */
export const ago = (ts: number, now = Date.now()) => {
  const minutes = Math.max(0, Math.round((now - ts) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};
