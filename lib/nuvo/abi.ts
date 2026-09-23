import type { Direction } from "./types";

// The contract surface the app talks to: the factory registry and one pool per
// ticker. Edits belong here and in chain.ts, nowhere else.

/** On-chain direction enum. */
export const DirectionEnum = { BuyLow: 0, SellHigh: 1 } as const;

export const directionIndex = (direction: Direction) =>
  direction === "buyLow" ? DirectionEnum.BuyLow : DirectionEnum.SellHigh;

/** Why the pool will not take a subscription. It comes back as a number from preview. */
export const UnavailableCode = {
  Ok: 0,
  Paused: 1,
  NoExpiry: 2,
  BadPrice: 3,
  StalePrice: 4,
  NoPremium: 5,
  ZeroAmount: 6,
  BelowMin: 7,
  AboveMax: 8,
  ExpiryFull: 9,
  NoInventory: 10,
  TooMuchLocked: 11,
  BadDistance: 12,
} as const;

export const nuvoFactoryAbi = [
  {
    type: "function",
    name: "poolCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "pools",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "nextExpiry",
    stateMutability: "view",
    inputs: [{ name: "minLead", type: "uint64" }],
    outputs: [{ name: "", type: "uint64" }],
  },
] as const;

const previewOutput = {
  name: "",
  type: "tuple",
  components: [
    { name: "expiry", type: "uint64" },
    { name: "premiumBps", type: "uint16" },
    { name: "strikeWad", type: "uint256" },
    { name: "priceWad", type: "uint256" },
    { name: "priceUpdatedAt", type: "uint256" },
    { name: "ifConverted", type: "uint256" },
    { name: "ifNot", type: "uint256" },
    { name: "lockUsdg", type: "uint256" },
    { name: "lockToken", type: "uint256" },
    { name: "code", type: "uint8" },
  ],
} as const;

export const nuvoPoolAbi = [
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "usdg", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "feed", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  {
    type: "function",
    name: "preview",
    stateMutability: "view",
    inputs: [
      { name: "direction", type: "uint8" },
      { name: "distanceBps", type: "uint16" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [previewOutput],
  },
  {
    type: "function",
    name: "subscribe",
    stateMutability: "nonpayable",
    inputs: [
      { name: "direction", type: "uint8" },
      { name: "distanceBps", type: "uint16" },
      { name: "amount", type: "uint256" },
      { name: "limitStrikeWad", type: "uint256" },
      { name: "deadline", type: "uint64" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "positionsOf",
    stateMutability: "view",
    inputs: [{ name: "who", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "position",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "owner", type: "address" },
          { name: "direction", type: "uint8" },
          { name: "premiumBps", type: "uint16" },
          { name: "expiry", type: "uint64" },
          { name: "claimed", type: "bool" },
          { name: "deposit", type: "uint256" },
          { name: "strikeWad", type: "uint256" },
          { name: "lockUsdg", type: "uint256" },
          { name: "lockToken", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "positionPayout",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "settled", type: "bool" },
      { name: "converted", type: "bool" },
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  },
  // What the pool owes someone whose position was closed for them.
  {
    type: "function",
    name: "owed",
    stateMutability: "view",
    inputs: [
      { name: "who", type: "address" },
      { name: "asset", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "withdrawOwed",
    stateMutability: "nonpayable",
    inputs: [
      { name: "who", type: "address" },
      { name: "asset", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "settlePriceWad",
    stateMutability: "view",
    inputs: [{ name: "expiry", type: "uint64" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "addLiquidity",
    stateMutability: "nonpayable",
    inputs: [
      { name: "usdgIn", type: "uint256" },
      { name: "tokenIn", type: "uint256" },
      { name: "minShares", type: "uint256" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    type: "function",
    name: "removeLiquidity",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "minUsdgOut", type: "uint256" },
      { name: "minTokenOut", type: "uint256" },
    ],
    outputs: [
      { name: "usdgOut", type: "uint256" },
      { name: "tokenOut", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "totalShares",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "sharesOf",
    stateMutability: "view",
    inputs: [{ name: "who", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "poolValueWad",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "freeValueWad",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  { type: "function", name: "freeUsdg", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "freeToken", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  {
    type: "function",
    name: "priceWad",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "price", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
    ],
  },
  // The allowlist: while it is on, only the addresses on it may deposit or
  // subscribe. Reading it is how the screen says so instead of letting the
  // transaction fail.
  {
    type: "function",
    name: "allowlistOn",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowed",
    stateMutability: "view",
    inputs: [{ name: "who", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "maxPriceAgeSettle",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "pendingSettled",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  // The pool's own errors, so a failed transaction can say what happened
  // instead of "try again".
  { type: "error", name: "SettlementPending", inputs: [] },
  { type: "error", name: "InventoryLocked", inputs: [] },
  { type: "error", name: "StalePrice", inputs: [] },
  { type: "error", name: "BadPrice", inputs: [] },
  { type: "error", name: "Slippage", inputs: [] },
  { type: "error", name: "StrikeMoved", inputs: [] },
  { type: "error", name: "Expired", inputs: [] },
  { type: "error", name: "TooSmall", inputs: [] },
  { type: "error", name: "BadShares", inputs: [] },
  { type: "error", name: "Paused", inputs: [] },
  { type: "error", name: "NotSettled", inputs: [] },
  { type: "error", name: "AlreadyClaimed", inputs: [] },
  { type: "error", name: "NotYours", inputs: [] },
  { type: "error", name: "NothingOwed", inputs: [] },
  { type: "error", name: "NotOnList", inputs: [] },
  { type: "error", name: "Unavailable", inputs: [{ name: "code", type: "uint8" }] },
  {
    type: "event",
    name: "Subscribed",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "direction", type: "uint8", indexed: false },
      { name: "deposit", type: "uint256", indexed: false },
      { name: "strikeWad", type: "uint256", indexed: false },
      { name: "premiumBps", type: "uint16", indexed: false },
      { name: "expiry", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "asset", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "converted", type: "bool", indexed: false },
    ],
  },
] as const;

/** Minimal ERC-20 surface the app needs. */
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
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  // ERC-8056: how many shares one token stands for. A label on the screen only;
  // the feed already prices the token, so it never enters an amount.
  {
    type: "function",
    name: "uiMultiplier",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Chainlink AggregatorV3Interface — the reference the product settles on. */
export const aggregatorV3Abi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;
