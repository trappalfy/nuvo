import { LADDER, QUOTE_TTL_MS, TICKERS, USDG } from "./config";
import { currentWeek, nextWeek } from "./schedule";
import type {
  Address,
  Direction,
  NuvoClient,
  Position,
  Product,
  Quote,
  TxResult,
  Week,
} from "./types";

// Brief 9: demo data behind the same interface as the chain client. Everything
// here is deterministic, so two people reviewing the same screen see the same
// numbers, and transactions take 1.5s so the pending states are visible.

const TX_DELAY = 1500;
const STORE_KEY = "nuvo.mock.v1";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Stable 32-bit hash, so demo numbers never move between reloads. */
function hash(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/** Demo reference prices. Not quotes, not advice — the UI marks them Demo data. */
const REFERENCE: Record<string, number> = {
  NVDA: 184.6,
  TSLA: 342.15,
  AAPL: 268.4,
  MSFT: 512.8,
  AMZN: 236.9,
  GOOGL: 292.35,
  META: 748.2,
  COIN: 396.7,
};

/** Premium falls as the target moves away from the market. */
const PREMIUM_BPS: Record<number, number> = { 2: 120, 4: 85, 6: 60, 8: 40 };

const premiumFor = (ticker: string, offset: number, weekId: string) => {
  const base = PREMIUM_BPS[Math.abs(offset)] ?? 50;
  const jitter = Math.round((hash(`${weekId}:${ticker}:${offset}`) - 0.5) * base * 0.25);
  return Math.max(5, base + jitter);
};

const round = (value: number, places: number) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

export type WeekOverride = "real" | "open" | "closed";

type Store = {
  weekId: string;
  /** Week offset applied by the developer fast forward. */
  weeksAhead: number;
  /**
   * Demo control. The real schedule closes subscriptions from Thursday 4:00 PM
   * ET to Monday's open, which would make the demo path unwalkable for half the
   * week, so the mock forces the window open by default and can be flipped back.
   */
  weekOverride: WeekOverride;
  positions: Position[];
  allowances: Record<string, number>;
  balances: Record<string, number>;
};

const freshStore = (): Store => ({
  weekId: currentWeek().id,
  weeksAhead: 0,
  weekOverride: "open",
  positions: [],
  allowances: {},
  balances: {
    USDG: 12_500,
    NVDA: 8.4,
    TSLA: 3.2,
    AAPL: 5,
    MSFT: 1.6,
    AMZN: 4.1,
    GOOGL: 2.8,
    META: 0.9,
    COIN: 2.2,
  },
});

function load(): Store {
  if (typeof window === "undefined") return freshStore();
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return freshStore();
    return { ...freshStore(), ...(JSON.parse(raw) as Store) };
  } catch {
    return freshStore();
  }
}

function save(store: Store) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // A demo store is not worth failing a render over.
  }
}

const fakeHash = (seed: string) =>
  (`0x${Array.from({ length: 8 }, (_, i) => Math.floor(hash(`${seed}:${i}`) * 0xffffffff)
    .toString(16)
    .padStart(8, "0"))
    .join("")}`) as `0x${string}`;

export class MockClient implements NuvoClient {
  readonly mode = "mock" as const;
  private store: Store;
  private listeners = new Set<() => void>();

  constructor() {
    this.store = load();
  }

  /** Screens subscribe to this so a fast forward or a claim repaints them. */
  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private commit() {
    save(this.store);
    this.listeners.forEach((l) => l());
  }

  private week(): Week {
    let week = currentWeek();
    for (let i = 0; i < this.store.weeksAhead; i++) week = nextWeek(week);
    const override = this.store.weekOverride;
    if (override === "real") return week;
    return { ...week, isOpen: override === "open" };
  }

  /** Demo control: force the subscription window open or closed. */
  setWeekOverride(override: WeekOverride) {
    this.store.weekOverride = override;
    this.commit();
  }

  get weekOverride(): WeekOverride {
    return this.store.weekOverride;
  }

  async getWeek() {
    return this.week();
  }

  async listProducts(direction: Direction, ticker?: string): Promise<Product[]> {
    const week = this.week();
    const tickers = ticker ? TICKERS.filter((t) => t.symbol === ticker) : TICKERS;

    return tickers.flatMap((t) =>
      LADDER.map((step) => {
        const offset = direction === "buyLow" ? -step : step;
        const reference = REFERENCE[t.symbol] ?? 100;
        const targetPrice = round(reference * (1 + offset / 100), 2);
        return {
          id: `${week.id}:${t.symbol}:${direction}:${step}`,
          weekId: week.id,
          ticker: t.symbol,
          direction,
          targetPrice,
          targetOffset: offset,
          referencePrice: reference,
          premiumBps: premiumFor(t.symbol, offset, week.id),
          expiresAt: week.expiresAt,
          status: week.isOpen ? "open" : "locked",
        } satisfies Product;
      }),
    );
  }

  private async findProduct(productId: string) {
    const [, , direction] = productId.split(":");
    const products = await this.listProducts(direction as Direction);
    const product = products.find((p) => p.id === productId);
    if (!product) throw new Error(`unknown product ${productId}`);
    return product;
  }

