// Review screenshots of the app screens at the brief 11 sizes, plus a
// horizontal-overflow check. Works against whatever network is in env.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = "shots/app";
mkdirSync(OUT, { recursive: true });

const pages = [
  { name: "products", path: "/app" },
  { name: "ticker", path: "/app/NVDA?direction=buyLow&target=4" },
  { name: "positions", path: "/app/positions" },
];

const browser = await chromium.launch();
const errors = [];

for (const size of [
  { name: "1905", width: 1905, height: 927 },
  { name: "390", width: 390, height: 844 },
]) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height } });
  // The first-visit acknowledgement is shot once, then skipped.
  await context.addInitScript(() => {
    if (!sessionStorage.getItem("shots.modal")) return;
    localStorage.setItem("nuvo.ack.v1", "1");
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));

  for (const [i, entry] of pages.entries()) {
    await page.goto(`${BASE}${entry.path}`, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    if (i === 0 && size.name === "1905") await page.screenshot({ path: `${OUT}/00-acknowledgement.png` });
    const ack = page.getByRole("button", { name: "I understand" });
    if (await ack.isVisible().catch(() => false)) {
      await ack.click();
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: `${OUT}/${entry.name}-${size.name}.png`, fullPage: size.name === "390" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) console.log(`horizontal scroll: ${entry.path} at ${size.width}`);
  }

  // The RainbowKit modal, to confirm real wallets are offered.
  if (size.name === "1905") {
    await page.goto(`${BASE}/app`, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Connect wallet" }).first().click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/connect-modal.png` });
  }

  await context.close();
}

await browser.close();
console.log(errors.length ? `page errors:\n${[...new Set(errors)].join("\n")}` : "no page errors");
console.log(`shots written to ${OUT}`);
