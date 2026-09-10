"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { Chip } from "../ui/Chip";
import { Counter } from "../ui/Counter";

const STEPS = [
  "Pick a stock token and a direction. Buy Low sets a price under the market, Sell High sets one above it, and every product runs for one week.",
  "The premium is fixed the moment you subscribe. It is paid on top of your deposit at settlement, whichever way the stock moves.",
  "Settlement uses the Chainlink reference at Friday's close. Reach your price and you convert; fall short and you keep what you put in.",
];

const EASE = [0.22, 1, 0.36, 1] as const;

// Brief 6.3: pinned for 3 x 100vh, one step per screen of scroll.
export function Steps() {
  const ref = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const lineWidth = useTransform(scrollYProgress, [0, 1], ["33.3%", "100%"]);

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    setActive(Math.min(STEPS.length - 1, Math.max(0, Math.floor(p * STEPS.length))));
  });

  return (
    <section id="how-it-works" ref={ref} className="relative scroll-mt-[84px] lg:h-[300svh]">
      {/* Brief 4: the steps screen is dimmed harder than the rest. */}
      <div className="hidden lg:sticky lg:top-0 lg:block lg:h-[100svh] lg:overflow-hidden">
        <div className="absolute inset-0 bg-[rgba(10,22,16,0.12)]" aria-hidden="true" />

        <div className="absolute inset-x-0 top-[20.6svh] h-px bg-hair" aria-hidden="true">
          <motion.div className="h-px bg-white/85" style={{ width: lineWidth }} />
        </div>

        <div className="container-nuvo relative h-full">
          <div className="absolute top-[12.62svh] left-0">
            <Chip label="How it works" />
          </div>
          <div className="absolute top-[24.16svh] left-0">
            <Counter index={active + 1} total={STEPS.length} />
          </div>
          <div className="absolute top-[25.03svh] left-[34.2%] w-[55.8%]">
            <AnimatePresence mode="wait">
              <motion.p
                key={active}
                className="t-step text-white"
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -40, opacity: 0 }}
                transition={{ duration: 0.6, ease: EASE }}
              >
                {STEPS[active]}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Brief 10: under 1024 nothing is pinned — three blocks in a row. */}
      <div className="relative lg:hidden">
        <div className="absolute inset-0 bg-[rgba(10,22,16,0.12)]" aria-hidden="true" />
        <div className="container-nuvo relative py-[88px]">
          <Chip label="How it works" />
          <div className="mt-[44px] flex flex-col gap-[56px]">
            {STEPS.map((step, i) => (
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.6, ease: EASE }}
              >
                <div className="h-px w-full bg-hair" />
                <div className="mt-[24px]">
                  <Counter index={i + 1} total={STEPS.length} />
                </div>
                <p className="t-step mt-[24px] text-white">{step}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
