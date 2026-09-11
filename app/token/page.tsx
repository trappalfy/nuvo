import { Header } from "@/components/landing/Header";
import { ContractAddress } from "@/components/token/ContractAddress";
import { Chip } from "@/components/ui/Chip";

export const metadata = { title: "Token — Nuvo" };

// The official address of the Nuvo token. Filled from env at launch.
export default function TokenPage() {
  return (
    <>
      <Header solid />
      <main className="min-h-[100svh] bg-page">
        <div className="container-nuvo pt-[clamp(132px,18svh,200px)] pb-[clamp(64px,10svh,120px)]">
          <Chip label="Token" tone="light" />
          <h1 className="t-step mt-[28px] max-w-[18ch] text-ink">The $NUVO</h1>
          <p className="mt-[20px] max-w-[620px] text-[19px] leading-[1.55] text-dim">
            This page is the only place the contract address is published. Check it here before
            you trade.
          </p>
          <ContractAddress className="mt-[48px] max-w-[980px]" />
        </div>
      </main>
    </>
  );
}
