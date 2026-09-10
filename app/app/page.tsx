import Link from "next/link";
import { Lockup } from "@/components/ui/Mark";

export const metadata = { title: "App — Nuvo" };

// Placeholder until the app screens from brief 8 are built in the next pass.
export default function AppPage() {
  return (
    <main className="min-h-[100svh] bg-page">
      <div className="container-nuvo py-[64px]">
        <Link href="/" className="inline-flex text-ink" aria-label="Nuvo, home">
          <Lockup />
        </Link>
        <h1 className="t-claim mt-[56px] max-w-[700px] text-ink">Products</h1>
        <p className="mt-[24px] max-w-[700px] text-[19px] leading-[1.55] text-dim">
          The app screens — the ticker ladder, subscription and positions — come next. The landing
          is the part under review.
        </p>
        <Link href="/" className="t-mono mt-[40px] inline-flex text-ink hover:underline">
          Back to the site
        </Link>
      </div>
    </main>
  );
}
