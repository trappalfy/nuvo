// Screenshots for review. Brief 11 asks for 1905x927 at the reference
// positions: hero, step 01, footer.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = "shots";
mkdirSync(OUT, { recursive: true });

const shots = [
  { name: "hero", path: "/", y: 0 },
  { name: "step-01", path: "/", y: 1.05 },
  { name: "step-02", path: "/", y: 2.0 },
  { name: "step-03", path: "/", y: 3.0 },
  { name: "products", path: "/", y: 4.1 },
  { name: "footer", path: "/", y: 99 },
];

const browser = await chromium.launch();

for (const size of [
  { name: "", width: 1905, height: 927 },
  { name: "-390", width: 390, height: 844 },
  { name: "-834", width: 834, height: 1194 },
]) {
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
  await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2500);
  for (const shot of shots) {
    if (size.name && !["hero", "step-01", "products", "footer"].includes(shot.name)) continue;
    await page.evaluate((vh) => {
      const target = vh >= 99 ? document.body.scrollHeight : vh * window.innerHeight;
      window.scrollTo({ top: target, behavior: "instant" });
    }, shot.y);
    await page.waitForTimeout(1100);
    await page.screenshot({ path: `${OUT}/${shot.name}${size.name}.png` });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    if (overflow) console.log(`horizontal scroll at ${size.width}: ${shot.name}`);
  }
  await page.close();
}

await browser.close();
console.log("shots written to " + OUT);
