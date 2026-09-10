import type { Metadata } from "next";
import { AppHeader } from "@/components/app/AppHeader";
import { AppProviders } from "@/components/app/AppProviders";
import { JurisdictionModal } from "@/components/app/JurisdictionModal";
import { Toaster } from "@/components/app/Toaster";
import { WeekStrip } from "@/components/app/WeekStrip";

export const metadata: Metadata = {
  title: "Nuvo — App",
  description: "Dual investment on tokenized stocks, settled every Friday.",
};

// Brief 8: the app is the same tokens on the page ground, without the video.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProviders>
      <Toaster>
        <div className="min-h-[100svh] bg-page">
          <AppHeader />
          <WeekStrip />
          <main className="container-nuvo py-[32px] pb-[96px]">{children}</main>
        </div>
        <JurisdictionModal />
      </Toaster>
    </AppProviders>
  );
}
