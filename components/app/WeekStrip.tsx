"use client";

import { useEffect, useState } from "react";
import { countdown, etLabel } from "@/lib/nuvo/schedule";
import { useNow, useWeek } from "@/lib/nuvo/useNuvo";

// Brief 8: under the header. Subscriptions are open around the clock; the strip
// names the week on offer and counts down to Thursday's cutoff, when new
// subscriptions roll to the next week.
export function WeekStrip() {
  const now = useNow();
  const week = useWeek(now);
  // The countdown depends on the viewer's clock, so it is left to the browser.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const remaining = week.closesAt - now;

  return (
    <div className="border-b border-[#E4E6E2] bg-white">
      <div className="container-nuvo flex h-[52px] items-center gap-[12px] overflow-x-auto whitespace-nowrap t-mono-sm text-dim">
        <span className="text-ink">{week.label}</span>
        <span aria-hidden="true">·</span>
        <span>Open 24/7</span>
        <span aria-hidden="true">·</span>
        <span>Rolls to the next week {etLabel(week.closesAt)} ET</span>
        {mounted && remaining > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span className="tabular text-ink">{countdown(remaining)}</span>
          </>
        )}
      </div>
    </div>
  );
}
