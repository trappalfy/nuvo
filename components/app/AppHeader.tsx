"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usd } from "@/lib/format";
import { MODE, USDG } from "@/lib/nuvo/config";
import { useNuvo } from "@/lib/nuvo/useNuvo";
import { shortAddress } from "@/lib/wallet/config";
import { Lockup } from "../ui/Mark";
import { useWallet } from "./AppProviders";

const NAV = [
  { label: "Products", href: "/app" },
  { label: "Positions", href: "/app/positions" },
];

// Brief 8: the app header. Lockup back to the site, two sections, wallet on the
// right, and the `Demo data` plate while the client is the mock.
export function AppHeader() {
  const pathname = usePathname();
  const wallet = useWallet();
  const { data: balances } = useNuvo((c) => c.getBalances(), [wallet.address]);

  return (
    <header className="sticky top-0 z-40 border-b border-[#E4E6E2] bg-page/90 backdrop-blur-md">
      <div className="container-nuvo flex h-[64px] items-center justify-between gap-[12px] sm:h-[72px]">
        <div className="flex items-center gap-[28px]">
          <Link href="/" className="inline-flex text-ink" aria-label="Nuvo, home">
            <Lockup />
          </Link>
          {/* Under 640 the sections move to their own row, so nothing is cut off. */}
          <nav className="hidden items-center gap-[2px] sm:flex">
            {NAV.map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} pathname={pathname} />
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-[10px]">
          {MODE === "mock" && (
            <span className="hidden h-[38px] items-center gap-[8px] rounded-[6px] bg-nav px-[12px] t-mono-sm text-ink sm:inline-flex">
              <span className="block size-[8px] bg-lime-ink" aria-hidden="true" />
              Demo data
            </span>
          )}

          {!wallet.isConnected ? (
            <button
              type="button"
              onClick={wallet.connect}
              className="inline-flex h-[44px] items-center rounded-[8px] bg-ink px-[18px] t-mono text-white transition-colors duration-200 hover:bg-ink-hover"
            >
              Connect wallet
            </button>
          ) : !wallet.isRightNetwork ? (
            <button
              type="button"
              onClick={wallet.switchNetwork}
              className="inline-flex h-[44px] items-center rounded-[8px] bg-[#3A2422] px-[18px] t-mono text-white"
            >
              Switch network
            </button>
          ) : (
            <div className="flex items-center gap-[8px]">
              <span className="hidden h-[44px] items-center rounded-[8px] border border-[#E4E6E2] bg-white px-[14px] t-mono tabular text-ink sm:inline-flex">
                {usd(balances?.[USDG.symbol] ?? 0)} {USDG.symbol}
              </span>
              <button
                type="button"
                onClick={wallet.disconnect}
                title="Disconnect"
                className="inline-flex h-[44px] items-center rounded-[8px] bg-nav px-[14px] t-mono text-ink transition-colors duration-200 hover:bg-nav-hover"
              >
                {shortAddress(wallet.address)}
              </button>
            </div>
          )}
        </div>
      </div>

      <nav className="container-nuvo flex items-center gap-[2px] pb-[10px] sm:hidden">
        {NAV.map((item) => (
          <NavLink key={item.href} href={item.href} label={item.label} pathname={pathname} />
        ))}
      </nav>
    </header>
  );
}

function NavLink({
  href,
  label,
  pathname,
}: {
  href: string;
  label: string;
  pathname: string;
}) {
  const active = href === "/app" ? pathname === "/app" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={[
        "inline-flex h-[38px] items-center rounded-[6px] px-[14px] t-mono transition-colors duration-200",
        active ? "bg-nav text-ink" : "text-dim hover:bg-nav/60 hover:text-ink",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}
