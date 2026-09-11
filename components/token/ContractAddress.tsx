"use client";

import { useEffect, useState } from "react";
import { SplitButton } from "@/components/ui/SplitButton";
import { TOKEN, tokenUrl } from "@/lib/nuvo/config";

// The official contract address, with copy and a link out. Before launch both
// buttons stay disabled and the card says the address is not out yet.
export function ContractAddress({ className }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  const address = TOKEN.address;
  const url = tokenUrl();

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      // Clipboard blocked: the address is still selectable on the page.
    }
  };

  return (
    <section
      aria-labelledby="contract-address"
      className={`rounded-[16px] bg-white p-[24px] sm:p-[32px] ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-[12px]">
        <h2 id="contract-address" className="t-mono-sm text-dim">
          Contract address
        </h2>
        <span className="t-mono-sm text-dim">
          {TOKEN.symbol ? `$${TOKEN.symbol} · ` : ""}
          {TOKEN.network}
        </span>
      </div>

      <div className="mt-[20px] border-t border-[#E4E6E2] pt-[24px]">
        {address ? (
          <p className="break-all font-mono text-[clamp(16px,1.2vw+8px,26px)] leading-[1.35] text-ink select-all">
            {address}
          </p>
        ) : (
          <>
            <p className="text-[26px] leading-none tracking-[-0.03em] text-ink">Not launched yet</p>
            <p className="mt-[12px] max-w-[560px] text-[16px] leading-[1.5] text-dim">
              The address will be published here at launch. Until then, any token that calls
              itself Nuvo is not ours.
            </p>
          </>
        )}
      </div>

      <div className="mt-[28px] flex flex-col gap-[12px] lg:flex-row lg:items-center">
        <SplitButton href={url} external label="View contract" disabled={!url} full="mobile" />
        <button
          type="button"
          onClick={copy}
          disabled={!address}
          className="inline-flex h-12 w-full items-center justify-center rounded-[8px] bg-nav px-[24px] t-mono text-ink transition-colors duration-200 hover:bg-nav-hover disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto"
        >
          <span aria-live="polite">{copied ? "Copied" : "Copy address"}</span>
        </button>
      </div>
    </section>
  );
}
