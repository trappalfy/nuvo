"use client";

import { useMemo, useState } from "react";
import { DirectionToggle } from "@/components/app/DirectionToggle";
import { TargetChip } from "@/components/app/TargetChip";
import { usd } from "@/lib/format";
import { TICKERS, tickerOf } from "@/lib/nuvo/config";
import { useNuvo } from "@/lib/nuvo/useNuvo";
import type { Direction, Product } from "@/lib/nuvo/types";

// Brief 8: the ticker table with the ladder as chips. Cards under 1024.
export default function ProductsPage() {
  const [direction, setDirection] = useState<Direction>("buyLow");
  const [query, setQuery] = useState("");
  const { data: products, loading } = useNuvo((c) => c.listProducts(direction), [direction]);

  const rows = useMemo(() => {
    const bySymbol = new Map<string, Product[]>();
    for (const product of products ?? []) {
      const list = bySymbol.get(product.ticker) ?? [];
      list.push(product);
      bySymbol.set(product.ticker, list);
    }
    const term = query.trim().toUpperCase();
    return TICKERS.filter((t) => !term || t.symbol.includes(term) || t.name.toUpperCase().includes(term))
      .map((t) => ({ ticker: t.symbol, products: bySymbol.get(t.symbol) ?? [] }))
      .filter((row) => row.products.length > 0);
  }, [products, query]);

  return (
    <div>
      <div className="flex flex-col gap-[20px] lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-[40px] leading-none tracking-[-0.03em] text-ink">Products</h1>
          <p className="mt-[12px] max-w-[560px] text-[16px] leading-[1.5] text-dim">
            {direction === "buyLow"
              ? "Deposit USDG and name a price under the market. The premium is paid either way."
              : "Deposit your stock and name a price above the market. The premium is paid either way."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-[12px]">
          <DirectionToggle value={direction} onChange={setDirection} />
          <label className="relative">
            <span className="sr-only">Search ticker</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ticker"
              className="h-[48px] w-[200px] rounded-[8px] border border-[#E4E6E2] bg-white px-[14px] t-mono text-ink placeholder:text-dim"
            />
          </label>
        </div>
      </div>

      <div className="mt-[28px] overflow-hidden rounded-[16px] bg-white">
        <div className="hidden grid-cols-[160px_140px_1fr] items-center gap-[16px] border-b border-[#E4E6E2] px-[24px] py-[14px] t-mono-sm text-dim lg:grid">
          <span>Ticker</span>
          <span>Reference</span>
          <span>Targets for this week</span>
        </div>

        {loading && (
          <div className="px-[24px] py-[32px] text-[16px] text-dim">Loading products…</div>
        )}

        {!loading && rows.length === 0 && (
          <div className="px-[24px] py-[32px] text-[16px] text-dim">
            No ticker matches “{query}”.
          </div>
        )}

        {rows.map((row) => (
          <div
            key={row.ticker}
            className="border-b border-[#E4E6E2] px-[24px] py-[20px] last:border-b-0 lg:grid lg:grid-cols-[160px_140px_1fr] lg:items-center lg:gap-[16px]"
          >
            <div>
              <div className="text-[20px] leading-none tracking-[-0.02em] text-ink">{row.ticker}</div>
              <div className="mt-[6px] text-[14px] text-dim">{tickerOf(row.ticker)?.name}</div>
            </div>

            <div className="mt-[10px] tabular text-[17px] text-ink lg:mt-0">
              ${usd(row.products[0].referencePrice)}
            </div>

            <div className="mt-[16px] flex flex-wrap gap-[10px] lg:mt-0">
              {row.products.map((product) => (
                <TargetChip key={product.id} product={product} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-[16px] t-mono-sm text-dim">
        Settlement uses the Chainlink reference at Friday’s close, not the pool price.
      </p>
    </div>
  );
}
