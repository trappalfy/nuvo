import {
  createPublicClient,
  formatUnits,
  http,
  parseUnits,
  type PublicClient,
  type WalletClient,
} from "viem";
import { nuvoChain } from "../wallet/chain";
import { aggregatorV3Abi, erc20Abi, nuvoDualAbi, productId as deriveProductId } from "./abi";
import { CATALOG, catalogProducts } from "./catalog";
import {
  LADDER,
  NETWORK,
  QUOTE_API,
  QUOTE_TTL_MS,
  SCHEDULE,
  TOKENS,
  USDG,
  hasContracts,
  hasNetwork,
  hasProducts,
  hasQuotes,
  tokenOf,
} from "./config";
import { currentWeek, isMarketOpen } from "./schedule";
import type {
  Address,
  Balance,
  Direction,
  NuvoClient,
  Position,
  Product,
  Quote,
  Reference,
  TickerInfo,
  TokenInfo,
  TxResult,
  Week,
} from "./types";

/** Thrown when something the call needs is not in env yet. */
export class NotConfiguredError extends Error {
  constructor(what: string) {
    super(`${what} is not configured`);
    this.name = "NotConfiguredError";
  }
}

/** Thrown when the market maker cannot price a subscription right now. */
export class QuoteUnavailableError extends Error {
  constructor(message = "Quotes are unavailable right now") {
    super(message);
    this.name = "QuoteUnavailableError";
  }
}

/** Thrown when a write is attempted without a connected wallet. */
export class NoWalletError extends Error {
  constructor() {
    super("Connect a wallet first");
    this.name = "NoWalletError";
  }
}

/**
 * The transaction was sent but its receipt did not come back in time. It may
 * still land, so this must not read as a failure that invites a second one.
 */
export class TxPendingError extends Error {
  constructor(readonly hash: Address) {
    super("Transaction is still pending. Check the explorer before trying again.");
    this.name = "TxPendingError";
  }
}

/** The transaction was mined and reverted. */
export class TxRevertedError extends Error {
  constructor(readonly hash: Address) {
    super("Transaction failed. Try again.");
    this.name = "TxRevertedError";
  }
}

const WAD = 10n ** 18n;

/**
 * ERC-8056 multiplier as 18-decimal fixed point. A token that reports a small
 * plain factor instead (2 after a 2:1 split) is read as that factor; none, or
 * zero, is 1.
 */
const multiplierWad = (value: bigint) =>
  value <= 0n ? WAD : value < 10n ** 9n ? value * WAD : value;

/** Typed text, cut to the token's decimals so it never rounds up. */
const truncate = (amount: string, decimals: number) => {
  const [whole = "", fraction = ""] = amount.trim().split(".");
  const cut = fraction.slice(0, decimals);
  return `${whole || "0"}${cut ? `.${cut}` : ""}`;
};

/** Display units, as typed, to the token's base units. Exact, rounded down. */
const toBase = (amount: string, token: TokenInfo) =>
  (parseUnits(truncate(amount, token.decimals), token.decimals) * WAD) / token.uiMultiplierWad;

/** Base units to display units, rounded down, as an exact decimal string. */
const toDisplay = (value: bigint, token: TokenInfo) =>
  formatUnits((value * token.uiMultiplierWad) / WAD, token.decimals);

export class ChainClient implements NuvoClient {
  readonly ready = {
    network: hasNetwork(),
    contracts: hasContracts(),
    products: hasProducts(),
    quotes: hasQuotes(),
  };

  private publicClient: PublicClient | null = hasNetwork()
    ? (createPublicClient({ chain: nuvoChain, transport: http(NETWORK.rpcUrl) }) as PublicClient)
    : null;

  private wallet: WalletClient | null = null;
  private account: Address | undefined;
  private tokens = new Map<string, TokenInfo>();
  private listeners = new Set<() => void>();

  /** The provider layer hands the connected wallet down after every change. */
  setWallet(wallet: WalletClient | null, account?: Address) {
    const changed = this.account !== account;
    this.wallet = wallet;
    this.account = account;
    if (changed) this.emit();
  }

  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  private reader() {
    if (!this.publicClient) throw new NotConfiguredError("The network");
    return this.publicClient;
  }

  private writer() {
    if (!this.wallet || !this.account) throw new NoWalletError();
    if (!NETWORK.nuvo) throw new NotConfiguredError("The Nuvo contract");
    // Without a reader the receipt could not be awaited after sending.
    this.reader();
    return { wallet: this.wallet, account: this.account, nuvo: NETWORK.nuvo };
  }

  async getWeek(): Promise<Week> {
    return currentWeek();
  }

