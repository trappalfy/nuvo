"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, lightTheme, useConnectModal } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo } from "react";
import type { WalletClient } from "viem";
import { WagmiProvider, useAccount, useDisconnect, useSwitchChain, useWalletClient } from "wagmi";
import { NETWORK, hasNetwork } from "@/lib/nuvo/config";
import type { Address } from "@/lib/nuvo/types";
import { client } from "@/lib/nuvo/useNuvo";
import { nuvoChain } from "@/lib/wallet/chain";
import { wagmiConfig } from "@/lib/wallet/config";

// The wallet the screens see: the account connected through RainbowKit, and
// whether it sits on the network the contracts live on.

type WalletState = {
  address?: Address;
  isConnected: boolean;
  isRightNetwork: boolean;
  connect: () => void;
  disconnect: () => void;
  switchNetwork: () => void;
};

const WalletContext = createContext<WalletState | null>(null);

export function useWallet() {
  const state = useContext(WalletContext);
  if (!state) throw new Error("useWallet outside AppProviders");
  return state;
}

const queryClient = new QueryClient();

function WalletBridge({ children }: { children: React.ReactNode }) {
  const { openConnectModal } = useConnectModal();
  const { address, isConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { data: walletClient } = useWalletClient();

  // The data layer signs with whatever wallet is connected right now.
  useEffect(() => {
    client.setWallet((walletClient as WalletClient | undefined) ?? null, address);
  }, [walletClient, address]);

  const isRightNetwork = !isConnected || !hasNetwork() || chainId === NETWORK.chainId;

  const value = useMemo<WalletState>(
    () => ({
      address,
      isConnected,
      isRightNetwork,
      connect: () => openConnectModal?.(),
      disconnect: () => disconnect(),
      switchNetwork: () => switchChain({ chainId: nuvoChain.id }),
    }),
    [address, disconnect, isConnected, isRightNetwork, openConnectModal, switchChain],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={lightTheme({ accentColor: "#222F30", borderRadius: "small" })}
          appInfo={{ appName: "Nuvo" }}
          initialChain={nuvoChain}
          // The app is in English; without this the modal follows the browser locale.
          locale="en-US"
        >
          <WalletBridge>{children}</WalletBridge>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
