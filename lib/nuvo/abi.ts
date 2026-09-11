import { keccak256, encodePacked } from "viem";
import type { Direction } from "./types";

// The contract surface the app talks to. The contracts are not deployed yet, so
// this is the agreed shape: the UI is written against it, and the contract stage
// has to match it. Edits belong here and in chain.ts, nowhere else.

/** On-chain direction enum. */
export const DirectionEnum = { BuyLow: 0, SellHigh: 1 } as const;

/** On-chain product status enum. */
export const StatusEnum = { Open: 0, Locked: 1, Settled: 2 } as const;

/** On-chain position status enum. */
export const PositionStatusEnum = { Open: 0, Settled: 1, Claimed: 2 } as const;

export const directionIndex = (direction: Direction) =>
  direction === "buyLow" ? DirectionEnum.BuyLow : DirectionEnum.SellHigh;

/**
 * How a product id is derived. The app builds ids locally so the ladder can be
 * rendered before any of it is touched on chain; the contract must derive them
 * the same way or `product(productId)` will miss.
 *
 * keccak256(abi.encodePacked(weekId, ticker, direction, targetBps))
 *
 * weekId is the ISO date of the Monday in ET ("2026-09-14"), targetBps is the
 * distance from the reference in basis points (200 for 2%).
 */
export const productId = (weekId: string, ticker: string, direction: Direction, targetBps: number) =>
  keccak256(
    encodePacked(
      ["string", "string", "uint8", "uint16"],
      [weekId, ticker, directionIndex(direction), targetBps],
    ),
  );

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
  // Added for the app: positionsOf gives ids, the screens need the position
  // itself, and the payout has to be readable before Claim is pressed.
  {
    type: "function",
    name: "position",
    stateMutability: "view",
    inputs: [{ name: "positionId", type: "uint256" }],
    outputs: [
      { name: "user", type: "address" },
      { name: "productId", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "premiumBps", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "depositToken", type: "address" },
      { name: "payoutToken", type: "address" },
      { name: "payoutAmount", type: "uint256" },
      { name: "subscribedAt", type: "uint64" },
    ],
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
  // ERC-8056: stock amounts are displayed through this multiplier.
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
