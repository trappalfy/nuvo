import Link from "next/link";
import { Lockup } from "@/components/ui/Mark";

export const metadata = { title: "Risk — Nuvo" };

// Brief 8 / 12: a placeholder page. The legal copy is still an open question.
export default function RiskPage() {
  return (
    <main className="min-h-[100svh] bg-page">
      <div className="container-nuvo py-[64px]">
        <Link href="/" className="inline-flex text-ink" aria-label="Nuvo, home">
          <Lockup />
        </Link>
        <h1 className="t-claim mt-[56px] max-w-[700px] text-ink">Risk disclosure</h1>
        <p className="mt-[24px] max-w-[700px] text-[19px] leading-[1.55] text-dim">
          Placeholder. Dual investment converts your deposit into the other asset when the Friday
          reference reaches your price: with Buy Low you can end up holding the stock above the
          market, with Sell High you can miss any move past your price. The full disclosure will
          replace this page before launch.
        </p>
        <Link href="/" className="t-mono mt-[40px] inline-flex text-ink hover:underline">
          Back to the site
        </Link>
      </div>
    </main>
  );
}
