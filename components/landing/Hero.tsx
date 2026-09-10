"use client";

import { motion } from "motion/react";
import { SplitButton } from "../ui/SplitButton";

const LINES = ["Name your price.", "Get paid to wait."];
const EASE = [0.22, 1, 0.36, 1] as const;

// Brief 6.2: 100vh hero over the video window. H1 top left, lead bottom left,
// SplitButton bottom right. Brief 7: the H1 lines rise out of a mask, then the
// lead and the button fade in.
export function Hero() {
  return (
    <section className="relative flex h-[100svh] min-h-[560px] flex-col">
      <div className="container-nuvo flex h-full flex-col pt-[clamp(96px,16.3svh,180px)] pb-[clamp(28px,4.85svh,60px)]">
        <h1 className="t-h1 max-w-[18ch] text-white">
          {LINES.map((line, i) => (
            <span key={line} className="block overflow-hidden pb-[0.12em] -mb-[0.12em]">
              <motion.span
                className="block"
                initial={{ y: "120%" }}
                animate={{ y: "0%" }}
                transition={{ duration: 0.9, delay: i * 0.12, ease: EASE }}
              >
                {line}
              </motion.span>
            </span>
          ))}
        </h1>

        <motion.div
          className="mt-auto flex flex-col items-start gap-8 lg:flex-row lg:items-end lg:justify-between"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.9 }}
        >
          <p className="t-lead max-w-[620px] text-white">
            Dual investment on tokenized stocks. Buy below the market or sell above it, with a
            premium either way.
          </p>
          <SplitButton href="/app" label="Launch app" full="mobile" />
        </motion.div>
      </div>
    </section>
  );
}
