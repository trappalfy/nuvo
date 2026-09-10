// Brief 9: the shape the UI talks to. The chain client and the mock client both
// implement NuvoClient, so screens never learn which one they are on.

export type Direction = "buyLow" | "sellHigh";

export type ProductStatus = "open" | "locked" | "settled";

export type Address = `0x${string}`;

export type Ticker = {
  symbol: string;
  name: string;
  /** Tokenized stock address, from env. Empty until the network config is filled in. */
  address?: Address;
  /** ERC-8056: stock amounts are shown multiplied by this. */
  uiMultiplier: number;
  decimals: number;
};

export type Week = {
  /** Monday of the trading week, ISO date in ET. */
  id: string;
  /** "Week of Sep 14–18" */
  label: string;
  /** Subscriptions open, Monday market open. */
  opensAt: number;
  /** Subscriptions close, Thursday 4:00 PM ET. */
  closesAt: number;
  /** Expiry, Friday 4:00 PM ET. */
  expiresAt: number;
  /** Whether subscriptions are open right now. */
  isOpen: boolean;
};

export type Product = {
  id: string;
  weekId: string;
  ticker: string;
  direction: Direction;
  /** Target price, in USDG. */
  targetPrice: number;
  /** Distance from the reference, in percent: -2 for Buy Low -2%. */
  targetOffset: number;
  /** Chainlink reference at the time the ladder was built. */
  referencePrice: number;
  /** Premium for the week, in basis points. */
  premiumBps: number;
  expiresAt: number;
  status: ProductStatus;
  /** Chainlink reference at settlement, once it exists. */
  settlePrice?: number;
};

export type Quote = {
  productId: string;
  /** Amount the quote was made for: USDG for Buy Low, stock for Sell High. */
  amount: number;
  premiumBps: number;
  /** Premium in the deposited asset. */
  premiumAmount: number;
  /** What the position pays out if the target is reached. */
  ifConverted: { token: string; amount: number };
  /** What it pays out if it is not. */
  ifNot: { token: string; amount: number };
  /** Signed market maker quote. The mock generates it; the quote service will later. */
  signature: `0x${string}`;
  /** Quotes older than this are stale and the button asks for a refresh. */
  expiresAt: number;
};

export type PositionStatus = "active" | "claimable" | "claimed";

export type Position = {
  id: string;
  productId: string;
  weekId: string;
  ticker: string;
  direction: Direction;
  targetPrice: number;
  premiumBps: number;
  /** Deposited amount, in the deposited asset. */
  amount: number;
  depositToken: string;
  subscribedAt: number;
  expiresAt: number;
  status: PositionStatus;
  /** Set once the week has settled. */
  settlement?: {
    settlePrice: number;
    converted: boolean;
    payout: { token: string; amount: number };
    claimedAt?: number;
  };
};

export type TxResult = {
  hash: `0x${string}`;
  explorerUrl?: string;
};

// Brief 9: the client the screens use.
export interface NuvoClient {
  readonly mode: "mock" | "chain";
  getWeek(): Promise<Week>;
  listProducts(direction: Direction, ticker?: string): Promise<Product[]>;
  getQuote(productId: string, amount: number): Promise<Quote>;
  getBalances(address?: Address): Promise<Record<string, number>>;
  getAllowance(token: string, amount: number): Promise<number>;
  approve(token: string, amount: number): Promise<TxResult>;
  subscribe(productId: string, amount: number, quote: Quote): Promise<TxResult & { positionId: string }>;
  getPositions(address?: Address): Promise<Position[]>;
  claim(positionId: string): Promise<TxResult>;
  /** Mock only: jump to the next week so settlement and Claim can be reviewed. */
  fastForwardWeek?(): Promise<void>;
}
