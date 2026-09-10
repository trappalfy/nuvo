import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { defineChain } from "viem";
import { createConfig, http } from "wagmi";
import { NETWORK } from "../nuvo/config";

// Brief 2: wagmi + viem + RainbowKit. Brief: the default network is Robinhood
// Chain mainnet and every parameter comes from env — no testnets here.

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_ID ?? "";

export const robinhoodChain = defineChain({
  // The id is env-driven; 1 is only a placeholder so the config can be built
  // before the network parameters are filled in. Until then the app runs in mock.
  id: NETWORK.chainId || 1,
  name: NETWORK.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  // A chain with no RPC url leaves wagmi without a public client, and RainbowKit
  // crashes building its transaction store. Until env carries the real endpoint
  // this placeholder keeps the config constructible; mock mode never calls it.
  rpcUrls: { default: { http: [NETWORK.rpcUrl || "https://rpc.invalid"] } },
  ...(NETWORK.explorerUrl
    ? { blockExplorers: { default: { name: "Explorer", url: NETWORK.explorerUrl } } }
    : {}),
});

// RainbowKit needs connectors built through its own factory — plain wagmi
// connectors have no wallet metadata and its modal falls over on them. The
// WalletConnect-backed wallets only appear once a project id is configured.
const connectors = connectorsForWallets(
  [
    {
      groupName: "Wallets",
      wallets: projectId
        ? [injectedWallet, metaMaskWallet, rainbowWallet, walletConnectWallet]
        : [injectedWallet],
    },
  ],
  { appName: "Nuvo", projectId: projectId || "nuvo-local" },
);

export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  connectors,
  transports: { [robinhoodChain.id]: http(NETWORK.rpcUrl || undefined) },
  ssr: true,
});

export const shortAddress = (address?: string) =>
  address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
