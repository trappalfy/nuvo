"use client";

import { useState } from "react";
import { useWallet } from "@/components/app/AppProviders";
import { useToast } from "@/components/app/Toaster";
import { usd } from "@/lib/format";
import { NETWORK, USDG, explorerTx } from "@/lib/nuvo/config";
import { txErrorMessage } from "@/lib/nuvo/errors";
import { client, useNuvo } from "@/lib/nuvo/useNuvo";
import type { Address } from "@/lib/nuvo/types";

// A depositor takes the other side of every subscription: they pay the premium
// and get the right to the conversion. Here they put money in, see their share
// and take it back out.
export default function PoolPage() {
  const wallet = useWallet();
  const toast = useToast();
  const owner = wallet.address as Address | undefined;

  const [ticker, setTicker] = useState<string | undefined>(undefined);
  const [usdgIn, setUsdgIn] = useState("");
  const [tokenIn, setTokenIn] = useState("");
  const [pending, setPending] = useState<"approve" | "add" | "remove" | null>(null);

  const { data: tickers } = useNuvo((c) => c.listTickers(), []);
  const active = ticker ?? tickers?.[0]?.symbol;
  const { data: stats, refresh } = useNuvo(
    (c) => (active && c.ready.contracts ? c.getPoolStats(active, owner) : Promise.resolve(undefined)),
    [active, owner, pending],
  );
  const { data: balances } = useNuvo((c) => c.getBalances(owner), [owner]);

  const submitted = (title: string) => (hash: Address) =>
    toast({ title, tone: "info", href: explorerTx(hash), linkLabel: "Explorer" });

  const run = async (label: "approve" | "add" | "remove", work: () => Promise<unknown>) => {
    if (!client.ready.contracts || pending) return;
    setPending(label);
    try {
      await work();
      refresh();
    } catch (e) {
      toast({ title: txErrorMessage(e), tone: "error" });
    } finally {
      setPending(null);
    }
  };

  const onApprove = (symbol: string, value: string) =>
    run("approve", async () => {
      if (!stats) return;
      await client.approve(symbol, stats.pool, value, submitted(`Approving ${symbol}`));
      toast({ title: `${symbol} approved`, tone: "success" });
    });

  const onAdd = () =>
    run("add", async () => {
      if (!active) return;
      const tx = await client.addLiquidity(active, usdgIn, tokenIn, submitted("Deposit submitted"));
      toast({ title: "Deposited", tone: "success", href: explorerTx(tx.hash), linkLabel: "Explorer" });
      setUsdgIn("");
      setTokenIn("");
    });

  const onRemove = (part: bigint) =>
    run("remove", async () => {
      if (!active || part <= 0n) return;
      const tx = await client.removeLiquidity(active, part, submitted("Withdrawal submitted"));
      toast({ title: "Withdrawn", tone: "success", href: explorerTx(tx.hash), linkLabel: "Explorer" });
    });

  return (
    <div>
      <h1 className="text-[40px] leading-none tracking-[-0.03em] text-ink">Pool</h1>
      <p className="mt-[12px] max-w-[620px] text-[16px] leading-[1.5] text-dim">
        Depositors take the other side of every subscription: they pay the premium and receive the
        stock or the USDG when a target is reached. Deposits earn from that flow; the share of the
        inventory reserved against open positions cannot be withdrawn until they settle.
      </p>

      <div className="mt-[24px] flex flex-wrap gap-[8px]">
        {(tickers ?? []).map((t) => (
          <button
            key={t.symbol}
            type="button"
            onClick={() => setTicker(t.symbol)}
            className={[
              "inline-flex h-[38px] items-center rounded-[6px] px-[14px] t-mono transition-colors duration-200",
              t.symbol === active ? "bg-nav text-ink" : "text-dim hover:bg-nav/60 hover:text-ink",
            ].join(" ")}
          >
            {t.symbol}
          </button>
        ))}
      </div>

      <div className="mt-[24px] grid gap-[16px] lg:grid-cols-[1fr_400px] lg:items-start">
        <section className="rounded-[16px] bg-white p-[24px]">
          <h2 className="t-mono-sm text-dim">Inventory</h2>
          <dl className="mt-[16px] flex flex-col gap-[10px] text-[15px]">
            <Row label="Pool value" value={stats ? `$${usd(stats.valueUsdg)}` : "—"} />
            <Row label="Free right now" value={stats ? `$${usd(stats.freeUsdg)}` : "—"} />
            <Row label="Your share" value={stats ? `${usd(stats.myValueUsdg)}` : "—"} />
            <Row
              label="Yours to withdraw now"
              value={stats ? `${usd(stats.withdrawableUsdg)}` : "—"}
            />
            <Row
              label="Status"
              value={
                stats
                  ? stats.paused
                    ? "Deposits paused"
                    : !stats.canEnter
                      ? "Invite-only"
                      : stats.priceOk
                        ? "Open"
                        : "Waiting for a price"
                  : "—"
              }
            />
          </dl>
          <p className="mt-[16px] text-[14px] leading-[1.5] text-dim">
            Your share is priced off the reference; the part reserved against open positions
            cannot be withdrawn until they settle. Network fees on {NETWORK.name} are paid in ETH.
          </p>
        </section>

        <aside className="rounded-[16px] bg-white p-[24px]">
          <h2 className="t-mono-sm text-dim">Deposit</h2>
          <Field
            label={USDG.symbol}
            value={usdgIn}
            onChange={setUsdgIn}
            balance={balances?.[USDG.symbol]?.exact}
          />
          {active && (
            <Field
              label={active}
              value={tokenIn}
              onChange={setTokenIn}
              balance={balances?.[active]?.exact}
            />
          )}

          <div className="mt-[16px] flex flex-col gap-[8px]">
            {Number(usdgIn) > 0 && (
              <Button
                label={`Approve ${USDG.symbol}`}
                busy={pending === "approve"}
                onClick={() => onApprove(USDG.symbol, usdgIn)}
              />
            )}
            {active && Number(tokenIn) > 0 && (
              <Button
                label={`Approve ${active}`}
                busy={pending === "approve"}
                onClick={() => onApprove(active, tokenIn)}
              />
            )}
            <Button
              label="Deposit"
              busy={pending === "add"}
              onClick={onAdd}
              disabled={stats ? stats.paused || !stats.priceOk || !stats.canEnter : true}
            />
            {stats && !stats.canEnter && (
              <p className="text-[14px] leading-[1.5] text-dim">
                This pool is invite-only while it is young. Your wallet is not on the list yet, so
                deposits are closed to it — anything already deposited can still be withdrawn.
              </p>
            )}
            {stats && !stats.priceOk && (
              <p className="text-[14px] leading-[1.5] text-dim">
                The reference price is not fresh enough right now, so the pool will not take a
                deposit or pay a withdrawal. It reopens when the feed updates.
              </p>
            )}
          </div>

          <h2 className="t-mono-sm mt-[28px] border-t border-[#E4E6E2] pt-[20px] text-dim">
            Withdraw
          </h2>
          <p className="mt-[8px] text-[14px] text-dim">
            {stats && stats.shares > 0n
              ? `Your share is worth $${usd(stats.myValueUsdg)} at the current reference.`
              : "You have nothing in this pool yet."}
          </p>
          <div className="mt-[12px] flex gap-[8px]">
            <Button
              label="Half"
              busy={pending === "remove"}
              onClick={() => stats && onRemove(stats.shares / 2n)}
              disabled={stats ? !stats.priceOk || stats.shares === 0n : true}
            />
            <Button
              label="All"
              busy={pending === "remove"}
              onClick={() => stats && onRemove(stats.shares)}
              disabled={stats ? !stats.priceOk || stats.shares === 0n : true}
            />
          </div>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-[16px]">
      <dt className="text-dim">{label}</dt>
      <dd className="text-right tabular text-ink">{value}</dd>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  balance,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  balance?: string;
}) {
  return (
    <div className="mt-[12px]">
      <div className="flex items-baseline justify-between">
        <span className="t-mono-sm text-dim">{label}</span>
        {balance !== undefined && (
          <button
            type="button"
            onClick={() => onChange(balance)}
            className="t-mono-sm text-dim hover:text-ink"
          >
            Max
          </button>
        )}
      </div>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(cleanAmount(e.target.value))}
        placeholder="0.00"
        aria-label={`Amount in ${label}`}
        className="mt-[8px] h-[52px] w-full rounded-[8px] border border-[#E4E6E2] px-[14px] text-[20px] tabular text-ink outline-none focus:border-ink"
      />
    </div>
  );
}

function Button({
  label,
  busy,
  onClick,
  disabled,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled || !client.ready.contracts}
      className="flex min-h-[48px] w-full items-center justify-center rounded-[8px] bg-ink px-[16px] t-mono text-white transition-colors duration-200 hover:bg-ink-hover disabled:cursor-not-allowed disabled:bg-nav disabled:text-dim"
    >
      {busy ? "Confirming…" : label}
    </button>
  );
}
