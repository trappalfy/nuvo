// Brief 9: a draft of the contract interface, so the next stage matches the UI
// that already exists. Types and a draft ABI only — no contracts in this repo.
// When the contracts land, edits belong here and in chain.ts, nowhere else.
//
// interface INuvoDual {
//     enum Direction { BuyLow, SellHigh }
//     enum Status { Open, Locked, Settled }
//
//     function subscribe(bytes32 productId, uint256 amount, bytes calldata signedQuote)
//         external returns (uint256 positionId);
//     function claim(uint256 positionId) external returns (address token, uint256 amount);
//
//     function product(bytes32 productId) external view returns (
//         bytes32 ticker, Direction direction, uint256 targetPrice,
//         uint64 expiry, Status status, int256 settlePrice
//     );
//     function positionsOf(address user) external view returns (uint256[] memory);
//
//     event Subscribed(uint256 indexed positionId, address indexed user, bytes32 indexed productId,
//         uint256 amount, uint256 premiumBps);
//     event Settled(bytes32 indexed productId, int256 settlePrice, bool converted);
//     event Claimed(uint256 indexed positionId, address token, uint256 amount);
// }

/** On-chain direction enum. */
export const DirectionEnum = { BuyLow: 0, SellHigh: 1 } as const;

/** On-chain product status enum. */
export const StatusEnum = { Open: 0, Locked: 1, Settled: 2 } as const;

export type OnChainProduct = {
  ticker: `0x${string}`;
  direction: (typeof DirectionEnum)[keyof typeof DirectionEnum];
  targetPrice: bigint;
  expiry: bigint;
  status: (typeof StatusEnum)[keyof typeof StatusEnum];
  settlePrice: bigint;
};

/**
 * Draft. Not deployed, not verified, not audited — the shape the UI expects, so
 * the contract stage has something to converge on. `signedQuote` is the market
 * maker signature the quote service will issue; MockClient fakes it today.
 */
export const nuvoDualAbi = [
  {
    type: "function",
    name: "subscribe",
    stateMutability: "nonpayable",
    inputs: [
      { name: "productId", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "signedQuote", type: "bytes" },
    ],
    outputs: [{ name: "positionId", type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "positionId", type: "uint256" }],
    outputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "product",
    stateMutability: "view",
    inputs: [{ name: "productId", type: "bytes32" }],
    outputs: [
      { name: "ticker", type: "bytes32" },
      { name: "direction", type: "uint8" },
      { name: "targetPrice", type: "uint256" },
      { name: "expiry", type: "uint64" },
      { name: "status", type: "uint8" },
      { name: "settlePrice", type: "int256" },
    ],
  },
  {
    type: "function",
    name: "positionsOf",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "event",
    name: "Subscribed",
    inputs: [
      { name: "positionId", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "productId", type: "bytes32", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "premiumBps", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Settled",
    inputs: [
      { name: "productId", type: "bytes32", indexed: true },
      { name: "settlePrice", type: "int256", indexed: false },
      { name: "converted", type: "bool", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "positionId", type: "uint256", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

/** Minimal ERC-20 surface the app needs: balances, allowance, approve. */
export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  // ERC-8056: stock amounts are displayed through this multiplier.
  {
    type: "function",
    name: "uiMultiplier",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
