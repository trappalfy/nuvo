"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, useMotionTemplate, useMotionValue, useMotionValueEvent, useScroll } from "motion/react";
import { ArrowUp } from "../ui/Arrow";
import { SplitButton } from "../ui/SplitButton";
import { GiantWord } from "./GiantWord";

const NAVIGATE = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Products", href: "/#products" },
  { label: "Token", href: "/token" },
  { label: "App", href: "/app" },
];

// Brief 12: the social links are still an open question, so these are placeholders.
const CONNECT = [
  { label: "X", href: "#" },
  { label: "Telegram", href: "#" },
];

// Brief 6.5: the footer sits under the content. The light section scrolls up and
// uncovers it, so the footer is clipped to whatever falls below the bottom edge
// of the content above it.
export function Footer() {
  const clipTop = useMotionValue(4000);
  const clip = useMotionTemplate`inset(${clipTop}px 0 0 0)`;
  const [revealed, setRevealed] = useState(false);
  const [maxWordHeight, setMaxWordHeight] = useState<number | undefined>(undefined);
  const { scrollY } = useScroll();

  const update = () => {
    if (window.innerWidth < 1024) {
      clipTop.set(0);
      setRevealed(true);
      setMaxWordHeight(undefined);
      return;
    }
    // Keep the giant word clear of the CTA above it and the copyright below.
    setMaxWordHeight(Math.max(160, window.innerHeight * 0.68 - 182));
    const main = document.getElementById("main");
    const bottom = main ? main.getBoundingClientRect().bottom : window.innerHeight;
    clipTop.set(Math.max(0, bottom));
    setRevealed(bottom < window.innerHeight * 0.72);
  };

  useMotionValueEvent(scrollY, "change", update);

  useEffect(() => {
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.footer
      className="footer-reveal relative z-10 lg:fixed lg:inset-x-0 lg:bottom-0 lg:h-[100svh]"
      style={{ "--footer-clip": clip } as React.CSSProperties}
    >
      <div className="container-nuvo relative h-full pt-[96px] pb-[40px] lg:py-0">
        <p className="t-claim text-white lg:absolute lg:top-[17.26svh] lg:left-0 lg:max-w-[700px]">
          Target prices for tokenized stocks, settled every Friday on Robinhood Chain.
        </p>

        <div className="mt-[32px] lg:absolute lg:top-[31.93svh] lg:left-0 lg:mt-0">
          <SplitButton href="/app" label="Launch app" full="mobile" />
        </div>

        <div className="mt-[64px] grid gap-[40px] sm:grid-cols-2 lg:absolute lg:top-[16.72svh] lg:left-[58.4%] lg:right-0 lg:mt-0 lg:grid-cols-[46.2%_46.2%_auto] lg:gap-0">
          <div className="border-l border-hair pl-[20px]">
            <h2 className="t-mono-sm text-white/60">Navigate</h2>
            <ul className="mt-[18px] flex flex-col">
              {NAVIGATE.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="t-link text-white hover:underline">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="border-l border-hair pl-[20px]">
            <h2 className="t-mono-sm text-white/60">Connect</h2>
            <ul className="mt-[18px] flex flex-col">
              {CONNECT.map((item) => (
                <li key={item.label}>
                  <Link href={item.href} className="t-link text-white hover:underline">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:flex lg:justify-end">
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              aria-label="Back to top"
              className="inline-flex size-12 items-center justify-center rounded-full border border-white/40 text-white transition-colors duration-200 hover:bg-white/10"
            >
              <ArrowUp />
            </button>
          </div>
        </div>

        <div className="mt-[80px] lg:absolute lg:inset-x-0 lg:bottom-[30px] lg:mt-0">
          <GiantWord reveal={revealed} maxHeight={maxWordHeight} />
          <div className="mt-[40px] flex flex-col gap-[8px]">
            <p className="t-mono-sm text-white">© 2026 Nuvo. All rights reserved.</p>
            <p className="t-mono-sm text-white/60">
              Not affiliated with Robinhood Markets. Not available in the US and other restricted
              jurisdictions.
            </p>
          </div>
        </div>
      </div>
    </motion.footer>
  );
}
