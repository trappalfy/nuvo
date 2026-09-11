"use client";

import { useMemo, useState } from "react";
import { DirectionToggle } from "@/components/app/DirectionToggle";
import { TargetChip } from "@/components/app/TargetChip";
import { usd } from "@/lib/format";
import { useNow, useNuvo, useWeek } from "@/lib/nuvo/useNuvo";
import type { Direction, Product } from "@/lib/nuvo/types";

// Brief 8: the ticker table with the ladder as chips. Cards under 1024.
export default function ProductsPage() {
  const [direction, setDirection] = useState<Direction>("buyLow");
  const [query, setQuery] = useState("");
  // Checked every 30s, so a page left open picks up the next week at Thursday's cutoff.
  const week = useWeek(useNow(30_000));
  const { data: products, loading } = useNuvo(
    (c) => c.listProducts(direction),
    [direction, week.id],
  );
  const { data: tickers } = useNuvo((c) => c.listTickers(), []);

  const names = useMemo(
    () => new Map((tickers ?? []).map((t) => [t.symbol, t.name] as const)),
    [tickers],
  );

  const rows = useMemo(() => {
    const bySymbol = new Map<string, Product[]>();
    for (const product of products ?? []) {
      const list = bySymbol.get(product.ticker) ?? [];
      list.push(product);
      bySymbol.set(product.ticker, list);
    }
    const term = query.trim().toUpperCase();
    return (tickers ?? [])
      .map((t) => ({ ticker: t.symbol, products: bySymbol.get(t.symbol) ?? [] }))
      .filter((row) => row.products.length > 0)
      .filter(
        (row) =>
          !term ||
          row.ticker.includes(term) ||
          (names.get(row.ticker) ?? "").toUpperCase().includes(term),
      );
  }, [names, products, query, tickers]);

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
          <label>
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
        <div className="hidden grid-cols-[180px_140px_1fr] items-center gap-[16px] border-b border-[#E4E6E2] px-[24px] py-[14px] t-mono-sm text-dim lg:grid">
          <span>Ticker</span>
          <span>Reference</span>
          <span>Targets for this week</span>
        </div>

        {loading && !products && (
          <div className="px-[24px] py-[32px] text-[16px] text-dim">Loading products…</div>
        )}

        {!loading && rows.length === 0 && (
          <div className="px-[24px] py-[40px]">
            {query ? (
              <p className="text-[16px] text-dim">No ticker matches “{query}”.</p>
            ) : (
              <>
                <p className="text-[18px] text-ink">No products are open right now.</p>
                <p className="mt-[8px] max-w-[520px] text-[15px] leading-[1.5] text-dim">
                  The ladder appears here as soon as prices for the week are published.
                </p>
              </>
            )}
          </div>
        )}

        {rows.map((row) => (
          <div
            key={row.ticker}
            className="border-b border-[#E4E6E2] px-[24px] py-[20px] last:border-b-0 lg:grid lg:grid-cols-[180px_140px_1fr] lg:items-center lg:gap-[16px]"
          >
            <div>
              <div className="text-[20px] leading-none tracking-[-0.02em] text-ink">{row.ticker}</div>
              {names.get(row.ticker) && names.get(row.ticker) !== row.ticker && (
                <div className="mt-[6px] text-[14px] text-dim">{names.get(row.ticker)}</div>
              )}
            </div>

            <div className="mt-[10px] text-[17px] tabular text-ink lg:mt-0">
              ${usd(row.products[0].reference.price)}
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
