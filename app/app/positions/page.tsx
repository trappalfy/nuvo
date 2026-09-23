"use client";

import Link from "next/link";
import { useState } from "react";
import { useWallet } from "@/components/app/AppProviders";
import { useToast } from "@/components/app/Toaster";
import { amountOf, pct, usd } from "@/lib/format";
import { explorerTx } from "@/lib/nuvo/config";
import { txErrorMessage } from "@/lib/nuvo/errors";
import { etLabel } from "@/lib/nuvo/schedule";
import { client, useNuvo } from "@/lib/nuvo/useNuvo";
import type { Address, OwedBalance, Position } from "@/lib/nuvo/types";

const TABS = [
  { id: "active", label: "Active" },
  { id: "settled", label: "Settled" },
  { id: "history", label: "History" },
] as const;

type Tab = (typeof TABS)[number]["id"];

// Brief 8: Active before settlement, Settled with Claim, then History.
export default function PositionsPage() {
  const [tab, setTab] = useState<Tab>("active");
  const [claiming, setClaiming] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const wallet = useWallet();
  const toast = useToast();
  const {
    data: positions,
    loading,
    error: loadError,
    refresh,
  } = useNuvo((c) => c.getPositions(wallet.address as Address | undefined), [wallet.address]);

  // Payouts the pool is holding because someone else closed the position.
  const { data: owed, refresh: refreshOwed } = useNuvo(
    (c) => c.getOwed(wallet.address as Address | undefined),
    [wallet.address],
  );

  const shown = (positions ?? []).filter((p) =>
    tab === "active"
      ? p.status === "active"
      : tab === "settled"
        ? p.status === "claimable"
        : p.status === "claimed",
  );

  const claim = async (position: Position) => {
    // Contract writes stay inert until the Nuvo contract is configured.
    if (!client.ready.contracts || claiming) return;
    if (!wallet.isRightNetwork) {
      wallet.switchNetwork();
      return;
    }
    setClaiming(position.id);
    try {
      const tx = await client.claim(position.id, (hash) =>
        toast({ title: "Claim submitted", tone: "info", href: explorerTx(hash), linkLabel: "Explorer" }),
      );
      toast({
        title: `Claimed ${amountOf(position.settlement!.payout.token, position.settlement!.payout.amount)}`,
        tone: "success",
        href: explorerTx(tx.hash),
        linkLabel: "Explorer",
      });
    } catch (e) {
      toast({ title: txErrorMessage(e), tone: "error" });
    } finally {
      setClaiming(null);
    }
  };

  const withdraw = async (row: OwedBalance) => {
    if (!client.ready.contracts || withdrawing) return;
    if (!wallet.isRightNetwork) {
      wallet.switchNetwork();
      return;
    }
    setWithdrawing(row.id);
    try {
      const tx = await client.withdrawOwed(row.id, (hash) =>
        toast({ title: "Withdrawal submitted", tone: "info", href: explorerTx(hash), linkLabel: "Explorer" }),
      );
      toast({
        title: `Withdrew ${amountOf(row.token, row.amount)}`,
        tone: "success",
        href: explorerTx(tx.hash),
        linkLabel: "Explorer",
      });
      refreshOwed();
      refresh();
    } catch (e) {
      toast({ title: txErrorMessage(e), tone: "error" });
    } finally {
      setWithdrawing(null);
    }
  };

  return (
    <div>
      <h1 className="text-[40px] leading-none tracking-[-0.03em] text-ink">Positions</h1>

      {/* A position closed by someone else pays into the pool's ledger, not the
          wallet. Without this the money is on chain and the owner never sees it. */}
      {wallet.isConnected && (owed ?? []).length > 0 && (
        <section className="mt-[24px] rounded-[16px] bg-white p-[24px]">
          <h2 className="t-mono-sm text-dim">Ready to withdraw</h2>
          <p className="mt-[8px] max-w-[560px] text-[15px] leading-[1.5] text-dim">
            These positions were closed for you once they had been settled for a day, so their
            payout is waiting in the pool. Take it whenever you like.
          </p>
          <div className="mt-[16px] flex flex-col gap-[10px]">
            {(owed ?? []).map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-[12px] border-t border-[#E4E6E2] pt-[10px]"
              >
                <span className="text-[17px] tabular text-ink">
                  {amountOf(row.token, row.amount)}
                  <span className="text-dim"> · {row.ticker} pool</span>
                </span>
                <button
                  type="button"
                  onClick={() => withdraw(row)}
                  disabled={withdrawing === row.id || !client.ready.contracts}
                  className="t-mono inline-flex h-[40px] items-center rounded-[8px] bg-ink px-[16px] text-white transition-colors duration-200 hover:bg-ink-hover disabled:cursor-not-allowed disabled:bg-nav disabled:text-dim"
                >
                  {withdrawing === row.id ? "Confirming…" : "Withdraw"}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mt-[24px] inline-flex rounded-[10px] bg-nav p-[4px]" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={[
              "inline-flex h-[40px] items-center rounded-[6px] px-[18px] t-mono transition-colors duration-200",
              tab === item.id ? "bg-white text-ink" : "text-dim hover:text-ink",
            ].join(" ")}
          >
            {item.label}
          </button>
        ))}
      </div>

      {!wallet.isConnected && (
        <div className="mt-[28px] rounded-[16px] bg-white p-[32px]">
          <p className="text-[18px] text-ink">Connect your wallet to see your positions.</p>
          <button
            type="button"
            onClick={wallet.connect}
            className="t-mono mt-[20px] inline-flex h-[44px] items-center rounded-[8px] bg-ink px-[18px] text-white hover:bg-ink-hover"
          >
            Connect wallet
          </button>
        </div>
      )}

      {wallet.isConnected && loading && (
        <p className="mt-[28px] text-[16px] text-dim">Loading positions…</p>
      )}

      {/* A failed read must not look like an empty account. */}
      {wallet.isConnected && !loading && loadError && (
        <div className="mt-[28px] rounded-[16px] bg-white p-[32px]">
          <p className="text-[18px] text-ink">Could not load your positions.</p>
          <p className="mt-[8px] max-w-[520px] text-[15px] leading-[1.5] text-dim">
            The network did not answer. Your positions are on chain and are not affected.
          </p>
          <button
            type="button"
            onClick={refresh}
            className="t-mono mt-[20px] inline-flex h-[44px] items-center rounded-[8px] bg-ink px-[18px] text-white hover:bg-ink-hover"
          >
            Try again
          </button>
        </div>
      )}

      {wallet.isConnected && !loading && !loadError && shown.length === 0 && (
        <div className="mt-[28px] rounded-[16px] bg-white p-[32px]">
          <p className="text-[18px] text-ink">No positions yet. Pick a product.</p>
          <Link
            href="/app"
            className="t-mono mt-[20px] inline-flex h-[44px] items-center rounded-[8px] bg-ink px-[18px] text-white hover:bg-ink-hover"
          >
            Products
          </Link>
        </div>
      )}

      <div className="mt-[28px] flex flex-col gap-[12px]">
        {wallet.isConnected &&
          !loadError &&
          shown.map((position) => (
            <article key={position.id} className="rounded-[16px] bg-white p-[24px]">
              <div className="flex flex-wrap items-start justify-between gap-[16px]">
                <div className="flex items-center gap-[12px]">
                  <span
                    className={`block size-[10px] rounded-[2px] ${position.direction === "buyLow" ? "bg-lime" : "bg-sand"}`}
                    aria-hidden="true"
                  />
                  <div>
                    <h2 className="text-[22px] leading-none tracking-[-0.02em] text-ink">
                      {position.ticker}
                    </h2>
                    <p className="mt-[8px] t-mono-sm text-dim">
                      {position.direction === "buyLow" ? "Buy Low" : "Sell High"} · target $
                      {usd(position.targetPrice)} · {pct(position.premiumBps)} for the week
                    </p>
                  </div>
                </div>

                {position.status === "claimable" && position.settlement && (
                  <button
                    type="button"
                    onClick={() => claim(position)}
                    disabled={claiming === position.id}
                    className="inline-flex h-[44px] items-center rounded-[8px] bg-ink px-[18px] t-mono text-white transition-colors duration-200 hover:bg-ink-hover disabled:cursor-not-allowed disabled:bg-nav disabled:text-dim"
                  >
                    {claiming === position.id
                      ? "Confirming…"
                      : wallet.isRightNetwork
                        ? "Claim"
                        : "Switch network"}
                  </button>
                )}
              </div>

              <dl className="mt-[20px] grid gap-[16px] border-t border-[#E4E6E2] pt-[20px] sm:grid-cols-3">
                <Cell label="Deposited" value={amountOf(position.depositToken, position.amount)} />
                {position.settlement ? (
                  <>
                    <Cell
                      label="Your price"
                      value={`$${usd(position.targetPrice)}`}
                      hint={position.settlement.converted ? "Converted" : "Not converted"}
                    />
                    <Cell
                      label={position.status === "claimed" ? "Claimed" : "To claim"}
                      value={amountOf(position.settlement.payout.token, position.settlement.payout.amount)}
                    />
                  </>
                ) : (
                  <>
                    <Cell label="Expires" value={`${etLabel(position.expiresAt)} ET`} />
                    <Cell label="Status" value="Locked until settlement" />
                  </>
                )}
              </dl>
            </article>
          ))}
      </div>
    </div>
  );
}

function Cell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="t-mono-sm text-dim">{label}</dt>
      <dd className="mt-[8px] text-[18px] leading-none tabular text-ink">{value}</dd>
      {hint && <p className="mt-[8px] t-mono-sm text-dim">{hint}</p>}
    </div>
  );
}
