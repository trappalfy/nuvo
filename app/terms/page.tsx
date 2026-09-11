import Link from "next/link";
import { Lockup } from "@/components/ui/Mark";

export const metadata = { title: "Terms | Nuvo" };

// Brief 8 / 12: a placeholder page. The legal copy is still an open question.
export default function TermsPage() {
  return (
    <main className="min-h-[100svh] bg-page">
      <div className="container-nuvo py-[64px]">
        <Link href="/" className="inline-flex text-ink" aria-label="Nuvo, home">
          <Lockup />
        </Link>
        <h1 className="t-claim mt-[56px] max-w-[700px] text-ink">Terms of use</h1>
        <p className="mt-[24px] max-w-[700px] text-[19px] leading-[1.55] text-dim">
          The terms of use are being finalised and will be published here before subscriptions
          open.
        </p>
        <Link href="/" className="t-mono mt-[40px] inline-flex text-ink hover:underline">
          Back to the site
        </Link>
      </div>
    </main>
  );
}
