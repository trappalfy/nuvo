import { toUiAmount } from "./nuvo/config";

// Numbers in the app are tabular, so widths stay put while values change.

export const usd = (value: number, places = 2) =>
  value.toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places });

/** Stock amounts go through the ERC-8056 UI multiplier before they are shown. */
export const qty = (symbol: string, value: number, places = 4) =>
  toUiAmount(symbol, value).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: places,
  });

export const amountOf = (token: string, value: number) =>
  token === "USDG" ? `${usd(value)} USDG` : `${qty(token, value)} ${token}`;

export const pct = (bps: number, places = 2) => `${(bps / 100).toFixed(places)}%`;

/** Brief 8: the ladder chips show a simple annualisation of the weekly premium. */
export const apr = (bps: number) => `${Math.round((bps * 52) / 100)}%`;

export const signedPct = (value: number) => `${value > 0 ? "+" : ""}${value}%`;
