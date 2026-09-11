// The shape the screens read. One implementation, ChainClient, backed by the
// network and the contracts from env.

export type Direction = "buyLow" | "sellHigh";

export type Address = `0x${string}`;

/** A tokenized stock, as configured in env. */
export type TokenConfig = {
  symbol: string;
  address: Address;
  /** Chainlink feed the product settles on. */
  feed?: Address;
};

/** What the token contract itself reports. */
export type TokenInfo = {
  symbol: string;
  address: Address;
  name: string;
  decimals: number;
  /** ERC-8056: amounts are shown multiplied by this. */
  uiMultiplier: number;
};

export type Week = {
  /** ISO date of the Monday in ET. Also the id the product ids are derived from. */
  id: string;
  /** "Week of Sep 14–18" */
  label: string;
  opensAt: number;
  closesAt: number;
  expiresAt: number;
  isOpen: boolean;
};

export type ProductStatus = "open" | "locked" | "settled";

export type Reference = {
  price: number;
  updatedAt: number;
  /** True when the feed has not updated inside the window from the config. */
  stale: boolean;
};

export type Product = {
  /** bytes32, derived in abi.ts and matched by the contract. */
  id: Address;
  weekId: string;
  ticker: string;
  direction: Direction;
  targetPrice: number;
  /** Distance from the reference in percent: -2 for Buy Low -2%. */
  targetOffset: number;
  reference: Reference;
  /** From the quote service. Undefined while it has no premium for this rung. */
  premiumBps?: number;
  expiresAt: number;
  status: ProductStatus;
  settlePrice?: number;
};

export type Quote = {
  productId: Address;
  amount: number;
  premiumBps: number;
  premiumAmount: number;
  /** Payout if the reference reaches the target. */
  ifConverted: { token: string; amount: number };
  /** Payout if it does not. */
  ifNot: { token: string; amount: number };
  /** Market maker signature the contract verifies. */
  signature: Address;
  expiresAt: number;
};

export type PositionStatus = "active" | "claimable" | "claimed";

export type Position = {
  id: string;
  productId: Address;
  ticker: string;
  direction: Direction;
  targetPrice: number;
  premiumBps: number;
  amount: number;
  depositToken: string;
  subscribedAt: number;
  expiresAt: number;
  status: PositionStatus;
  settlement?: {
    settlePrice: number;
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
  readonly ready: { network: boolean; contracts: boolean; products: boolean; quotes: boolean };
  getWeek(): Promise<Week>;
  getToken(symbol: string): Promise<TokenInfo>;
  listProducts(direction: Direction, ticker?: string): Promise<Product[]>;
  getQuote(product: Product, amount: number): Promise<Quote>;
  getBalances(address?: Address): Promise<Record<string, number>>;
  getAllowance(symbol: string, owner?: Address): Promise<number>;
  approve(symbol: string, amount: number): Promise<TxResult>;
  subscribe(product: Product, amount: number, quote: Quote): Promise<TxResult>;
  getPositions(address?: Address): Promise<Position[]>;
  claim(positionId: string): Promise<TxResult>;
  /** Screens repaint on this after a write lands. */
  onChange(listener: () => void): () => void;
}
