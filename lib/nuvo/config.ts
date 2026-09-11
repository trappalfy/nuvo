import type { Address, TokenConfig } from "./types";

// Every address and endpoint comes from env. Nothing here is a stand-in for
// data: if a value is missing the app says so rather than inventing it.
//
// Each variable is read as a literal `process.env.NEXT_PUBLIC_*`: Next inlines
// only those into the browser bundle, a lookup by name comes back empty there.

const clean = (value: string | undefined) => (value ?? "").trim();

const asAddress = (value: string): Address | undefined =>
  /^0x[a-fA-F0-9]{40}$/.test(value) ? (value as Address) : undefined;

export const NETWORK = {
  chainId: Number(clean(process.env.NEXT_PUBLIC_CHAIN_ID) || 0),
  name: clean(process.env.NEXT_PUBLIC_CHAIN_NAME) || "Robinhood Chain",
  rpcUrl: clean(process.env.NEXT_PUBLIC_RPC_URL),
  explorerUrl: clean(process.env.NEXT_PUBLIC_EXPLORER_URL),
  nuvo: asAddress(clean(process.env.NEXT_PUBLIC_NUVO_ADDRESS)),
};

/** The public address of the site: absolute links for the preview image and the wallet prompt. */
export const SITE_URL = clean(process.env.NEXT_PUBLIC_SITE_URL).replace(/\/$/, "");

export const USDG = {
  symbol: clean(process.env.NEXT_PUBLIC_USDG_SYMBOL) || "USDG",
  address: asAddress(clean(process.env.NEXT_PUBLIC_USDG_ADDRESS)),
  /** Read from the token on first use; this is only the fallback for display. */
  decimals: Number(clean(process.env.NEXT_PUBLIC_USDG_DECIMALS) || 6),
};

/**
 * Tokenized stocks, from `NEXT_PUBLIC_STOCK_TOKENS`, comma separated:
 *
 *   NVDA:0xToken:0xChainlinkFeed, TSLA:0xToken:0xChainlinkFeed
 *
 * The feed is the reference the product settles on. Symbol, name, decimals and
 * the ERC-8056 UI multiplier are read from the token itself.
 */
export const TOKENS: TokenConfig[] = clean(process.env.NEXT_PUBLIC_STOCK_TOKENS)
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .flatMap((entry): TokenConfig[] => {
    const [symbol = "", token = "", feed = ""] = entry.split(":").map((part) => part.trim());
    const address = asAddress(token);
    if (!symbol || !address) return [];
    return [{ symbol: symbol.toUpperCase(), address, feed: asAddress(feed) }];
  });

/**
 * The market maker quote service. It signs the premium the contract accepts, so
 * without it products can be listed but not subscribed to.
 */
export const QUOTE_API = clean(process.env.NEXT_PUBLIC_QUOTE_API).replace(/\/$/, "");

/** Brief 1: the ladder, as a distance from the reference in percent. */
export const LADDER = [2, 4, 6, 8] as const;

/**
 * Subscriptions are open around the clock. Thursday 4:00 PM ET is the cutoff for
 * that Friday's 4:00 PM ET expiry; from then on, new subscriptions go to the next
 * Friday. The cutoff keeps anyone from entering once the outcome is nearly known.
 */
export const SCHEDULE = {
  timeZone: "America/New_York",
  closesAt: { weekday: 4, hour: 16, minute: 0 },
  expiresAt: { weekday: 5, hour: 16, minute: 0 },
  /** US market hours, to tell a closed market from a feed that stopped updating. */
  market: { opensAt: { hour: 9, minute: 30 }, closesAt: { hour: 16, minute: 0 } },
  /** Brief 1: if the reference has not updated for this long, settlement waits for a fresh price. */
  staleReferenceHours: 6,
};

/** Limits per product, in the deposited asset. Zero means no limit. */
export const LIMITS = {
  minUsdg: Number(clean(process.env.NEXT_PUBLIC_MIN_USDG) || 0),
  maxUsdg: Number(clean(process.env.NEXT_PUBLIC_MAX_USDG) || 0),
  minStockValueUsdg: Number(clean(process.env.NEXT_PUBLIC_MIN_STOCK_VALUE_USDG) || 0),
};

/** Quotes older than this have to be refreshed before subscribing. */
export const QUOTE_TTL_MS = 30_000;

/**
 * The Nuvo token. Empty until launch, and the Token page says so. The address is
 * kept as written rather than checked as 0x…, the token may launch on another chain.
 */
export const TOKEN = {
  address: clean(process.env.NEXT_PUBLIC_TOKEN_ADDRESS),
  symbol: clean(process.env.NEXT_PUBLIC_TOKEN_SYMBOL).replace(/^\$/, "").toUpperCase(),
  network: clean(process.env.NEXT_PUBLIC_TOKEN_NETWORK) || NETWORK.name,
  url: clean(process.env.NEXT_PUBLIC_TOKEN_URL),
};

/** Social links for the footer. Only https links are shown; the rest are left out. */
export const SOCIAL = [
  { label: "X", href: clean(process.env.NEXT_PUBLIC_X_URL) },
  { label: "Telegram", href: clean(process.env.NEXT_PUBLIC_TELEGRAM_URL) },
].filter((link) => /^https:\/\/\S+$/.test(link.href));

export const hasNetwork = () => NETWORK.chainId > 0 && NETWORK.rpcUrl.length > 0;
/** Writes need the network too: the receipt is awaited through it. */
export const hasContracts = () => hasNetwork() && Boolean(NETWORK.nuvo && USDG.address);
export const hasProducts = () => hasNetwork() && TOKENS.length > 0;
export const hasQuotes = () => QUOTE_API.length > 0;

export const explorerTx = (hash: string) =>
  NETWORK.explorerUrl ? `${NETWORK.explorerUrl.replace(/\/$/, "")}/tx/${hash}` : undefined;

export const explorerAddress = (address: string) =>
  NETWORK.explorerUrl ? `${NETWORK.explorerUrl.replace(/\/$/, "")}/address/${address}` : undefined;

/** Where "View contract" goes: the link from env, else the address on the network explorer. */
export const tokenUrl = () =>
  TOKEN.url || (TOKEN.address ? explorerAddress(TOKEN.address) : undefined);

export const tokenOf = (symbol: string) => TOKENS.find((t) => t.symbol === symbol.toUpperCase());
