"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import { DirectionToggle } from "@/components/app/DirectionToggle";
import { ReferenceScale } from "@/components/app/ReferenceScale";
import { useWallet } from "@/components/app/AppProviders";
import { useToast } from "@/components/app/Toaster";
import { amountOf, apr, pct, qty, signedPct, usd } from "@/lib/format";
import { NETWORK, USDG, explorerTx } from "@/lib/nuvo/config";
import { txErrorMessage, unavailableMessage } from "@/lib/nuvo/errors";
import { expiryLabel } from "@/lib/nuvo/schedule";
import { client, useNow, useNuvo, useWeek } from "@/lib/nuvo/useNuvo";
import type { Address, Direction, PreviewResult } from "@/lib/nuvo/types";

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

  const direction: Direction = search.get("direction") === "sellHigh" ? "sellHigh" : "buyLow";
  const step = Number(search.get("target") ?? 2);

  const [amount, setAmount] = useState("");
  const [terms, setTerms] = useState<PreviewResult | undefined>(undefined);
  const [termsLoading, setTermsLoading] = useState(false);
  const [termsError, setTermsError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<"approve" | "subscribe" | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  // Blocks a second press before the pending state has rendered.
  const busy = useRef(false);

  const owner = wallet.address as Address | undefined;
  const week = useWeek(now);
  const { data: products, loading } = useNuvo(
    (c) => c.listProducts(direction, symbol),
    // Read again when the week rolls over at Thursday's cutoff.
    [direction, symbol, week.id],
  );
  const { data: tickers } = useNuvo((c) => c.listTickers(), []);
  const { data: balances } = useNuvo((c) => c.getBalances(owner), [owner]);
  // A young pool is invite-only. Say so on the button rather than let the
  // wallet open for a transaction the pool will refuse.
  const { data: mayEnter } = useNuvo(
    (c) => (symbol ? c.canEnter(symbol, owner) : Promise.resolve(true)),
    [symbol, owner],
  );

  const info = tickers?.find((t) => t.symbol === symbol);
  const product = useMemo(
    () => products?.find((p) => Math.abs(p.targetOffset) === Math.abs(step)) ?? products?.[0],
    [products, step],
  );

  // Amounts here are display units. The feed prices the token itself, so the
  // ERC-8056 multiplier never enters the arithmetic.
  const depositToken = direction === "buyLow" ? USDG.symbol : symbol;
  const balance = balances?.[depositToken]?.amount;
  const exactBalance = balances?.[depositToken]?.exact;
  const amountNumber = Number(amount) || 0;

  const { data: allowance } = useNuvo(
    (c) => (product ? c.getAllowance(depositToken, product.pool, owner) : Promise.resolve(0)),
    [depositToken, owner, pending, product?.pool],
  );

  const premiumBps = terms?.premiumBps || product?.premiumBps;

  // Brief 8: the outcome numbers move as the amount is typed. They come from
  // the pool; before the contracts are configured the screen shows the same
  // arithmetic off the rung's premium rather than an empty panel.
  const outcomes = useMemo(() => {
    if (terms && amountNumber > 0 && terms.premiumBps > 0) {
      return { converted: terms.ifConverted, kept: terms.ifNot };
    }
    if (!product || amountNumber <= 0) return undefined;
    const r = (premiumBps ?? 0) / 10_000;
    return direction === "buyLow"
      ? {
          converted: { token: symbol, amount: (amountNumber * (1 + r)) / product.targetPrice },
          kept: { token: USDG.symbol, amount: amountNumber * (1 + r) },
        }
      : {
          converted: { token: USDG.symbol, amount: amountNumber * product.targetPrice * (1 + r) },
          kept: { token: symbol, amount: amountNumber * (1 + r) },
        };
  }, [amountNumber, direction, premiumBps, product, symbol, terms]);

  // The terms are read from the pool: premium, strike and both outcomes for
  // the amount typed. No signature, no expiry to watch.
  useEffect(() => {
    if (!product || !client.ready.contracts) {
      setTerms(undefined);
      setTermsError(undefined);
      setTermsLoading(false);
      return;
    }
    let alive = true;
    setTermsLoading(true);
    setTermsError(undefined);
    const id = setTimeout(() => {
      client
        .getPreview(product, amount || "0")
        .then((result) => {
          if (alive) setTerms(result);
        })
        .catch(() => {
          if (!alive) return;
          setTerms(undefined);
          setTermsError("The pool is not answering right now");
        })
        .finally(() => {
          if (alive) setTermsLoading(false);
        });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [amount, product]);

  const setParams = (next: { direction?: Direction; target?: number }) => {
    const params = new URLSearchParams(search.toString());
    if (next.direction) params.set("direction", next.direction);
    if (next.target) params.set("target", String(next.target));
    router.replace(`?${params.toString()}`, { scroll: false });
    setTerms(undefined);
    setError(undefined);
  };

  const submitted = (title: string) => (hash: Address) =>
    toast({ title, tone: "info", href: explorerTx(hash), linkLabel: "Explorer" });

  // Contract writes stay inert until the factory is configured: the buttons
  // look and behave like the live ones, a press simply does nothing.
  const onApprove = async () => {
    if (!client.ready.contracts || busy.current || !product) return;
    busy.current = true;
    setError(undefined);
    setPending("approve");
    try {
      await client.approve(depositToken, product.pool, amount, submitted(`Approving ${depositToken}`));
      toast({ title: `${depositToken} approved`, tone: "success" });
    } catch (e) {
      const message = txErrorMessage(e);
      setError(message);
      toast({ title: message, tone: "error" });
    } finally {
      busy.current = false;
      setPending(null);
    }
  };

  const onSubscribe = async () => {
    if (!client.ready.contracts || busy.current) return;
    if (!product || !terms || terms.code !== 0) return;
    busy.current = true;
    setError(undefined);
    setPending("subscribe");
    try {
      const tx = await client.subscribe(product, amount, terms, submitted("Subscription submitted"));
      toast({ title: "Subscribed", tone: "success", href: explorerTx(tx.hash), linkLabel: "Explorer" });
      setAmount("");
    } catch (e) {
      const message = txErrorMessage(e);
      setError(message);
      toast({ title: message, tone: "error" });
    } finally {
      busy.current = false;
      setPending(null);
    }
  };

  // Brief 8: every state of the subscribe button, in order of precedence. Once
  // the factory is configured the pool names the reason it will not take a
  // subscription, and the limits come with it.
  const action = (() => {
    if (!wallet.isConnected) return { label: "Connect wallet", onClick: wallet.connect };
    if (!wallet.isRightNetwork) return { label: "Switch network", onClick: wallet.switchNetwork };
    if (pending) return { label: "Confirming…", disabled: true };
    if (amountNumber <= 0) return { label: "Enter an amount", disabled: true };
    if (balance !== undefined && amountNumber > balance)
      return { label: `Not enough ${depositToken} in your wallet`, disabled: true };
    if (client.ready.contracts) {
      if (mayEnter === false) return { label: "This pool is invite-only", disabled: true };
      if ((allowance ?? 0) < amountNumber)
        return { label: `Approve ${depositToken}`, onClick: onApprove };
      if (termsLoading) return { label: "Reading the pool…", disabled: true };
      if (termsError) return { label: termsError, disabled: true };
      if (!terms) return { label: "Reading the pool…", disabled: true };
      if (terms.code !== 0)
        return { label: unavailableMessage(terms.code, depositToken), disabled: true };
    }
    return { label: "Subscribe", onClick: onSubscribe };
  })();

  if (!product) {
    return (
      <div className="py-[48px]">
        <p className="break-words text-[18px] text-dim">
          {loading ? "Loading…" : `${symbol} has no products open this week.`}
        </p>
        {!loading && (
          <Link href="/app" className="t-mono mt-[16px] inline-flex text-ink hover:underline">
            Back to products
          </Link>
        )}
      </div>
    );
  }

  const withPremium = (text: string) => (premiumBps === undefined ? `${text} + premium` : text);

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
                {info?.name && info.name !== symbol && (
                  <p className="mt-[8px] text-[15px] text-dim">{info.name}</p>
                )}
              </div>
              <div className="text-right">
                <div className="t-mono-sm text-dim">
                  {product.reference.source === "chain" ? "Chainlink reference" : "Reference price"}
                </div>
                <div className="mt-[8px] text-[28px] leading-none tabular text-ink">
                  ${usd(product.reference.price)}
                </div>
              </div>
            </div>

            <div className="mt-[24px]">
              <ReferenceScale
                reference={product.reference}
                target={product.targetPrice}
                direction={direction}
                now={now}
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
                  outcomes
                    ? withPremium(amountOf(outcomes.converted.token, outcomes.converted.amount))
                    : "—"
                }
                accent
              />
              <Outcome
                label={direction === "buyLow" ? "If it closes above" : "If it closes below"}
                value={
                  outcomes ? withPremium(amountOf(outcomes.kept.token, outcomes.kept.amount)) : "—"
                }
              />
            </dl>
            <p className="mt-[16px] text-[14px] leading-[1.5] text-dim">
              {premiumBps !== undefined
                ? `The premium of ${pct(premiumBps)} for the week is fixed when you subscribe and is paid in both outcomes. Only the asset you receive changes.`
                : "The premium is fixed when you subscribe and is paid in both outcomes. Only the asset you receive changes."}
            </p>
          </section>

          <section className="rounded-[16px] bg-white p-[24px]">
            <h2 className="t-mono-sm text-dim">Rules</h2>
            <ul className="mt-[16px] flex flex-col gap-[12px] text-[16px] leading-[1.5] text-ink">
              <li>Settlement uses the Chainlink reference at Friday’s close, not the pool price.</li>
              <li>Your deposit is locked until settlement. There is no early exit.</li>
              <li>
                Subscriptions are open around the clock. Until Thursday 4:00 PM ET they go into
                this Friday’s expiry at 4:00 PM ET; after that, into the next Friday’s.
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
              {products?.map((p) => {
                const active = p.id === product.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setParams({ target: Math.abs(p.targetOffset) })}
                    className={[
                      "flex flex-col gap-[6px] rounded-[8px] border px-[12px] py-[10px] text-left transition-colors duration-200",
                      active ? "border-ink bg-page" : "border-[#E4E6E2] hover:border-ink/40",
                    ].join(" ")}
                  >
                    <span className="t-mono-sm text-dim">{signedPct(p.targetOffset)}</span>
                    <span className="text-[17px] leading-none tabular text-ink">${usd(p.targetPrice)}</span>
                    <span className="t-mono-sm text-lime-ink">
                      {p.premiumBps !== undefined ? pct(p.premiumBps) : "—"}
                    </span>
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
              {balance !== undefined && (
                <span className="t-mono-sm tabular text-dim">
                  Balance {direction === "buyLow" ? usd(balance) : qty(balance, 4)}
                </span>
              )}
            </div>
            <div className="mt-[10px] flex items-center gap-[8px] rounded-[8px] border border-[#E4E6E2] px-[14px] focus-within:border-ink">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(cleanAmount(e.target.value))}
                placeholder="0.00"
                aria-label={`Amount in ${depositToken}`}
                className="h-[52px] w-full min-w-0 bg-transparent text-[20px] tabular text-ink outline-none placeholder:text-dim"
              />
              <span className="t-mono-sm text-dim">{depositToken}</span>
              <button
                type="button"
                onClick={() => exactBalance !== undefined && setAmount(exactBalance)}
                disabled={exactBalance === undefined}
                className="t-mono-sm rounded-[6px] bg-nav px-[10px] py-[6px] text-ink hover:bg-nav-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                Max
              </button>
            </div>
          </div>

          <dl className="mt-[24px] flex flex-col gap-[10px] border-t border-[#E4E6E2] pt-[20px] text-[15px]">
            <Row
              label="Premium for the week"
              value={
                premiumBps !== undefined
                  ? `${pct(premiumBps)} · est. ${apr(premiumBps)} APR`
                  : "Set by the pool on entry"
              }
            />
            <Row
              label="Premium amount"
              value={
                amountNumber > 0 && premiumBps !== undefined
                  ? amountOf(depositToken, (amountNumber * premiumBps) / 10_000)
                  : "—"
              }
            />
            <Row
              label="Settles"
              value={`${expiryLabel(product.expiresAt)} ET`}
            />
          </dl>

          <button
            type="button"
            onClick={action.onClick}
            disabled={action.disabled || !action.onClick}
            className={[
              "mt-[24px] flex min-h-[52px] w-full items-center justify-center rounded-[8px] px-[16px] py-[12px] text-center t-mono transition-colors duration-200",
              action.disabled || !action.onClick
                ? "cursor-not-allowed bg-nav text-dim"
                : "bg-ink text-white hover:bg-ink-hover",
            ].join(" ")}
          >
            {action.label}
          </button>

          {(error || termsError) && (
            <p className="mt-[12px] text-[14px] text-[#8A3B2F]">{error ?? termsError}</p>
          )}

          <p className="mt-[12px] t-mono-sm text-dim">
            Network fees on {NETWORK.name} are paid in ETH.
          </p>
        </aside>
      </div>
    </div>
  );
}

/** Digits and one decimal point. A comma is taken as the point, as typed on many keyboards. */
function cleanAmount(value: string) {
  const text = value.replace(/,/g, ".").replace(/[^0-9.]/g, "");
  const dot = text.indexOf(".");
  return dot === -1 ? text : `${text.slice(0, dot + 1)}${text.slice(dot + 1).replace(/\./g, "")}`;
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
      <dd className="text-right tabular text-ink">{value}</dd>
    </div>
  );
}
