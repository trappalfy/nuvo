"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";

const BASE = 100; // measuring font size
const TRACK = 0.06; // brief 3: -0.06em on the giant word

type Metrics = {
  width: number;
  fontSize: number;
  height: number;
  baseline: number;
  letters: { char: string; x: number }[];
};

// Brief 6.5: the word fills the container width exactly. It is measured once at
// a base size — advances for the positions, ink boxes for the edges — so the
// tracking is baked into the letter positions, the ink touches both container
// edges and no glyph is stretched. Brief 7: letters rise one by one when the
// footer opens.
export function GiantWord({
  word = "Nuvo",
  reveal,
  maxHeight,
}: {
  word?: string;
  reveal: boolean;
  maxHeight?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<SVGTextElement>(null);
  const [m, setM] = useState<Metrics | null>(null);

  useEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current;
      const probe = probeRef.current;
      if (!wrap || !probe) return;
      const width = wrap.clientWidth;
      if (!width) return;

      const chars = word.split("");
      let origins: number[];
      let ink: { x: number; y: number; width: number; height: number }[];
      try {
        origins = chars.map((_, i) => probe.getStartPositionOfChar(i).x - i * TRACK * BASE);
        ink = chars.map((_, i) => {
          const e = probe.getExtentOfChar(i);
          const a = probe.getStartPositionOfChar(i).x;
          return { x: e.x - a, y: e.y, width: e.width, height: e.height };
        });
      } catch {
        return;
      }
      if (!ink[0]?.width) return;

      const left = origins[0] + ink[0].x;
      const right = origins[chars.length - 1] + ink[chars.length - 1].x + ink[chars.length - 1].width;
      const top = Math.min(...ink.map((e) => e.y));
      const bottom = Math.max(...ink.map((e) => e.y + e.height));

      let scale = width / (right - left);
      if (maxHeight && (bottom - top) * scale > maxHeight) scale = maxHeight / (bottom - top);

      setM({
        width,
        fontSize: BASE * scale,
        height: (bottom - top) * scale,
        baseline: -top * scale,
        letters: chars.map((char, i) => ({ char, x: (origins[i] - left) * scale })),
      });
    };

    measure();
    void document.fonts?.ready.then(() => requestAnimationFrame(measure));
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [word, maxHeight]);

  return (
    <div ref={wrapRef} className="w-full">
      {/* hidden probe: base size, no tracking */}
      <svg width="0" height="0" className="absolute opacity-0" aria-hidden="true">
        <text
          ref={probeRef}
          style={{ fontFamily: "var(--font-inter-tight)", fontWeight: 500, fontSize: BASE }}
        >
          {word}
        </text>
      </svg>

      {m && (
        <svg
          width={m.width}
          height={m.height}
          viewBox={`0 0 ${m.width} ${m.height}`}
          className="block"
          role="img"
          aria-label={word}
        >
          {m.letters.map((letter, i) => (
            <motion.g
              key={`${letter.char}-${i}`}
              initial={{ y: m.height, opacity: 0 }}
              animate={reveal ? { y: 0, opacity: 1 } : { y: m.height, opacity: 0 }}
              transition={{ duration: 0.8, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
            >
              <text
                x={letter.x}
                y={m.baseline}
                fill="#FFFFFF"
                style={{
                  fontFamily: "var(--font-inter-tight)",
                  fontWeight: 500,
                  fontSize: m.fontSize,
                }}
              >
                {letter.char}
              </text>
            </motion.g>
          ))}
        </svg>
      )}
    </div>
  );
}
