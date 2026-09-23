// The shape the screens read. One implementation, ChainClient, backed by the
// network and the factory from env.
//
// Amounts on this side are in display units: what the user sees and types. The
// feed prices the token itself, so the ERC-8056 multiplier never enters an
// amount — it is a label, nothing more.

export type Direction = "buyLow" | "sellHigh";

export type Address = `0x${string}`;

/** What the token contract itself reports. */
export type TokenInfo = {
  symbol: string;
  address: Address;
  name: string;
  decimals: number;
  /** ERC-8056: how many shares one token stands for. Shown, never multiplied in. */
  uiMultiplier: number;
};

/** A wallet balance in display units, with the exact decimal string for Max. */
export type Balance = { amount: number; exact: string };

export type Week = {
  /** ISO date of the Monday in ET. */
  id: string;
  /** "Week of Sep 14–18" */
  label: string;
  /** Thursday 4:00 PM ET: the last moment to subscribe to this week's expiry. */
  closesAt: number;
  /** Friday 4:00 PM ET. */
  expiresAt: number;
  /** Subscriptions to this week are still taken. Always true for the week on offer. */
  isOpen: boolean;
};

export type ProductStatus = "open" | "locked" | "settled";

export type Reference = {
  price: number;
  updatedAt: number;
  /** True when the feed has not updated inside the window from the config. */
  stale: boolean;
  /** "chain" is a pool read; "catalog" is the line-up used before the chain is configured. */
  source: "chain" | "catalog";
};

/** A ticker on offer, with what the UI needs to label it. */
export type TickerInfo = {
  symbol: string;
  name: string;
  uiMultiplier: number;
};

export type Product = {
  /** Key for React: the pool, the direction and the rung. */
  id: string;
  pool: Address;
  ticker: string;
  direction: Direction;
  /** Distance to the target in bps: 200 for 2%. */
  distanceBps: number;
  /** The same distance as a signed percentage, for the label. */
  targetOffset: number;
  targetPrice: number;
  strikeWad: bigint;
  reference: Reference;
  premiumBps?: number;
  expiresAt: number;
  status: ProductStatus;
};

/** What the pool answers for one amount: premium, strike and both outcomes. */
export type PreviewResult = {
  /** 0 means the pool will take it; anything else is the reason it will not. */
  code: number;
  premiumBps: number;
  strikeWad: bigint;
  expiresAt: number;
  /** Payout if the reference reaches the target. */
  ifConverted: { token: string; amount: number };
  /** Payout if it does not. */
  ifNot: { token: string; amount: number };
};

/** The depositor's side of one pool. */
export type PoolStats = {
  pool: Address;
  ticker: string;
  /** Value of the depositors' inventory, in USDG. */
  valueUsdg: number;
  /** The free part: this much can be withdrawn right now. */
  freeUsdg: number;
  shares: bigint;
  totalShares: bigint;
  /** The depositor's share, in USDG — including the part reserved against open positions. */
  myValueUsdg: number;
  /** Of that share, what the pool can actually pay out right now. */
  withdrawableUsdg: number;
  /**
   * Whether the reference price is good enough for a deposit or a withdrawal.
   * Both are priced off the feed, so a dead or stale one means the pool will
   * refuse the transaction — better to say so than to let it revert.
   */
  priceOk: boolean;
  paused: boolean;
};

/**
 * A payout that was closed by someone else. Anyone may close a position a day
 * after its expiry so the inventory behind it goes back to work; the payout is
 * then recorded as a debt of the pool instead of being sent. This is that debt.
 */
export type OwedBalance = {
  /** "0xPool:0xAsset" — the pool that owes it and the token it owes. */
  id: string;
  pool: Address;
  ticker: string;
  /** Symbol of the token owed. */
  token: string;
  amount: number;
};

export type PositionStatus = "active" | "claimable" | "claimed";

export type Position = {
  /** "0xPool:index" — the pool that holds it and its index there. */
  id: string;
  pool: Address;
  ticker: string;
  direction: Direction;
  targetPrice: number;
  premiumBps: number;
  amount: number;
  depositToken: string;
  expiresAt: number;
  status: PositionStatus;
  settlement?: {
    converted: boolean;
    payout: { token: string; amount: number };
  };
};

export type TxResult = {
  hash: Address;
  explorerUrl?: string;
};

export interface NuvoClient {
  /** Reads that need the network, and writes that need the contracts. */
  readonly ready: { network: boolean; contracts: boolean; products: boolean };
  getWeek(): Promise<Week>;
  listTickers(): Promise<TickerInfo[]>;
  listProducts(direction: Direction, ticker?: string): Promise<Product[]>;
  getPreview(product: Product, amount: string): Promise<PreviewResult>;
  getBalances(address?: Address): Promise<Record<string, Balance>>;
  getAllowance(symbol: string, spender: Address, owner?: Address): Promise<number>;
  approve(symbol: string, spender: Address, amount: string): Promise<TxResult>;
  subscribe(product: Product, amount: string, preview: PreviewResult): Promise<TxResult>;
  getPositions(address?: Address): Promise<Position[]>;
  claim(positionId: string): Promise<TxResult>;
  getOwed(address?: Address): Promise<OwedBalance[]>;
  withdrawOwed(id: string): Promise<TxResult>;
  getPoolStats(ticker: string, address?: Address): Promise<PoolStats>;
  addLiquidity(ticker: string, usdgAmount: string, tokenAmount: string): Promise<TxResult>;
  removeLiquidity(ticker: string, shares: bigint): Promise<TxResult>;
  /** Screens repaint on this after a write lands. */
  onChange(listener: () => void): () => void;
}
