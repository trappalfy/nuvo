import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { NETWORK, SITE_URL } from "../nuvo/config";
import { nuvoChain } from "./chain";

// Brief 2: wagmi + viem + RainbowKit, on the network from env.

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_ID ?? "";

// RainbowKit needs connectors built through its own factory. Browser wallets
// that announce themselves (EIP-6963: MetaMask, Rabby, Coinbase, …) are
// discovered on top of this list; WalletConnect for mobile wallets appears once
// a project id is configured.
const connectors = connectorsForWallets(
  [
    {
      groupName: "Wallets",
      wallets: projectId
        ? [metaMaskWallet, rainbowWallet, walletConnectWallet, injectedWallet]
        : [injectedWallet],
    },
  ],
  {
    appName: "Nuvo",
    appDescription: "Dual investment on tokenized stocks.",
    projectId: projectId || "nuvo",
    // Mobile wallets show this name, link and icon when they connect over WalletConnect.
    ...(SITE_URL ? { appUrl: SITE_URL, appIcon: `${SITE_URL}/brand/nuvo-icon-512.png` } : {}),
  },
);

export const wagmiConfig = createConfig({
  chains: [nuvoChain],
  connectors,
  transports: { [nuvoChain.id]: http(NETWORK.rpcUrl || undefined) },
  ssr: true,
});

export const shortAddress = (address?: string) =>
  address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
