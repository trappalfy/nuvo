import {
  createPublicClient,
  formatUnits,
  http,
  parseUnits,
  type PublicClient,
  type WalletClient,
} from "viem";
import { nuvoChain } from "../wallet/chain";
import { directionIndex, erc20Abi, nuvoFactoryAbi, nuvoPoolAbi } from "./abi";
import { CATALOG, catalogProducts } from "./catalog";
import {
  LADDER,
  NETWORK,
  SCHEDULE,
  STRIKE_TOLERANCE_BPS,
  TX_DEADLINE_SECONDS,
  USDG,
  hasContracts,
  hasNetwork,
  hasProducts,
} from "./config";
import { currentWeek, isMarketOpen } from "./schedule";
import type {
  Address,
  Balance,
  Direction,
  NuvoClient,
  OwedBalance,
  PoolStats,
  Position,
  PreviewResult,
  Product,
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

/** Typed text, cut to the token's decimals so it never rounds up. */
const toBase = (amount: string, decimals: number) => {
  const [whole = "", fraction = ""] = (amount || "0").trim().split(".");
  const cut = fraction.slice(0, decimals);
  return parseUnits(`${whole || "0"}${cut ? `.${cut}` : ""}`, decimals);
};

/** Base units to an exact decimal string. */
const toExact = (value: bigint, decimals: number) => formatUnits(value, decimals);

/** A WAD price as the number the screens show. */
const priceOf = (wad: bigint) => Number(formatUnits(wad, 18));

export type PoolInfo = { address: Address; token: TokenInfo; feed: Address };

export class ChainClient implements NuvoClient {
  readonly ready = {
    network: hasNetwork(),
    contracts: hasContracts(),
    products: hasProducts(),
  };

  private publicClient: PublicClient | null = hasNetwork()
    ? (createPublicClient({ chain: nuvoChain, transport: http(NETWORK.rpcUrl) }) as PublicClient)
    : null;

  private wallet: WalletClient | null = null;
  private account: Address | undefined;
  private poolCache: Promise<PoolInfo[]> | null = null;
  private usdgInfo: TokenInfo | null = null;
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
    if (!NETWORK.factory) throw new NotConfiguredError("The Nuvo factory");
    // Without a reader the receipt could not be awaited after sending.
    this.reader();
    return { wallet: this.wallet, account: this.account };
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

  async getWeek(): Promise<Week> {
    return currentWeek();
  }

  // --- the registry ---

  /** The factory's registry, read once per page load. */
  async listPools(): Promise<PoolInfo[]> {
    if (!hasContracts()) return [];
    if (!this.poolCache) {
      this.poolCache = this.readPools().catch((e) => {
        this.poolCache = null;
        throw e;
      });
    }
    return this.poolCache;
  }

  private async readPools(): Promise<PoolInfo[]> {
    const client = this.reader();
    const factory = NETWORK.factory!;
    const count = await client.readContract({
      address: factory,
      abi: nuvoFactoryAbi,
      functionName: "poolCount",
    });

    const addresses = await Promise.all(
      Array.from({ length: Number(count) }, (_, i) =>
        client.readContract({
          address: factory,
          abi: nuvoFactoryAbi,
          functionName: "pools",
          args: [BigInt(i)],
        }),
      ),
    );

    return Promise.all(
      addresses.map(async (address) => {
        const [token, feed] = await Promise.all([
          client.readContract({ address, abi: nuvoPoolAbi, functionName: "token" }),
          client.readContract({ address, abi: nuvoPoolAbi, functionName: "feed" }),
        ]);
        return { address, token: await this.tokenAt(token), feed } satisfies PoolInfo;
      }),
    );
  }

  private async tokenAt(address: Address): Promise<TokenInfo> {
    const client = this.reader();
    const contract = { address, abi: erc20Abi } as const;
    const [name, symbol, decimals, multiplier] = await Promise.all([
      client.readContract({ ...contract, functionName: "name" }).catch(() => ""),
      client.readContract({ ...contract, functionName: "symbol" }),
      client.readContract({ ...contract, functionName: "decimals" }),
      // ERC-8056 is optional on a token; without it the label is simply 1.
      client.readContract({ ...contract, functionName: "uiMultiplier" }).catch(() => 0n),
    ]);
    const wad = BigInt(multiplier);
    return {
      symbol: String(symbol).toUpperCase(),
      address,
      name: String(name) || String(symbol),
      decimals: Number(decimals),
      uiMultiplier: wad > 0n ? Number(formatUnits(wad, 18)) : 1,
    };
  }

  private async usdgToken(): Promise<TokenInfo> {
    if (this.usdgInfo) return this.usdgInfo;
    if (!USDG.address) throw new NotConfiguredError("USDG");
    this.usdgInfo = await this.tokenAt(USDG.address);
    return this.usdgInfo;
  }

  private async poolFor(ticker: string): Promise<PoolInfo> {
    const pools = await this.listPools();
    const found = pools.find((p) => p.token.symbol === ticker.toUpperCase());
    if (!found) throw new NotConfiguredError(ticker.toUpperCase());
    return found;
  }

  private async tokenBySymbol(symbol: string): Promise<TokenInfo> {
    const key = symbol.toUpperCase();
    const usdg = await this.usdgToken();
    if (key === usdg.symbol) return usdg;
    return (await this.poolFor(key)).token;
  }

  async listTickers(): Promise<TickerInfo[]> {
    if (!hasProducts()) {
      return CATALOG.map(({ symbol, name }) => ({ symbol, name, uiMultiplier: 1 }));
    }
    const pools = await this.listPools();
    return pools.map((p) => ({
      symbol: p.token.symbol,
      name: p.token.name,
      uiMultiplier: p.token.uiMultiplier,
    }));
  }

  // --- the ladder ---

  async listProducts(direction: Direction, ticker?: string): Promise<Product[]> {
    // Until the factory is configured the line-up comes from the catalog.
    if (!hasProducts()) return catalogProducts(direction, ticker);

    const pools = await this.listPools();
    const wanted = ticker ? pools.filter((p) => p.token.symbol === ticker.toUpperCase()) : pools;

    const perPool = await Promise.all(
      wanted.map(async (pool) => {
        const rungs = await Promise.all(
          LADDER.map((step) => this.rawPreview(pool.address, direction, step * 100, 0n)),
        );
        return rungs.flatMap((raw, index) => {
          if (!raw) return [];
          const step = LADDER[index];
          const price = priceOf(raw.priceWad);
          if (price <= 0) return [];
          const updatedAt = Number(raw.priceUpdatedAt) * 1000;
          const reference: Reference = {
            price,
            updatedAt,
            // Outside market hours the feed rests at the last close; that is not stale.
            stale: isMarketOpen() && Date.now() - updatedAt > SCHEDULE.staleReferenceHours * 3600_000,
            source: "chain",
          };
          return [
            {
              id: `${pool.address}:${direction}:${step * 100}`,
              pool: pool.address,
              ticker: pool.token.symbol,
              direction,
              distanceBps: step * 100,
              targetOffset: direction === "buyLow" ? -step : step,
              targetPrice: priceOf(raw.strikeWad),
              strikeWad: raw.strikeWad,
              reference,
              premiumBps: raw.premiumBps > 0 ? raw.premiumBps : undefined,
              expiresAt: Number(raw.expiry) * 1000,
              status: "open",
            } satisfies Product,
          ];
        });
      }),
    );

    return perPool.flat();
  }

  private async rawPreview(pool: Address, direction: Direction, distanceBps: number, amount: bigint) {
    try {
      return await this.reader().readContract({
        address: pool,
        abi: nuvoPoolAbi,
        functionName: "preview",
        args: [directionIndex(direction), distanceBps, amount],
      });
    } catch {
      return null;
    }
  }

  /** The terms for the amount typed. This is what replaced the quote service. */
  async getPreview(product: Product, amount: string): Promise<PreviewResult> {
    const pool = await this.poolFor(product.ticker);
    const usdg = await this.usdgToken();
    const deposit = product.direction === "buyLow" ? usdg : pool.token;
    const converted = product.direction === "buyLow" ? pool.token : usdg;

    const raw = await this.rawPreview(
      product.pool,
      product.direction,
      product.distanceBps,
      toBase(amount, deposit.decimals),
    );
    if (!raw) throw new NotConfiguredError("The pool");

    return {
      code: Number(raw.code),
      premiumBps: Number(raw.premiumBps),
      strikeWad: raw.strikeWad,
      expiresAt: Number(raw.expiry) * 1000,
      ifConverted: {
        token: converted.symbol,
        amount: Number(toExact(raw.ifConverted, converted.decimals)),
      },
      ifNot: { token: deposit.symbol, amount: Number(toExact(raw.ifNot, deposit.decimals)) },
    };
  }

  // --- wallet ---

  async getBalances(address?: Address): Promise<Record<string, Balance>> {
    const owner = address ?? this.account;
    if (!owner || !hasNetwork() || !USDG.address) return {};
    const client = this.reader();
    const tokens = [await this.usdgToken(), ...(await this.listPools()).map((p) => p.token)];

    const entries = await Promise.all(
      tokens.map(async (token) => {
        try {
          const balance = await client.readContract({
            address: token.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [owner],
          });
          const exact = toExact(balance, token.decimals);
          return [token.symbol, { amount: Number(exact), exact }] as const;
        } catch {
          return null;
        }
      }),
    );
    return Object.fromEntries(entries.filter((e): e is readonly [string, Balance] => !!e));
  }

  /** The allowance is given to the pool that will pull the deposit. */
  async getAllowance(symbol: string, spender: Address, owner?: Address): Promise<number> {
    const account = owner ?? this.account;
    if (!account) return 0;
    try {
      const token = await this.tokenBySymbol(symbol);
      const allowance = await this.reader().readContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, spender],
      });
      return Number(toExact(allowance, token.decimals));
    } catch {
      return 0;
    }
  }

  async approve(
    symbol: string,
    spender: Address,
    amount: string,
    onSubmitted?: (hash: Address) => void,
  ): Promise<TxResult> {
    const { wallet, account } = this.writer();
    const token = await this.tokenBySymbol(symbol);
    const hash = await wallet.writeContract({
      address: token.address,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, toBase(amount, token.decimals)],
      account,
      chain: nuvoChain,
    });
    return this.send(hash, onSubmitted);
  }

  async subscribe(
    product: Product,
    amount: string,
    preview: PreviewResult,
    onSubmitted?: (hash: Address) => void,
  ): Promise<TxResult> {
    const { wallet, account } = this.writer();
    const pool = await this.poolFor(product.ticker);
    const usdg = await this.usdgToken();
    const deposit = product.direction === "buyLow" ? usdg : pool.token;

    // The strike is taken from the live price when the transaction lands. This
    // is how far it is allowed to have moved: Buy Low suffers when the price
    // rises, Sell High when it falls.
    const tolerance = BigInt(STRIKE_TOLERANCE_BPS);
    const limitStrike =
      product.direction === "buyLow"
        ? (preview.strikeWad * (10_000n + tolerance)) / 10_000n
        : (preview.strikeWad * (10_000n - tolerance)) / 10_000n;

    const hash = await wallet.writeContract({
      address: product.pool,
      abi: nuvoPoolAbi,
      functionName: "subscribe",
      args: [
        directionIndex(product.direction),
        product.distanceBps,
        toBase(amount, deposit.decimals),
        limitStrike,
        BigInt(Math.floor(Date.now() / 1000) + TX_DEADLINE_SECONDS),
      ],
      account,
      chain: nuvoChain,
    });
    return this.send(hash, onSubmitted);
  }

  // --- positions ---

  async getPositions(address?: Address): Promise<Position[]> {
    const owner = address ?? this.account;
    if (!owner || !hasContracts()) return [];
    const client = this.reader();
    const usdg = await this.usdgToken();
    const pools = await this.listPools();

    const perPool = await Promise.all(
      pools.map(async (pool) => {
        const ids = await client.readContract({
          address: pool.address,
          abi: nuvoPoolAbi,
          functionName: "positionsOf",
          args: [owner],
        });

        return Promise.all(
          ids.map(async (id) => {
            const [p, payout] = await Promise.all([
              client.readContract({
                address: pool.address,
                abi: nuvoPoolAbi,
                functionName: "position",
                args: [id],
              }),
              client.readContract({
                address: pool.address,
                abi: nuvoPoolAbi,
                functionName: "positionPayout",
                args: [id],
              }),
            ]);

            const direction: Direction = Number(p.direction) === 0 ? "buyLow" : "sellHigh";
            const deposit = direction === "buyLow" ? usdg : pool.token;
            const [settled, converted, asset, amount] = payout;
            const payoutToken =
              asset.toLowerCase() === usdg.address.toLowerCase() ? usdg : pool.token;

            return {
              id: `${pool.address}:${id.toString()}`,
              pool: pool.address,
              ticker: pool.token.symbol,
              direction,
              targetPrice: priceOf(p.strikeWad),
              premiumBps: Number(p.premiumBps),
              amount: Number(toExact(p.deposit, deposit.decimals)),
              depositToken: deposit.symbol,
              expiresAt: Number(p.expiry) * 1000,
              status: p.claimed ? "claimed" : settled ? "claimable" : "active",
              ...(settled
                ? {
                    settlement: {
                      converted,
                      payout: {
                        token: payoutToken.symbol,
                        amount: Number(toExact(amount, payoutToken.decimals)),
                      },
                    },
                  }
                : {}),
            } satisfies Position;
          }),
        );
      }),
    );

    return perPool.flat().sort((a, b) => b.expiresAt - a.expiresAt);
  }

  async claim(positionId: string, onSubmitted?: (hash: Address) => void): Promise<TxResult> {
    const { wallet, account } = this.writer();
    const [pool, index] = positionId.split(":");
    const hash = await wallet.writeContract({
      address: pool as Address,
      abi: nuvoPoolAbi,
      functionName: "claim",
      args: [BigInt(index)],
      account,
      chain: nuvoChain,
    });
    return this.send(hash, onSubmitted);
  }

  /**
   * Payouts the pool holds for this wallet. A position left unclaimed a day
   * after expiry can be closed by anyone — the inventory behind it has to go
   * back to work — and the payout is then recorded here instead of being sent.
   * Without this the money is on chain and invisible.
   */
  /**
   * Whether this wallet may deposit or subscribe. A pool starts invite-only, so
   * a stranger would otherwise meet a reverted transaction where a sentence
   * would do.
   */
  async canEnter(ticker: string, address?: Address): Promise<boolean> {
    const pool = await this.poolFor(ticker);
    return this.poolAccess(pool.address, address ?? this.account);
  }

  private async poolAccess(pool: Address, who?: Address): Promise<boolean> {
    const client = this.reader();
    const on = await client.readContract({
      address: pool,
      abi: nuvoPoolAbi,
      functionName: "allowlistOn",
    });
    if (!on) return true;
    if (!who) return false;
    return client.readContract({
      address: pool,
      abi: nuvoPoolAbi,
      functionName: "allowed",
      args: [who],
    });
  }

  async getOwed(address?: Address): Promise<OwedBalance[]> {
    const owner = address ?? this.account;
    if (!owner || !hasContracts()) return [];
    const client = this.reader();
    const usdg = await this.usdgToken();
    const pools = await this.listPools();

    const perPool = await Promise.all(
      pools.map(async (pool) => {
        const assets = [usdg, pool.token];
        const amounts = await Promise.all(
          assets.map((asset) =>
            client.readContract({
              address: pool.address,
              abi: nuvoPoolAbi,
              functionName: "owed",
              args: [owner, asset.address],
            }),
          ),
        );
        const rows: OwedBalance[] = [];
        assets.forEach((asset, i) => {
          if (amounts[i] === 0n) return;
          rows.push({
            id: `${pool.address}:${asset.address}`,
            pool: pool.address,
            ticker: pool.token.symbol,
            token: asset.symbol,
            amount: Number(toExact(amounts[i], asset.decimals)),
          });
        });
        return rows;
      }),
    );

    return perPool.flat();
  }

  async withdrawOwed(id: string, onSubmitted?: (hash: Address) => void): Promise<TxResult> {
    const { wallet, account } = this.writer();
    const [pool, asset] = id.split(":");
    const hash = await wallet.writeContract({
      address: pool as Address,
      abi: nuvoPoolAbi,
      functionName: "withdrawOwed",
      args: [account, asset as Address],
      account,
      chain: nuvoChain,
    });
    return this.send(hash, onSubmitted);
  }

  // --- the depositor's side ---

  async getPoolStats(ticker: string, address?: Address): Promise<PoolStats> {
    const pool = await this.poolFor(ticker);
    const owner = address ?? this.account;
    const client = this.reader();
    const [value, free, total, shares, paused] = await Promise.all([
      client.readContract({ address: pool.address, abi: nuvoPoolAbi, functionName: "poolValueWad" }),
      client.readContract({ address: pool.address, abi: nuvoPoolAbi, functionName: "freeValueWad" }),
      client.readContract({ address: pool.address, abi: nuvoPoolAbi, functionName: "totalShares" }),
      owner
        ? client.readContract({
            address: pool.address,
            abi: nuvoPoolAbi,
            functionName: "sharesOf",
            args: [owner],
          })
        : Promise.resolve(0n),
      client.readContract({ address: pool.address, abi: nuvoPoolAbi, functionName: "paused" }),
    ]);

    const canEnter = await this.poolAccess(pool.address, owner);

    // A feed that is dead or stale makes the pool refuse both sides of the
    // depositor's screen. Reading it must not take the whole screen down.
    const priceOk = await Promise.all([
      client.readContract({ address: pool.address, abi: nuvoPoolAbi, functionName: "priceWad" }),
      client.readContract({
        address: pool.address,
        abi: nuvoPoolAbi,
        functionName: "maxPriceAgeSettle",
      }),
      // The chain's clock, not the browser's: the pool decides by block.timestamp,
      // and a visitor whose computer is off by a day would be told the wrong thing.
      client.getBlock(),
    ])
      .then(([[, updatedAt], maxAge, block]) => block.timestamp <= updatedAt + maxAge)
      .catch(() => false);

    return {
      pool: pool.address,
      ticker: pool.token.symbol,
      valueUsdg: priceOf(value),
      freeUsdg: priceOf(free),
      shares,
      totalShares: total,
      myValueUsdg: total > 0n ? priceOf((value * shares) / total) : 0,
      withdrawableUsdg:
        total > 0n ? priceOf((value * shares) / total < free ? (value * shares) / total : free) : 0,
      priceOk,
      canEnter,
      paused,
    };
  }

  /**
   * The pool takes a floor on what a deposit or a withdrawal must return. Sent
   * as zero it would accept any price, so both are derived from the pool's own
   * figures read a moment earlier, with a tolerance.
   */
  private static readonly LP_TOLERANCE_BPS = 100n;

  private async poolFigures(pool: Address) {
    const client = this.reader();
    const [value, free, total, freeUsdgAmount, freeTokenAmount, price] = await Promise.all([
      client.readContract({ address: pool, abi: nuvoPoolAbi, functionName: "poolValueWad" }),
      client.readContract({ address: pool, abi: nuvoPoolAbi, functionName: "freeValueWad" }),
      client.readContract({ address: pool, abi: nuvoPoolAbi, functionName: "totalShares" }),
      client.readContract({ address: pool, abi: nuvoPoolAbi, functionName: "freeUsdg" }),
      client.readContract({ address: pool, abi: nuvoPoolAbi, functionName: "freeToken" }),
      client.readContract({ address: pool, abi: nuvoPoolAbi, functionName: "priceWad" }),
    ]);
    return { value, free, total, freeUsdgAmount, freeTokenAmount, price: price[0] };
  }

  private static floor(amount: bigint) {
    return (amount * (10_000n - ChainClient.LP_TOLERANCE_BPS)) / 10_000n;
  }

  async addLiquidity(
    ticker: string,
    usdgAmount: string,
    tokenAmount: string,
    onSubmitted?: (hash: Address) => void,
  ): Promise<TxResult> {
    const { wallet, account } = this.writer();
    const pool = await this.poolFor(ticker);
    const usdg = await this.usdgToken();
    const usdgIn = toBase(usdgAmount || "0", usdg.decimals);
    const tokenIn = toBase(tokenAmount || "0", pool.token.decimals);

    const { value, total, price } = await this.poolFigures(pool.address);
    const addWad =
      usdgIn * 10n ** BigInt(18 - usdg.decimals) +
      (tokenIn * 10n ** BigInt(18 - pool.token.decimals) * price) / WAD;
    const expected = total > 0n && value > 0n ? (addWad * total) / value : addWad;

    const hash = await wallet.writeContract({
      address: pool.address,
      abi: nuvoPoolAbi,
      functionName: "addLiquidity",
      args: [usdgIn, tokenIn, ChainClient.floor(expected)],
      account,
      chain: nuvoChain,
    });
    return this.send(hash, onSubmitted);
  }

  async removeLiquidity(
    ticker: string,
    shares: bigint,
    onSubmitted?: (hash: Address) => void,
  ): Promise<TxResult> {
    const { wallet, account } = this.writer();
    const pool = await this.poolFor(ticker);
    const { value, free, total, freeUsdgAmount, freeTokenAmount } = await this.poolFigures(
      pool.address,
    );

    // The same arithmetic the pool does, so the floors are the payout the
    // depositor was shown rather than a guess.
    const owedWad = total > 0n ? (value * shares) / total : 0n;
    const minUsdg = free > 0n ? ChainClient.floor((freeUsdgAmount * owedWad) / free) : 0n;
    const minToken = free > 0n ? ChainClient.floor((freeTokenAmount * owedWad) / free) : 0n;

    const hash = await wallet.writeContract({
      address: pool.address,
      abi: nuvoPoolAbi,
      functionName: "removeLiquidity",
      args: [shares, minUsdg, minToken],
      account,
      chain: nuvoChain,
    });
    return this.send(hash, onSubmitted);
  }
}
