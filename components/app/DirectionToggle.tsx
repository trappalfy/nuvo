"use client";

import type { Direction } from "@/lib/nuvo/types";

// Brief 8: Buy Low is marked lime, Sell High beige.
export function DirectionToggle({
  value,
  onChange,
  className,
}: {
  value: Direction;
  onChange: (next: Direction) => void;
  className?: string;
}) {
  const options: { id: Direction; label: string; active: string }[] = [
    { id: "buyLow", label: "Buy Low", active: "bg-lime text-ink" },
    { id: "sellHigh", label: "Sell High", active: "bg-sand text-ink" },
  ];

  return (
    <div
      className={`inline-flex rounded-[10px] bg-nav p-[4px] ${className ?? ""}`}
      role="tablist"
      aria-label="Direction"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          onClick={() => onChange(option.id)}
          className={[
            "inline-flex h-[40px] items-center rounded-[6px] px-[18px] t-mono transition-colors duration-200",
            value === option.id ? option.active : "text-dim hover:text-ink",
          ].join(" ")}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
