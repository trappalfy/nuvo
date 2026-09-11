"use client";

import { ago, usd } from "@/lib/format";
import type { Direction, Reference } from "@/lib/nuvo/types";

// Where your price sits against the Chainlink reference. Only the two real
// numbers are drawn — no invented history.
export function ReferenceScale({
  reference,
  target,
  direction,
  now,
}: {
  reference: Reference;
  target: number;
  direction: Direction;
  now: number;
}) {
  const lo = Math.min(reference.price, target);
  const hi = Math.max(reference.price, target);
  const pad = (hi - lo) * 0.7 || hi * 0.02;
  const min = lo - pad;
  const max = hi + pad;
  const at = (value: number) => ((value - min) / (max - min)) * 100;

  const distance = (target / reference.price - 1) * 100;
  const left = Math.min(at(reference.price), at(target));
  const width = Math.abs(at(target) - at(reference.price));

  return (
    <div>
      <div className="relative h-[132px]">
        <div className="absolute inset-x-0 top-1/2 h-px bg-[#E4E6E2]" aria-hidden="true" />
        <div
          className={`absolute top-1/2 h-[8px] -translate-y-1/2 rounded-full ${direction === "buyLow" ? "bg-lime" : "bg-sand"}`}
          style={{ left: `${left}%`, width: `${width}%` }}
          aria-hidden="true"
        />

        <Marker at={at(reference.price)} position="top" label="Reference" value={`$${usd(reference.price)}`} />
        <Marker at={at(target)} position="bottom" label="Your price" value={`$${usd(target)}`} strong />
      </div>

      <div className="mt-[8px] flex flex-wrap justify-between gap-[8px] t-mono-sm text-dim">
        <span>
          {distance > 0 ? "+" : ""}
          {distance.toFixed(2)}% from the reference
        </span>
        {reference.source === "chain" && (
          <span className={reference.stale ? "text-[#8A3B2F]" : undefined}>
            {reference.stale ? "Reference is stale · " : ""}Updated {ago(reference.updatedAt, now)}
          </span>
        )}
      </div>
    </div>
  );
}

function Marker({
  at,
  position,
  label,
  value,
  strong,
}: {
  at: number;
  position: "top" | "bottom";
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className="absolute flex -translate-x-1/2 flex-col items-center"
      style={{
        left: `${at}%`,
        ...(position === "top" ? { bottom: "50%" } : { top: "50%" }),
      }}
    >
      {position === "bottom" && <span className="block h-[18px] w-px bg-ink" aria-hidden="true" />}
      <span
        className={[
          "whitespace-nowrap rounded-[6px] px-[8px] py-[5px] t-mono-sm tabular",
          strong ? "bg-ink text-white" : "bg-nav text-ink",
        ].join(" ")}
      >
        {label} {value}
      </span>
      {position === "top" && <span className="block h-[18px] w-px bg-ink/40" aria-hidden="true" />}
    </div>
  );
}