  async getToken(symbol: string): Promise<TokenInfo> {
    const key = symbol.toUpperCase();
    const cached = this.tokens.get(key);
    if (cached) return cached;

    const address =
      key === USDG.symbol.toUpperCase() ? USDG.address : tokenOf(key)?.address;
    if (!address) throw new NotConfiguredError(`${key}`);

    const client = this.reader();
    const contract = { address, abi: erc20Abi } as const;

    const [name, decimals, multiplier] = await Promise.all([
      client.readContract({ ...contract, functionName: "name" }).catch(() => key),
      client.readContract({ ...contract, functionName: "decimals" }),
      // ERC-8056 is optional on a token; without it amounts are shown as they are.
      client.readContract({ ...contract, functionName: "uiMultiplier" }).catch(() => 0n),
    ]);

    const wad = multiplierWad(BigInt(multiplier));
    const info: TokenInfo = {
      symbol: key,
      address,
      name: String(name),
      decimals: Number(decimals),
      uiMultiplier: Number(formatUnits(wad, 18)),
      uiMultiplierWad: wad,
    };
    this.tokens.set(key, info);
    return info;
  }

  /** Chainlink reference the products settle on. */
  private async reference(feed: Address): Promise<Reference> {
    const client = this.reader();
    const [decimals, round] = await Promise.all([
      client.readContract({ address: feed, abi: aggregatorV3Abi, functionName: "decimals" }),
      client.readContract({ address: feed, abi: aggregatorV3Abi, functionName: "latestRoundData" }),
    ]);
    const [, answer, , updatedAt] = round;
    const updated = Number(updatedAt) * 1000;
    return {
      price: Number(formatUnits(answer, Number(decimals))),
      updatedAt: updated,
      // Outside market hours the feed rests at the last close; that is not stale.
      stale: isMarketOpen() && Date.now() - updated > SCHEDULE.staleReferenceHours * 3600_000,
      source: "chain",
    };
  }

  /**
   * Premiums for the week come from the market maker. The endpoint answers
   * `{ premiums: [{ productId, premiumBps }] }`; anything else leaves the ladder
   * without premiums rather than showing a made-up number.
   */
  private async premiums(weekId: string, direction: Direction): Promise<Map<string, number>> {
    if (!hasQuotes()) return new Map();
    try {
      const response = await fetch(
        `${QUOTE_API}/premiums?week=${encodeURIComponent(weekId)}&direction=${direction}`,
        { headers: { accept: "application/json" } },
      );
      if (!response.ok) return new Map();
      const body = (await response.json()) as {
        premiums?: { productId: string; premiumBps: number }[];
      };
      return new Map(
        (body.premiums ?? [])
          .filter((p) => typeof p.productId === "string" && isPremium(p.premiumBps))
          .map((p) => [p.productId.toLowerCase(), p.premiumBps]),
      );
    } catch {
      return new Map();
    }
  }

  /** The tickers on offer, in display order. */
  async listTickers(): Promise<TickerInfo[]> {
    if (!hasProducts()) {
      return CATALOG.map(({ symbol, name }) => ({ symbol, name, uiMultiplier: 1 }));
    }
    return Promise.all(
      TOKENS.map(async (token) => {
        try {
          const info = await this.getToken(token.symbol);
          return { symbol: token.symbol, name: info.name, uiMultiplier: info.uiMultiplier };
        } catch {
          return { symbol: token.symbol, name: token.symbol, uiMultiplier: 1 };
        }
      }),
    );
  }

  async listProducts(direction: Direction, ticker?: string): Promise<Product[]> {
    // Until the tokens and feeds are configured the line-up comes from the catalog.
    if (!hasProducts()) return catalogProducts(direction, ticker);

    const week = currentWeek();
    const wanted = ticker
      ? TOKENS.filter((token) => token.symbol === ticker.toUpperCase())
      : TOKENS;
    const premiums = await this.premiums(week.id, direction);

    const perToken = await Promise.all(
      wanted.map(async (token) => {
        if (!token.feed) return [];
        let reference: Reference;
        try {
          reference = await this.reference(token.feed);
        } catch {
          return [];
        }

        return LADDER.map((step) => {
          const offset = direction === "buyLow" ? -step : step;
          const id = deriveProductId(week.id, token.symbol, direction, step * 100);
          const targetPrice = Number((reference.price * (1 + offset / 100)).toFixed(2));
          return {
            id,
            weekId: week.id,
            ticker: token.symbol,
            direction,
            targetPrice,
            targetOffset: offset,
            reference,
            premiumBps: premiums.get(id.toLowerCase()),
            expiresAt: week.expiresAt,
            status: week.isOpen ? "open" : "locked",
          } satisfies Product;
        });
      }),
    );

    return perToken.flat();
  }

