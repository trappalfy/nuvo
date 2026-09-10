"use client";

import { AnimatePresence, motion } from "motion/react";

const pad = (n: number) => String(n).padStart(2, "0");

// Brief 6.3: 96x40 outlined counter, active number white, total in `dim`.
export function Counter({ index, total = 3 }: { index: number; total?: number }) {
  return (
    <div className="flex h-[40px] w-[96px] items-center justify-center gap-[7px] rounded-full border border-white/40 t-mono tabular text-white">
      <span className="relative block h-[16px] w-[21px] overflow-hidden">
        <AnimatePresence initial={false}>
          <motion.span
            key={index}
            className="absolute inset-0 flex items-center justify-center"
            initial={{ y: 18, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -18, opacity: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            {pad(index)}
          </motion.span>
        </AnimatePresence>
      </span>
      <span className="text-dim">/ {pad(total)}</span>
    </div>
  );
}
