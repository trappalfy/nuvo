"use client";

import { MODE } from "@/lib/nuvo/config";
import { isMock } from "@/lib/nuvo/client";
import { countdown, etLabel } from "@/lib/nuvo/schedule";
import type { WeekOverride } from "@/lib/nuvo/mock";
import { client, useNow, useNuvo } from "@/lib/nuvo/useNuvo";

// Brief 8: under the header — the week, when subscriptions close and the
// countdown. In mock mode it also carries the developer controls: settle the
// week so Claim can be reviewed, and force the subscription window either way,
// since the real schedule keeps it shut from Thursday 4:00 PM ET to Monday.
export function WeekStrip() {
  const { data: week } = useNuvo((c) => c.getWeek(), []);
  const now = useNow();
  const mockClient = MODE === "mock" && isMock(client) ? client : null;

  const open = week?.isOpen ?? false;
  const deadline = week ? (open ? week.closesAt : week.expiresAt) : 0;
  const remaining = deadline - now;

  return (
    <div className="border-b border-[#E4E6E2] bg-white">
      <div className="container-nuvo flex h-[52px] items-center gap-[12px] overflow-x-auto whitespace-nowrap t-mono-sm text-dim">
        <span className="text-ink">{week?.label ?? "Loading week"}</span>
        <span aria-hidden="true">·</span>
        <span>
          {!week
            ? ""
            : open
              ? `Subscriptions close ${etLabel(week.closesAt)} ET`
              : "Subscriptions are closed. Next week opens Monday."}
        </span>
        {week && remaining > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span className="tabular text-ink">{countdown(remaining)}</span>
          </>
        )}

        {mockClient && (
          <span className="ml-auto flex shrink-0 items-center gap-[8px]">
            <label className="flex items-center gap-[6px]">
              <select
                aria-label="Demo subscription window"
                defaultValue={mockClient.weekOverride}
                onChange={(e) => mockClient.setWeekOverride(e.target.value as WeekOverride)}
                className="h-[32px] rounded-[6px] border border-[#E4E6E2] bg-white px-[8px] t-mono-sm text-ink"
                title="Developer control: force the subscription window"
              >
                <option value="open">Demo: window open</option>
                <option value="closed">Demo: window closed</option>
                <option value="real">Demo: real schedule</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => mockClient.fastForwardWeek?.()}
              className="inline-flex h-[32px] items-center rounded-[6px] border border-[#E4E6E2] px-[12px] t-mono-sm text-ink transition-colors duration-200 hover:bg-nav"
              title="Developer control: settle this week so Claim can be reviewed"
            >
              Fast-forward week
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