  async getQuote(product: Product, amount: string): Promise<Quote> {
    if (!hasQuotes()) throw new QuoteUnavailableError();

    const depositSymbol = product.direction === "buyLow" ? USDG.symbol : product.ticker;
    const token = await this.getToken(depositSymbol);
    const value = Number(amount);

    const response = await fetch(`${QUOTE_API}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        productId: product.id,
        amount: toBase(amount, token).toString(),
        account: this.account,
      }),
    }).catch(() => null);

    if (!response?.ok) throw new QuoteUnavailableError();

    const body = (await response.json().catch(() => ({}))) as {
      premiumBps?: unknown;
      signature?: unknown;
      expiresAt?: unknown;
    };
    if (!isPremium(body.premiumBps)) throw new QuoteUnavailableError();
    if (typeof body.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(body.signature)) {
      throw new QuoteUnavailableError();
    }
    const premiumBps = body.premiumBps;

    // README: expiresAt is in ms. A value in seconds is taken as seconds.
    const expiresAt =
      typeof body.expiresAt === "number" && Number.isFinite(body.expiresAt)
        ? body.expiresAt < 1e12
          ? body.expiresAt * 1000
          : body.expiresAt
        : Date.now() + QUOTE_TTL_MS;

    const r = premiumBps / 10_000;
    // Brief 1: D x (1 + r) / K stock or D x (1 + r) USDG for Buy Low,
    // Q x K x (1 + r) USDG or Q x (1 + r) stock for Sell High.
    const converted =
      product.direction === "buyLow"
        ? { token: product.ticker, amount: (value * (1 + r)) / product.targetPrice }
        : { token: USDG.symbol, amount: value * product.targetPrice * (1 + r) };
    const kept =
      product.direction === "buyLow"
        ? { token: USDG.symbol, amount: value * (1 + r) }
        : { token: product.ticker, amount: value * (1 + r) };

    return {
      productId: product.id,
      amount: value,
      input: amount,
      premiumBps,
      premiumAmount: value * r,
      ifConverted: converted,
      ifNot: kept,
      signature: body.signature as Address,
      expiresAt,
    };
  }

  async getBalances(address?: Address): Promise<Record<string, Balance>> {
    const owner = address ?? this.account;
    if (!owner || !hasNetwork()) return {};

    const client = this.reader();
    const symbols = [USDG.symbol, ...TOKENS.map((token) => token.symbol)];

    const entries = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const token = await this.getToken(symbol);
          const balance = await client.readContract({
            address: token.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [owner],
          });
          const exact = toDisplay(balance, token);
          return [symbol, { amount: Number(exact), exact }] as const;
        } catch {
          return null;
        }
      }),
    );

    return Object.fromEntries(
      entries.filter((entry): entry is readonly [string, Balance] => !!entry),
    );
  }

  async getAllowance(symbol: string, owner?: Address): Promise<number> {
    const account = owner ?? this.account;
    if (!account || !NETWORK.nuvo) return 0;
    try {
      const token = await this.getToken(symbol);
      const allowance = await this.reader().readContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, NETWORK.nuvo],
      });
      return Number(toDisplay(allowance, token));
    } catch {
      return 0;
    }
  }

  /** Hands the hash out as soon as the wallet signs, then waits for the receipt. */
  private async send(hash: Address, onSubmitted?: (hash: Address) => void): Promise<TxResult> {
    onSubmitted?.(hash);
    let status: "success" | "reverted";
    try {
      ({ status } = await this.reader().waitForTransactionReceipt({ hash }));
    } catch {
      // Only the wait gave up; the transaction itself is out.
      this.emit();
      throw new TxPendingError(hash);
    }
    this.emit();
    if (status === "reverted") throw new TxRevertedError(hash);
    return { hash };
  }

  async approve(
    symbol: string,
    amount: string,
    onSubmitted?: (hash: Address) => void,
  ): Promise<TxResult> {
    const { wallet, account, nuvo } = this.writer();
    const token = await this.getToken(symbol);
    const hash = await wallet.writeContract({
      address: token.address,
      abi: erc20Abi,
      functionName: "approve",
      args: [nuvo, toBase(amount, token)],
      account,
      chain: nuvoChain,
    });
    return this.send(hash, onSubmitted);
  }

  async subscribe(
    product: Product,
    amount: string,
    quote: Quote,
    onSubmitted?: (hash: Address) => void,
  ): Promise<TxResult> {
    const { wallet, account, nuvo } = this.writer();
    // The signature covers one product and one amount; anything else would revert.
    if (quote.productId !== product.id || quote.input !== amount || Date.now() > quote.expiresAt) {
      throw new QuoteUnavailableError("The quote has expired. Refresh it.");
    }
    const depositSymbol = product.direction === "buyLow" ? USDG.symbol : product.ticker;
    const token = await this.getToken(depositSymbol);

    const hash = await wallet.writeContract({
      address: nuvo,
      abi: nuvoDualAbi,
      functionName: "subscribe",
      args: [product.id, toBase(amount, token), quote.signature],
      account,
      chain: nuvoChain,
    });
    return this.send(hash, onSubmitted);
  }

  async getPositions(address?: Address): Promise<Position[]> {
    const owner = address ?? this.account;
    if (!owner || !NETWORK.nuvo || !hasNetwork()) return [];

    const client = this.reader();
    const ids = await client.readContract({
      address: NETWORK.nuvo,
      abi: nuvoDualAbi,
      functionName: "positionsOf",
      args: [owner],
    });

    const positions = await Promise.all(
      ids.map(async (id) => {
        const [
          ,
          positionProductId,
          amount,
          premiumBps,
          status,
          depositToken,
          payoutToken,
          payoutAmount,
          subscribedAt,
        ] = await client.readContract({
          address: NETWORK.nuvo!,
          abi: nuvoDualAbi,
          functionName: "position",
          args: [id],
        });

        const [tickerBytes, , targetPrice, expiry, , settlePrice] = await client.readContract({
          address: NETWORK.nuvo!,
          abi: nuvoDualAbi,
          functionName: "product",
          args: [positionProductId],
        });

        const ticker = hexToTicker(tickerBytes);
        const direction: Direction =
          depositToken.toLowerCase() === USDG.address?.toLowerCase() ? "buyLow" : "sellHigh";

        const deposit = await this.tokenByAddress(depositToken, ticker, direction);
        const payout = await this.tokenByAddress(payoutToken, ticker, direction, true);

        const settled = Number(status) >= 1;
        const claimed = Number(status) === 2;

        return {
          id: id.toString(),
          productId: positionProductId,
          ticker,
          direction,
          targetPrice: Number(formatUnits(targetPrice, 8)),
          premiumBps: Number(premiumBps),
          amount: Number(toDisplay(amount, deposit)),
          depositToken: deposit.symbol,
          subscribedAt: Number(subscribedAt) * 1000,
          expiresAt: Number(expiry) * 1000,
          status: claimed ? "claimed" : settled ? "claimable" : "active",
          ...(settled
            ? {
                settlement: {
                  settlePrice: Number(formatUnits(settlePrice, 8)),
                  converted: payoutToken.toLowerCase() !== depositToken.toLowerCase(),
                  payout: { token: payout.symbol, amount: Number(toDisplay(payoutAmount, payout)) },
                },
              }
            : {}),
        } satisfies Position;
      }),
    );

    return positions.sort((a, b) => b.subscribedAt - a.subscribedAt);
  }

  /** Resolve a token address back to the symbol and decimals the UI shows. */
  private async tokenByAddress(
    address: Address,
    ticker: string,
    direction: Direction,
    payout = false,
  ): Promise<TokenInfo> {
    const usdgFirst = payout ? direction === "sellHigh" : direction === "buyLow";
    const candidates = usdgFirst ? [USDG.symbol, ticker] : [ticker, USDG.symbol];
    for (const symbol of candidates) {
      try {
        const token = await this.getToken(symbol);
        if (token.address.toLowerCase() === address.toLowerCase()) return token;
      } catch {
        // Not configured; try the other one.
      }
    }
    return {
      symbol: ticker,
      address,
      name: ticker,
      decimals: 18,
      uiMultiplier: 1,
      uiMultiplierWad: WAD,
    };
  }

  async claim(positionId: string, onSubmitted?: (hash: Address) => void): Promise<TxResult> {
    const { wallet, account, nuvo } = this.writer();
    const hash = await wallet.writeContract({
      address: nuvo,
      abi: nuvoDualAbi,
      functionName: "claim",
      args: [BigInt(positionId)],
      account,
      chain: nuvoChain,
    });
    return this.send(hash, onSubmitted);
  }
}

/** A weekly premium the UI can show: a finite number of bps under 100%. */
function isPremium(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 10_000;
}

/** Tickers are bytes32 on chain, right-padded with zeros. */
function hexToTicker(value: Address): string {
  const hex = value.slice(2).replace(/(00)+$/, "");
  let out = "";
  for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return out.trim();
}
