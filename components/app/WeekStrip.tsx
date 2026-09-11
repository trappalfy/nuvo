"use client";

import { countdown, etLabel } from "@/lib/nuvo/schedule";
import { useNow, useNuvo } from "@/lib/nuvo/useNuvo";

// Brief 8: under the header — the week, when subscriptions close and the
// countdown to it. Once they close, the countdown runs to Friday's expiry.
export function WeekStrip() {
  const { data: week } = useNuvo((c) => c.getWeek(), []);
  const now = useNow();

  const open = week ? now >= week.opensAt && now < week.closesAt : false;
  const deadline = week ? (open ? week.closesAt : week.expiresAt) : 0;
  const remaining = deadline - now;

  return (
    <div className="border-b border-[#E4E6E2] bg-white">
      <div className="container-nuvo flex h-[52px] items-center gap-[12px] overflow-x-auto whitespace-nowrap t-mono-sm text-dim">
        <span className="text-ink">{week?.label ?? ""}</span>
        {week && (
          <>
            <span aria-hidden="true">·</span>
            <span>
              {open
                ? `Subscriptions close ${etLabel(week.closesAt)} ET`
                : "Subscriptions are closed. Next week opens Monday."}
            </span>
          </>
        )}
        {week && remaining > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span className="tabular text-ink">
              {open ? countdown(remaining) : `Expiry in ${countdown(remaining)}`}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
