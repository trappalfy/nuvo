// Brief 11.3: walk the whole mock path — connect, pick a product, subscribe,
// fast-forward the week, see both outcomes, claim — and shoot each step.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = "shots/app";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1905, height: 927 } });
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(`${BASE}/app`, { waitUntil: "load" });
await page.waitForTimeout(1200);
await shot("01-jurisdiction-modal");

await page.getByRole("button", { name: "I understand" }).click();
await page.waitForTimeout(400);
await shot("02-products-disconnected");

await page.getByRole("button", { name: "Connect wallet" }).click();
await page.waitForTimeout(600);
await shot("03-products-connected");

await page.getByRole("tab", { name: "Sell High" }).click();
await page.waitForTimeout(600);
await shot("04-products-sell-high");
await page.getByRole("tab", { name: "Buy Low" }).click();
await page.waitForTimeout(500);

await page.goto(`${BASE}/app/NVDA?direction=buyLow&target=4`, { waitUntil: "load" });
await page.waitForTimeout(1200);
await shot("05-ticker-empty-amount");

const amount = page.getByLabel("Amount in USDG");
await amount.fill("50");
await page.waitForTimeout(700);
await shot("06-ticker-below-minimum");

await amount.fill("999999");
await page.waitForTimeout(700);
await shot("07-ticker-not-enough");

await amount.fill("1000");
await page.waitForTimeout(900);
await shot("08-ticker-needs-approve");

await page.getByRole("button", { name: "Approve USDG" }).click();
await page.waitForTimeout(2600);
await shot("09-ticker-approved");

await page.getByRole("button", { name: "Subscribe" }).click();
await page.waitForTimeout(900);
await shot("10-ticker-confirming");
await page.waitForTimeout(2200);
await shot("11-ticker-subscribed");

// Two more positions: MSFT converts at settlement and TSLA does not, so the
// Settled tab shows both outcomes.
await page.goto(`${BASE}/app/MSFT?direction=buyLow&target=4`, { waitUntil: "load" });
await page.waitForTimeout(1000);
await page.getByLabel("Amount in USDG").fill("1000");
await page.waitForTimeout(900);
await page.getByRole("button", { name: "Approve USDG" }).click();
await page.waitForTimeout(2400);
await page.getByRole("button", { name: "Subscribe" }).click();
await page.waitForTimeout(2400);

await page.goto(`${BASE}/app/TSLA?direction=sellHigh&target=2`, { waitUntil: "load" });
await page.waitForTimeout(1000);
await page.getByLabel("Amount in TSLA").fill("1");
await page.waitForTimeout(900);
await page.getByRole("button", { name: "Approve TSLA" }).click();
await page.waitForTimeout(2400);
await page.getByRole("button", { name: "Subscribe" }).click();
await page.waitForTimeout(2400);

await page.goto(`${BASE}/app/positions`, { waitUntil: "load" });
await page.waitForTimeout(1200);
await shot("12-positions-active");

await page.getByRole("button", { name: "Fast-forward week" }).click();
await page.waitForTimeout(900);
await page.getByRole("tab", { name: "Settled" }).click();
await page.waitForTimeout(600);
await shot("13-positions-settled");

await page.getByRole("button", { name: "Claim" }).first().click();
await page.waitForTimeout(2400);
await shot("14-positions-claimed");

await page.getByRole("tab", { name: "History" }).click();
await page.waitForTimeout(500);
await shot("15-positions-history");

// The closed window, forced through the demo control: the real schedule shuts
// subscriptions from Thursday 4:00 PM ET to Monday.
await page.getByLabel("Demo subscription window").selectOption("closed");
await page.waitForTimeout(500);
await page.goto(`${BASE}/app/NVDA?direction=buyLow&target=4`, { waitUntil: "load" });
await page.waitForTimeout(1400);
await shot("16-ticker-subscriptions-closed");
await page.getByLabel("Demo subscription window").selectOption("open");
await page.waitForTimeout(400);

for (const size of [
  { name: "390", width: 390, height: 844 },
  { name: "834", width: 834, height: 1194 },
]) {
  const small = await browser.newPage({ viewport: { width: size.width, height: size.height } });
  await small.goto(`${BASE}/app`, { waitUntil: "load" });
  await small.waitForTimeout(1200);
  await small.getByRole("button", { name: "I understand" }).click();
  await small.waitForTimeout(400);
  await small.screenshot({ path: `${OUT}/products-${size.name}.png` });
  await small.goto(`${BASE}/app/NVDA?direction=buyLow&target=4`, { waitUntil: "load" });
  await small.waitForTimeout(1200);
  await small.screenshot({ path: `${OUT}/ticker-${size.name}.png`, fullPage: true });
  const overflow = await small.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  if (overflow) console.log(`horizontal scroll at ${size.width}`);
  await small.close();
}

await browser.close();
console.log(errors.length ? `page errors:\n${[...new Set(errors)].join("\n")}` : "no page errors");
console.log(`shots written to ${OUT}`);
