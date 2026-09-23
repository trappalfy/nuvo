#!/usr/bin/env node
// Settles every expiry that is due, in every pool the factory knows about.
//
// A week that is not settled cannot be claimed, and deposits and withdrawals
// to the pool stay shut while a settled week is still unclaimed. So this runs
// shortly after Friday's close, and its exit code is the alarm: 0 means
// nothing is owed the chain, 1 means a week is still waiting.
//
// Usage:
//   RPC_URL=… FACTORY_ADDRESS=0x… node settle.mjs --dry-run
//   RPC_URL=… FACTORY_ADDRESS=0x… PRIVATE_KEY=0x… node settle.mjs
//
// Reads viem from the site's node_modules — this adds no dependency of its own.

import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const factoryAbi = [
  { type: "function", name: "poolCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pools", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "expiryCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "expiries", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint64" }] },
];

const poolAbi = [
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "feed", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "openAt", stateMutability: "view", inputs: [{ type: "uint64" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pendingSettled", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "settlePriceWad", stateMutability: "view", inputs: [{ type: "uint64" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "settle", stateMutability: "nonpayable", inputs: [{ type: "uint64" }], outputs: [] },
  { type: "function", name: "settleWithRound", stateMutability: "nonpayable", inputs: [{ type: "uint64" }, { type: "uint80" }], outputs: [] },
  {
    type: "function",
    name: "findSettleRound",
    stateMutability: "view",
    inputs: [{ type: "uint64" }, { type: "uint80" }, { type: "uint16" }],
    outputs: [{ type: "uint80" }, { type: "bool" }],
  },
];

const feedAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }],
  },
];

const ERC20_SYMBOL = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
];

/** How far back findSettleRound may walk. One round per heartbeat, so this is generous. */
const MAX_STEPS = 128;

function env(name, required = true) {
  const value = process.env[name];
  if (!value && required) {
    console.error(`missing ${name}`);
    process.exit(2);
  }
  return value;
}

const dryRun = process.argv.includes("--dry-run");
const rpcUrl = env("RPC_URL");
const factory = env("FACTORY_ADDRESS");
const privateKey = env("PRIVATE_KEY", !dryRun);

const chain = defineChain({
  id: Number(process.env.CHAIN_ID ?? 0) || undefined,
  name: "settlement target",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});

const pub = createPublicClient({ transport: http(rpcUrl) });
const account = privateKey ? privateKeyToAccount(privateKey) : undefined;
const wallet = account
  ? createWalletClient({ account, chain: { ...chain, id: await pub.getChainId() }, transport: http(rpcUrl) })
  : undefined;

const read = (address, abi, functionName, args) => pub.readContract({ address, abi, functionName, args });

async function send(address, functionName, args) {
  // Simulate first: a refusal is information, not a wasted transaction.
  const { request } = await pub.simulateContract({ address, abi: poolAbi, functionName, args, account });
  const hash = await wallet.writeContract(request);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`reverted on chain: ${hash}`);
  // What it cost, so the key's balance can be kept ahead of the year.
  const spent = receipt.gasUsed * receipt.effectiveGasPrice;
  console.log(`    gas ${receipt.gasUsed} at ${receipt.effectiveGasPrice} wei = ${spent} wei`);
  return hash;
}

/** One expiry in one pool. Returns "settled" | "skipped" | "stuck". */
async function settleOne(pool, symbol, expiry) {
  if ((await read(pool, poolAbi, "settlePriceWad", [expiry])) !== 0n) return "skipped";
  if ((await read(pool, poolAbi, "openAt", [expiry])) === 0n) return "skipped";

  const label = `${symbol} ${new Date(Number(expiry) * 1000).toISOString()}`;

  // The normal path: the round in effect at the bell is still the latest one.
  try {
    await pub.simulateContract({ address: pool, abi: poolAbi, functionName: "settle", args: [expiry], account });
    if (dryRun) {
      console.log(`  ${label}: would settle()`);
      return "settled";
    }
    console.log(`  ${label}: settle() → ${await send(pool, "settle", [expiry])}`);
    return "settled";
  } catch {
    // The feed has moved on. Find the round that was in effect and name it.
  }

  const feed = await read(pool, poolAbi, "feed");
  const [latestRound] = await read(feed, feedAbi, "latestRoundData");
  const [round, found] = await read(pool, poolAbi, "findSettleRound", [expiry, latestRound, MAX_STEPS]);
  if (!found) {
    console.error(`  ${label}: STUCK — no round found within ${MAX_STEPS} steps of ${latestRound}`);
    return "stuck";
  }

  try {
    await pub.simulateContract({
      address: pool,
      abi: poolAbi,
      functionName: "settleWithRound",
      args: [expiry, round],
      account,
    });
  } catch (e) {
    console.error(`  ${label}: STUCK — round ${round} refused: ${e.shortMessage ?? e.message}`);
    return "stuck";
  }

  if (dryRun) {
    console.log(`  ${label}: would settleWithRound(${round})`);
    return "settled";
  }
  console.log(`  ${label}: settleWithRound(${round}) → ${await send(pool, "settleWithRound", [expiry, round])}`);
  return "settled";
}

// The chain's clock, not this machine's: the contract decides what is due by
// block.timestamp, and a host whose clock drifts would skip a week or chase one
// that has not closed yet.
const now = (await pub.getBlock()).timestamp;
const poolCount = await read(factory, factoryAbi, "poolCount");
const expiryCount = await read(factory, factoryAbi, "expiryCount");

const expiries = [];
for (let i = 0n; i < expiryCount; i++) {
  const expiry = await read(factory, factoryAbi, "expiries", [i]);
  if (expiry <= now) expiries.push(expiry);
}

console.log(
  `${dryRun ? "dry run: " : ""}${poolCount} pool(s), ${expiries.length} expiry(ies) past due, as ${account?.address ?? "reader"}`,
);

let settled = 0;
let stuck = 0;
let unclaimed = 0;

for (let i = 0n; i < poolCount; i++) {
  const pool = await read(factory, factoryAbi, "pools", [i]);
  const token = await read(pool, poolAbi, "token");
  const symbol = await read(token, ERC20_SYMBOL, "symbol");
  console.log(`${symbol} pool ${pool}`);

  for (const expiry of expiries) {
    const outcome = await settleOne(pool, symbol, expiry);
    if (outcome === "settled") settled++;
    if (outcome === "stuck") stuck++;
  }

  // Deposits and withdrawals stay shut until a settled week is claimed out.
  const pending = await read(pool, poolAbi, "pendingSettled");
  if (pending !== 0n) {
    unclaimed += Number(pending);
    console.log(`  ${pending} settled position(s) still unclaimed — liquidity is closed until they are`);
  }
}

console.log(`done: ${settled} settled, ${stuck} stuck, ${unclaimed} awaiting claim`);
process.exit(stuck > 0 ? 1 : 0);