  async getQuote(productId: string, amount: number): Promise<Quote> {
    const product = await this.findProduct(productId);
    const r = product.premiumBps / 10_000;

    // Brief 1: D x (1 + r) / K stock or D x (1 + r) USDG for Buy Low,
    // Q x K x (1 + r) USDG or Q x (1 + r) stock for Sell High.
    const converted =
      product.direction === "buyLow"
        ? { token: product.ticker, amount: (amount * (1 + r)) / product.targetPrice }
        : { token: USDG.symbol, amount: amount * product.targetPrice * (1 + r) };

    const notConverted =
      product.direction === "buyLow"
        ? { token: USDG.symbol, amount: amount * (1 + r) }
        : { token: product.ticker, amount: amount * (1 + r) };

    return {
      productId,
      amount,
      premiumBps: product.premiumBps,
      premiumAmount: amount * r,
      ifConverted: { token: converted.token, amount: round(converted.amount, 6) },
      ifNot: { token: notConverted.token, amount: round(notConverted.amount, 6) },
      signature: fakeHash(`quote:${productId}:${amount}`),
      expiresAt: Date.now() + QUOTE_TTL_MS,
    };
  }

  async getBalances(): Promise<Record<string, number>> {
    return { ...this.store.balances };
  }

  async getAllowance(token: string) {
    return this.store.allowances[token] ?? 0;
  }

  async approve(token: string, amount: number): Promise<TxResult> {
    await wait(TX_DELAY);
    this.store.allowances[token] = Math.max(this.store.allowances[token] ?? 0, amount);
    this.commit();
    return { hash: fakeHash(`approve:${token}:${amount}:${Date.now()}`) };
  }

  async subscribe(productId: string, amount: number, quote: Quote) {
    const product = await this.findProduct(productId);
    const depositToken = product.direction === "buyLow" ? USDG.symbol : product.ticker;

    if ((this.store.balances[depositToken] ?? 0) < amount) {
      throw new Error(`Not enough ${depositToken} in your wallet`);
    }

    await wait(TX_DELAY);

    this.store.balances[depositToken] = round((this.store.balances[depositToken] ?? 0) - amount, 6);
    this.store.allowances[depositToken] = Math.max(
      0,
      (this.store.allowances[depositToken] ?? 0) - amount,
    );

    const position: Position = {
      id: `${productId}:${Date.now()}`,
      productId,
      weekId: product.weekId,
      ticker: product.ticker,
      direction: product.direction,
      targetPrice: product.targetPrice,
      premiumBps: quote.premiumBps,
      amount,
      depositToken,
      subscribedAt: Date.now(),
      expiresAt: product.expiresAt,
      status: "active",
    };

    this.store.positions = [position, ...this.store.positions];
    this.commit();

    return { hash: fakeHash(`subscribe:${position.id}`), positionId: position.id };
  }

  async getPositions(_address?: Address): Promise<Position[]> {
    return [...this.store.positions];
  }

  async claim(positionId: string): Promise<TxResult> {
    const position = this.store.positions.find((p) => p.id === positionId);
    if (!position?.settlement) throw new Error("nothing to claim");

    await wait(TX_DELAY);

    const { token, amount } = position.settlement.payout;
    this.store.balances[token] = round((this.store.balances[token] ?? 0) + amount, 6);
    position.status = "claimed";
    position.settlement.claimedAt = Date.now();
    this.commit();

    return { hash: fakeHash(`claim:${positionId}`) };
  }

  /** Brief 9: the developer control that settles the week so Claim can be reviewed. */
  async fastForwardWeek() {
    const week = this.week();

    for (const position of this.store.positions) {
      if (position.status !== "active" || position.weekId !== week.id) continue;

      const reference = REFERENCE[position.ticker] ?? 100;
      // Deterministic settlement inside +/-9% of the reference. The spread is
      // wider than the ladder on purpose: which rung you picked is what decides
      // the outcome, so a review sees both.
      const drift = (hash(`settle:${position.weekId}:${position.ticker}`) * 2 - 1) * 0.09;
      const settlePrice = round(reference * (1 + drift), 2);

      const converted =
        position.direction === "buyLow"
          ? settlePrice <= position.targetPrice
          : settlePrice >= position.targetPrice;

      const r = position.premiumBps / 10_000;
      const payout = converted
        ? position.direction === "buyLow"
          ? {
              token: position.ticker,
              amount: round((position.amount * (1 + r)) / position.targetPrice, 6),
            }
          : { token: USDG.symbol, amount: round(position.amount * position.targetPrice * (1 + r), 6) }
        : position.direction === "buyLow"
          ? { token: USDG.symbol, amount: round(position.amount * (1 + r), 6) }
          : { token: position.ticker, amount: round(position.amount * (1 + r), 6) };

      position.status = "claimable";
      position.settlement = { settlePrice, converted, payout };
    }

    this.store.weeksAhead += 1;
    this.store.weekId = this.week().id;
    this.commit();
  }

  /** Demo only: wipe the store so a review can start from scratch. */
  reset() {
    this.store = freshStore();
    this.commit();
  }
}
