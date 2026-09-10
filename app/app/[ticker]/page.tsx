"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useEffect, useMemo, useState } from "react";
import { PriceChart } from "@/components/app/PriceChart";
import { DirectionToggle } from "@/components/app/DirectionToggle";
import { useWallet } from "@/components/app/AppProviders";
import { useToast } from "@/components/app/Toaster";
import { amountOf, apr, pct, qty, signedPct, usd } from "@/lib/format";
import { LIMITS, MODE, USDG, explorerTx, tickerOf } from "@/lib/nuvo/config";
import { client, useNow, useNuvo } from "@/lib/nuvo/useNuvo";
import type { Direction, Product, Quote } from "@/lib/nuvo/types";

type DemoOutcome = "success" | "rejected" | "failed";

export default function TickerPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  return (
    <Suspense fallback={<div className="py-[48px] text-[16px] text-dim">Loading…</div>}>
      <Subscribe symbol={ticker.toUpperCase()} />
    </Suspense>
  );
}

function Subscribe({ symbol }: { symbol: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const wallet = useWallet();
  const toast = useToast();
  const now = useNow();

  const direction = (search.get("direction") === "sellHigh" ? "sellHigh" : "buyLow") as Direction;
  const step = Number(search.get("target") ?? 2);

  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | undefined>(undefined);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [pending, setPending] = useState<"approve" | "subscribe" | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [demoOutcome, setDemoOutcome] = useState<DemoOutcome>("success");

  const { data: week } = useNuvo((c) => c.getWeek(), []);
  const { data: products } = useNuvo((c) => c.listProducts(direction, symbol), [direction, symbol]);
  const { data: balances } = useNuvo((c) => c.getBalances(), [wallet.address]);

  const product = useMemo(
    () => products?.find((p) => Math.abs(p.targetOffset) === Math.abs(step)) ?? products?.[0],
    [products, step],
  );

  const depositToken = direction === "buyLow" ? USDG.symbol : symbol;
  const balance = balances?.[depositToken] ?? 0;
  const amountNumber = Number(amount) || 0;

  const { data: allowance } = useNuvo(
    (c) => c.getAllowance(depositToken, amountNumber),
    [depositToken, amountNumber, pending],
  );

  const minimum =
    direction === "buyLow"
      ? LIMITS.minUsdg
      : Number((LIMITS.minStockValueUsdg / (product?.referencePrice ?? 1)).toFixed(4));

  // Brief 8: the outcome numbers move as the amount is typed, so they are
  // computed locally from the same premium the quote is signed for.
  const outcomes = useMemo(() => {
    if (!product) return undefined;
    const r = product.premiumBps / 10_000;
    return direction === "buyLow"
      ? {
          converted: { token: symbol, amount: (amountNumber * (1 + r)) / product.targetPrice },
          kept: { token: USDG.symbol, amount: amountNumber * (1 + r) },
        }
      : {
          converted: { token: USDG.symbol, amount: amountNumber * product.targetPrice * (1 + r) },
          kept: { token: symbol, amount: amountNumber * (1 + r) },
        };
  }, [amountNumber, direction, product, symbol]);

  // Quotes are fetched for a valid amount and go stale after 30s.
  useEffect(() => {
    if (!product || amountNumber <= 0) {
      setQuote(undefined);
      return;
    }
    let alive = true;
    setQuoteLoading(true);
    const id = setTimeout(() => {
      client
        .getQuote(product.id, amountNumber)
        .then((q) => alive && setQuote(q))
        .catch(() => alive && setQuote(undefined))
        .finally(() => alive && setQuoteLoading(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [amountNumber, product]);

  const staleQuote = !!quote && now > quote.expiresAt;

  const setParams = (next: { direction?: Direction; target?: number }) => {
    const params = new URLSearchParams(search.toString());
    if (next.direction) params.set("direction", next.direction);
    if (next.target) params.set("target", String(next.target));
    router.replace(`?${params.toString()}`, { scroll: false });
    setQuote(undefined);
    setError(undefined);
  };

  const refreshQuote = () => {
    if (!product || amountNumber <= 0) return;
    setQuoteLoading(true);
    client
      .getQuote(product.id, amountNumber)
      .then(setQuote)
      .finally(() => setQuoteLoading(false));
  };

  const runDemoOutcome = async () => {
    if (MODE !== "mock" || demoOutcome === "success") return;
    await new Promise((r) => setTimeout(r, 800));
    throw new Error(
      demoOutcome === "rejected"
        ? "Transaction rejected in wallet"
        : "Transaction failed. Try again.",
    );
  };

  const onApprove = async () => {
    if (!product) return;
    setError(undefined);
    setPending("approve");
    try {
      await runDemoOutcome();
      const tx = await client.approve(depositToken, amountNumber);
      toast({
        title: `${depositToken} approved`,
        tone: "success",
        href: explorerTx(tx.hash),
        linkLabel: "Explorer",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Transaction failed. Try again.";
      setError(message);
      toast({ title: message, tone: "error" });
    } finally {
      setPending(null);
    }
  };

  const onSubscribe = async () => {
    if (!product || !quote) return;
    setError(undefined);
    setPending("subscribe");
    try {
      await runDemoOutcome();
      const tx = await client.subscribe(product.id, amountNumber, quote);
      toast({
        title: "Subscribed",
        tone: "success",
        href: explorerTx(tx.hash),
        linkLabel: "Explorer",
      });
      setAmount("");
      setQuote(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Transaction failed. Try again.";
      setError(message);
      toast({ title: message, tone: "error" });
    } finally {
      setPending(null);
    }
  };

  // Brief 8: every state of the subscribe button, in order of precedence.
  const action = (() => {
    if (week && !week.isOpen)
      return { label: "Subscriptions are closed. Next week opens Monday.", disabled: true };
    if (!wallet.isConnected) return { label: "Connect wallet", onClick: wallet.connect };
    if (!wallet.isRightNetwork) return { label: "Switch network", onClick: wallet.switchNetwork };
    if (pending === "approve") return { label: "Confirming…", disabled: true };
    if (pending === "subscribe") return { label: "Confirming…", disabled: true };
    if (amountNumber <= 0) return { label: "Enter an amount", disabled: true };
    if (amountNumber > balance)
      return { label: `Not enough ${depositToken} in your wallet`, disabled: true };
    if (amountNumber < minimum)
      return { label: `Minimum ${amountOf(depositToken, minimum)}`, disabled: true };
    if ((allowance ?? 0) < amountNumber)
      return { label: `Approve ${depositToken}`, onClick: onApprove };
    if (quoteLoading) return { label: "Fetching quote…", disabled: true };
    if (!quote || staleQuote) return { label: "Refresh quote", onClick: refreshQuote };
    return { label: "Subscribe", onClick: onSubscribe };
  })();

  if (!product) {
    return (
      <div className="py-[48px]">
        <p className="text-[18px] text-dim">No products for {symbol} this week.</p>
        <Link href="/app" className="t-mono mt-[16px] inline-flex text-ink hover:underline">
          Back to products
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link href="/app" className="t-mono-sm inline-flex text-dim hover:text-ink">
        ← Products
      </Link>

      <div className="mt-[20px] grid gap-[24px] lg:grid-cols-[1fr_400px] lg:items-start">
        <div className="flex flex-col gap-[16px]">
          <section className="rounded-[16px] bg-white p-[24px]">
            <div className="flex flex-wrap items-end justify-between gap-[16px]">
              <div>
                <h1 className="text-[32px] leading-none tracking-[-0.03em] text-ink">{symbol}</h1>
                <p className="mt-[8px] text-[15px] text-dim">{tickerOf(symbol)?.name}</p>
              </div>
              <div className="text-right">
                <div className="t-mono-sm text-dim">Chainlink reference</div>
                <div className="mt-[8px] text-[28px] leading-none tabular text-ink">
                  ${usd(product.referencePrice)}
                </div>
              </div>
            </div>

            <div className="mt-[24px]">
              <PriceChart
                ticker={symbol}
                reference={product.referencePrice}
                target={product.targetPrice}
              />
            </div>
          </section>

          <section className="rounded-[16px] bg-white p-[24px]">
            <h2 className="t-mono-sm text-dim">At settlement</h2>
            <dl className="mt-[16px] flex flex-col">
              <Outcome
                label={
                  direction === "buyLow"
                    ? `If Friday closes at or below $${usd(product.targetPrice)}`
                    : `If Friday closes at or above $${usd(product.targetPrice)}`
                }
                value={
                  outcomes && amountNumber > 0
                    ? amountOf(outcomes.converted.token, outcomes.converted.amount)
                    : "—"
                }
                accent
              />
              <Outcome
                label={direction === "buyLow" ? "If it closes above" : "If it closes below"}
                value={
                  outcomes && amountNumber > 0
                    ? amountOf(outcomes.kept.token, outcomes.kept.amount)
                    : "—"
                }
              />
            </dl>
            <p className="mt-[16px] text-[14px] leading-[1.5] text-dim">
              The premium of {pct(product.premiumBps)} for the week is fixed when you subscribe and
              is paid in both outcomes. Only the asset you receive changes.
            </p>
          </section>

          <section className="rounded-[16px] bg-white p-[24px]">
            <h2 className="t-mono-sm text-dim">Rules</h2>
            <ul className="mt-[16px] flex flex-col gap-[12px] text-[16px] leading-[1.5] text-ink">
              <li>Settlement uses the Chainlink reference at Friday’s close, not the pool price.</li>
              <li>Your deposit is locked until settlement. There is no early exit.</li>
              <li>
                Subscriptions run from Monday’s open to Thursday 4:00 PM ET. Expiry is Friday 4:00
                PM ET.
              </li>
            </ul>
          </section>

          <section className="rounded-[16px] border border-[#E4D9C9] bg-[#FAF6F0] p-[24px]">
            <h2 className="t-mono-sm text-dim">Risk</h2>
            <p className="mt-[16px] text-[16px] leading-[1.5] text-ink">
              {direction === "buyLow"
                ? `If ${symbol} closes at or below your price you receive the stock at that price, which can be above the market at the time of settlement. The premium does not cover a fall beyond it.`
                : `If ${symbol} closes at or above your price your stock is sold at that price, so any move past it is not yours. The premium does not replace that upside.`}{" "}
              <Link href="/risk" className="underline underline-offset-4">
                Read the risk disclosure
              </Link>
              .
            </p>
          </section>
        </div>

        <aside className="rounded-[16px] bg-white p-[24px] lg:sticky lg:top-[140px]">
          <DirectionToggle
            value={direction}
            onChange={(next) => setParams({ direction: next })}
            className="w-full"
          />

          <div className="mt-[24px]">
            <h2 className="t-mono-sm text-dim">Target price</h2>
            <div className="mt-[12px] grid grid-cols-2 gap-[8px]">
              {products?.map((p: Product) => {
                const active = p.id === product.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setParams({ target: Math.abs(p.targetOffset) })}
                    className={[
                      "flex flex-col gap-[6px] rounded-[8px] border px-[12px] py-[10px] text-left transition-colors duration-200",
                      active
                        ? "border-ink bg-page"
                        : "border-[#E4E6E2] hover:border-ink/40",
                    ].join(" ")}
                  >
                    <span className="t-mono-sm text-dim">{signedPct(p.targetOffset)}</span>
                    <span className="text-[17px] leading-none tabular text-ink">
                      ${usd(p.targetPrice)}
                    </span>
                    <span className="t-mono-sm text-lime-ink">{pct(p.premiumBps)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-[24px]">
            <div className="flex items-baseline justify-between">
              <h2 className="t-mono-sm text-dim">
                {direction === "buyLow" ? "You deposit" : `You deposit ${symbol}`}
              </h2>
              <span className="t-mono-sm tabular text-dim">
                Balance {direction === "buyLow" ? usd(balance) : qty(symbol, balance)}
              </span>
            </div>
            <div className="mt-[10px] flex items-center gap-[8px] rounded-[8px] border border-[#E4E6E2] px-[14px] focus-within:border-ink">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.00"
                aria-label={`Amount in ${depositToken}`}
                className="h-[52px] w-full bg-transparent text-[20px] tabular text-ink outline-none placeholder:text-dim"
              />
              <span className="t-mono-sm text-dim">{depositToken}</span>
              <button
                type="button"
                onClick={() => setAmount(String(balance))}
                className="t-mono-sm rounded-[6px] bg-nav px-[10px] py-[6px] text-ink hover:bg-nav-hover"
              >
                Max
              </button>
            </div>
          </div>

          <dl className="mt-[24px] flex flex-col gap-[10px] border-t border-[#E4E6E2] pt-[20px] text-[15px]">
            <Row label="Premium for the week" value={`${pct(product.premiumBps)} · est. ${apr(product.premiumBps)} APR`} />
            <Row
              label="Premium amount"
              value={amountNumber > 0 ? amountOf(depositToken, (amountNumber * product.premiumBps) / 10_000) : "—"}
            />
            <Row label="Settles" value={week ? `${week.label.replace("Week of ", "")}, Friday 4:00 PM ET` : "—"} />
          </dl>

          <button
            type="button"
            onClick={action.onClick}
            disabled={action.disabled || !action.onClick}
            className={[
              "mt-[24px] flex h-[52px] w-full items-center justify-center rounded-[8px] px-[16px] t-mono transition-colors duration-200",
              action.disabled || !action.onClick
                ? "cursor-not-allowed bg-nav text-dim"
                : "bg-ink text-white hover:bg-ink-hover",
            ].join(" ")}
          >
            {action.label}
          </button>

          {error && <p className="mt-[12px] text-[14px] text-[#8A3B2F]">{error}</p>}

          {quote && !staleQuote && (
            <p className="mt-[12px] t-mono-sm text-dim">
              Quote good for {Math.max(0, Math.ceil((quote.expiresAt - now) / 1000))}s
            </p>
          )}

          {MODE === "mock" && (
            <label className="mt-[20px] flex items-center justify-between gap-[8px] border-t border-[#E4E6E2] pt-[16px] t-mono-sm text-dim">
              Demo: next transaction
              <select
                value={demoOutcome}
                onChange={(e) => setDemoOutcome(e.target.value as DemoOutcome)}
                className="rounded-[6px] border border-[#E4E6E2] bg-white px-[8px] py-[6px] text-ink"
              >
                <option value="success">succeeds</option>
                <option value="rejected">rejected in wallet</option>
                <option value="failed">fails</option>
              </select>
            </label>
          )}
        </aside>
      </div>
    </div>
  );
}

function Outcome({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="border-t border-[#E4E6E2] py-[16px] first:border-t-0 first:pt-0">
      <dt className="t-mono-sm text-dim">{label}</dt>
      <dd className="mt-[8px] flex items-center gap-[10px] text-[22px] leading-none tabular text-ink">
        {accent && <span className="block size-[8px] rounded-[2px] bg-lime" aria-hidden="true" />}
        {value}
      </dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-[16px]">
      <dt className="text-dim">{label}</dt>
      <dd className="tabular text-ink">{value}</dd>
    </div>
  );
}
