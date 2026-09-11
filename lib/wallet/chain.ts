import { defineChain } from "viem";
import { NETWORK } from "../nuvo/config";

// The viem chain, on its own so the data layer can use it without pulling in
// wagmi or RainbowKit.
export const nuvoChain = defineChain({
  id: NETWORK.chainId || 1,
  name: NETWORK.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  // wagmi needs an RPC url to build its clients, and RainbowKit crashes without
  // one. Until NEXT_PUBLIC_RPC_URL is set this keeps the config constructible;
  // the data layer only creates a client once the real endpoint is configured.
  rpcUrls: { default: { http: [NETWORK.rpcUrl || "https://rpc.invalid"] } },
  ...(NETWORK.explorerUrl
    ? { blockExplorers: { default: { name: "Explorer", url: NETWORK.explorerUrl } } }
    : {}),
});
