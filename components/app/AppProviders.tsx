"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, lightTheme, useConnectModal } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { WagmiProvider, useAccount, useChainId, useDisconnect } from "wagmi";
import { MODE, NETWORK } from "@/lib/nuvo/config";
import { robinhoodChain, wagmiConfig } from "@/lib/wallet/config";

// The wallet the screens see. In chain mode it is wagmi; in mock mode it is a
// demo connection, so the whole path from brief 11.3 can be walked without a
// wallet extension installed.

const DEMO_ADDRESS = "0xD3f0A4C7b1F92E5d8a0b6C4e9F1a2B3c4D5e6F70";
const DEMO_KEY = "nuvo.mock.wallet";

type WalletState = {
  address?: string;
  isConnected: boolean;
  /** False when the wallet is on another network. Always true in mock mode. */
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
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const [demoConnected, setDemoConnected] = useState(false);

  useEffect(() => {
    if (MODE !== "mock") return;
    try {
      setDemoConnected(window.localStorage.getItem(DEMO_KEY) === "1");
    } catch {
      // Private windows just start disconnected.
    }
  }, []);

  const setDemo = useCallback((next: boolean) => {
    setDemoConnected(next);
    try {
      window.localStorage.setItem(DEMO_KEY, next ? "1" : "0");
    } catch {
      // Not worth failing the click over.
    }
  }, []);

  const value = useMemo<WalletState>(() => {
    if (MODE === "mock") {
      return {
        address: demoConnected ? DEMO_ADDRESS : undefined,
        isConnected: demoConnected,
        isRightNetwork: true,
        connect: () => setDemo(true),
        disconnect: () => setDemo(false),
        switchNetwork: () => {},
      };
    }
    return {
      address,
      isConnected,
      isRightNetwork: !isConnected || chainId === robinhoodChain.id,
      connect: () => openConnectModal?.(),
      disconnect: () => disconnect(),
      // TODO(stage 2): wagmi switchChain once the network parameters are in env.
      switchNetwork: () => openConnectModal?.(),
    };
  }, [address, chainId, demoConnected, disconnect, isConnected, openConnectModal, setDemo]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={lightTheme({ accentColor: "#222F30", borderRadius: "small" })}
          appInfo={{ appName: `Nuvo on ${NETWORK.name}` }}
        >
          <WalletBridge>{children}</WalletBridge>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
