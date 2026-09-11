"use client";

import Link from "next/link";
import { apr, pct, signedPct, usd } from "@/lib/format";
import type { Product } from "@/lib/nuvo/types";

// Brief 8: one rung of the ladder — the target and the premium for the week.
export function TargetChip({ product, className }: { product: Product; className?: string }) {
  const href = `/app/${product.ticker}?direction=${product.direction}&target=${Math.abs(product.targetOffset)}`;

  return (
    <Link
      href={href}
      className={[
        "group flex min-w-[152px] flex-1 flex-col gap-[6px] rounded-[8px] border border-[#E4E6E2] bg-page px-[14px] py-[12px] transition-colors duration-200 hover:border-ink hover:bg-white",
        className ?? "",
      ].join(" ")}
    >
      <span className="t-mono-sm text-dim">{signedPct(product.targetOffset)}</span>
      <span className="text-[18px] leading-none tabular text-ink">${usd(product.targetPrice)}</span>
      <span className="t-mono-sm text-lime-ink">
        {product.premiumBps !== undefined
          ? `${pct(product.premiumBps)} · est. ${apr(product.premiumBps)} APR`
          : "Premium quoted on entry"}
      </span>
    </Link>
  );
}
