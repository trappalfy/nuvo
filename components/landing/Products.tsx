"use client";

import { motion } from "motion/react";
import { Chip } from "../ui/Chip";
import { SplitButton } from "../ui/SplitButton";

const EASE = [0.22, 1, 0.36, 1] as const;

const PRODUCTS = [
  {
    name: "Buy Low",
    accent: "bg-lime",
    rows: [
      ["You deposit", "USDG"],
      ["If Friday closes at your price", "the stock at your price + premium"],
      ["If it doesn't", "your USDG + premium"],
    ],
  },
  {
    name: "Sell High",
    accent: "bg-sand",
    rows: [
      ["You deposit", "your stock"],
      ["If Friday closes at your price", "USDG at your price + premium"],
      ["If it doesn't", "your stock + premium"],
    ],
  },
];

// Brief 6.4: the light section. Page colour, 40px bottom corners, it rides over
// the footer. No premium numbers here.
export function Products() {
  return (
    <section id="products" className="relative scroll-mt-[84px] overflow-hidden rounded-b-[40px] bg-page">
      <div className="container-nuvo pt-[clamp(72px,12svh,120px)]">
        <Chip label="Products" tone="light" />
        <h2 className="t-step mt-[28px] max-w-[18ch] text-ink">Two products. One decision.</h2>

        <div className="mt-[56px] grid gap-[16px] lg:grid-cols-2">
          {PRODUCTS.map((product, i) => (
            <motion.article
              key={product.name}
              className="rounded-[16px] bg-white p-[32px]"
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.7, delay: i * 0.1, ease: EASE }}
            >
              <div className="flex items-center gap-[10px]">
                <span className={`block size-[10px] rounded-[2px] ${product.accent}`} aria-hidden="true" />
                <h3 className="text-[26px] leading-none tracking-[-0.03em] text-ink">{product.name}</h3>
              </div>

              <dl className="mt-[28px] flex flex-col">
                {product.rows.map(([label, value]) => (
                  <div key={label} className="border-t border-[#E4E6E2] py-[20px] last:pb-0">
                    <dt className="t-mono-sm text-dim">{label}</dt>
                    <dd className="mt-[10px] text-[20px] leading-[1.3] tracking-[-0.02em] text-ink">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </motion.article>
          ))}
        </div>

        <p className="mt-[24px] text-[15px] leading-[1.5] text-dim">
          Your deposit is locked until settlement.
        </p>

        <div className="mt-[40px] pb-[clamp(64px,9svh,104px)]">
          <SplitButton href="/app" label="Launch app" full="mobile" />
        </div>
      </div>

      {/* Brief 6.5: the bottom band of the light section is what shows above the footer. */}
      <div className="h-[clamp(64px,9svh,108px)] rounded-b-[40px] bg-strip" aria-hidden="true" />
    </section>
  );
}
