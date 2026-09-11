import Link from "next/link";
import { Lockup } from "@/components/ui/Mark";

export const metadata = { title: "Not found | Nuvo" };

export default function NotFound() {
  return (
    <main className="min-h-[100svh] bg-page">
      <div className="container-nuvo py-[64px]">
        <Link href="/" className="inline-flex text-ink" aria-label="Nuvo, home">
          <Lockup />
        </Link>
        <h1 className="t-claim mt-[56px] max-w-[700px] text-ink">This page does not exist.</h1>
        <p className="mt-[24px] max-w-[700px] text-[19px] leading-[1.55] text-dim">
          The link may be old or mistyped.
        </p>
        <div className="mt-[40px] flex flex-wrap gap-[24px]">
          <Link href="/" className="t-mono inline-flex text-ink hover:underline">
            Back to the site
          </Link>
          <Link href="/app" className="t-mono inline-flex text-ink hover:underline">
            Open the app
          </Link>
        </div>
      </div>
    </main>
  );
}
