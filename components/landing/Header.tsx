"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { Lockup } from "../ui/Mark";

const NAV = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Products", href: "/#products" },
];

// Brief 6.1: fixed header over everything. The lockup is white on the hero and
// sits on a blurred plate in `ink` once the hero is behind.
export function Header() {
  const [past, setPast] = useState(false);
  const [menu, setMenu] = useState(false);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, "change", (y) => {
    setPast(y > window.innerHeight * 0.8);
  });

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div className="container-nuvo flex h-[84px] items-center justify-between md:h-[111px]">
        <Link href="/" className="relative inline-flex items-center" aria-label="Nuvo, home">
          <AnimatePresence>
            {past && (
              <motion.span
                aria-hidden="true"
                className="absolute top-1/2 -inset-x-[20px] h-[54px] -translate-y-1/2 rounded-[10px] bg-plate/75 backdrop-blur-md"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              />
            )}
          </AnimatePresence>
          <Lockup className={`relative transition-colors duration-300 ${past ? "text-ink" : "text-white"}`} />
        </Link>

        <nav className="hidden items-center gap-[2px] rounded-[10px] bg-nav/85 p-[4px] backdrop-blur-md md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex h-[45px] items-center rounded-[6px] px-[15px] t-mono text-ink-text transition-colors duration-200 hover:bg-nav-hover"
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/app"
            className="inline-flex h-[45px] items-center rounded-[6px] bg-ink px-[15px] t-mono text-white transition-colors duration-200 hover:bg-ink-hover"
          >
            Launch app
          </Link>
        </nav>

        {/* Brief 10: under 768 the navigation collapses into MENU. */}
        <div className="relative md:hidden">
          <button
            type="button"
            onClick={() => setMenu((v) => !v)}
            aria-expanded={menu}
            className="inline-flex h-[45px] items-center rounded-[10px] bg-nav/85 px-[15px] t-mono text-ink-text backdrop-blur-md"
          >
            {menu ? "Close" : "Menu"}
          </button>
          <AnimatePresence>
            {menu && (
              <motion.div
                className="absolute right-0 top-[53px] flex w-[232px] flex-col gap-[2px] rounded-[10px] bg-nav/95 p-[4px] backdrop-blur-md"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                {NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenu(false)}
                    className="inline-flex h-[45px] items-center rounded-[6px] px-[15px] t-mono text-ink-text hover:bg-nav-hover"
                  >
                    {item.label}
                  </Link>
                ))}
                <Link
                  href="/app"
                  onClick={() => setMenu(false)}
                  className="inline-flex h-[45px] items-center rounded-[6px] bg-ink px-[15px] t-mono text-white"
                >
                  Launch app
                </Link>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
