"use client";

import { useMemo } from "react";
import { usd } from "@/lib/format";

// Brief 8: a demo mini chart. The series is hashed from the ticker, so it is the
// same on every reload and on every machine — it is illustrative, not a feed.

const hash = (seed: string) => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
};

const WIDTH = 640;
const HEIGHT = 180;
const POINTS = 48;

export function PriceChart({
  ticker,
  reference,
  target,
}: {
  ticker: string;
  reference: number;
  target: number;
}) {
  const { path, area, targetY, min, max } = useMemo(() => {
    const series: number[] = [];
    let value = reference * (0.94 + hash(`${ticker}:start`) * 0.06);
    for (let i = 0; i < POINTS; i++) {
      value *= 1 + (hash(`${ticker}:${i}`) - 0.48) * 0.022;
      series.push(value);
    }
    // Land the last point on the reference so the chart agrees with the header.
    const drift = reference / series[series.length - 1];
    const adjusted = series.map((v, i) => v * (1 + (drift - 1) * (i / (POINTS - 1))));

    const lo = Math.min(...adjusted, target) * 0.99;
    const hi = Math.max(...adjusted, target) * 1.01;
    const x = (i: number) => (i / (POINTS - 1)) * WIDTH;
    const y = (v: number) => HEIGHT - ((v - lo) / (hi - lo)) * HEIGHT;

    const d = adjusted.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

    return {
      path: d,
      area: `${d} L${WIDTH},${HEIGHT} L0,${HEIGHT} Z`,
      targetY: y(target),
      min: lo,
      max: hi,
    };
  }, [reference, target, ticker]);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block h-[180px] w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${ticker} demo price history, target ${usd(target)}`}
      >
        <defs>
          <linearGradient id="nuvo-chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#CEF79E" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#CEF79E" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#nuvo-chart-fill)" />
        <path d={path} fill="none" stroke="#445746" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <line
          x1="0"
          x2={WIDTH}
          y1={targetY}
          y2={targetY}
          stroke="#222F30"
          strokeWidth={1}
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <span
        className="absolute right-0 -translate-y-1/2 rounded-[6px] bg-ink px-[8px] py-[4px] t-mono-sm text-white"
        style={{ top: `${(targetY / HEIGHT) * 100}%` }}
      >
        ${usd(target)}
      </span>

      <div className="mt-[8px] flex justify-between t-mono-sm text-dim">
        <span>${usd(min)}</span>
        <span>Demo series</span>
        <span>${usd(max)}</span>
      </div>
    </div>
  );
}
