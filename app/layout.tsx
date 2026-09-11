import type { Metadata, Viewport } from "next";
import { Inter_Tight, Geist_Mono } from "next/font/google";
import "./globals.css";
import { MotionProvider } from "@/components/MotionProvider";
import { SITE_URL } from "@/lib/nuvo/config";

// Brief 2: Inter Tight for headings and body, Geist Mono for labels and buttons.
const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-inter-tight",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["500"],
  variable: "--font-geist-mono",
  display: "swap",
});

const TITLE = "Nuvo | Name your price. Get paid to wait.";
const DESCRIPTION =
  "Dual investment on tokenized stocks. Buy below the market or sell above it, with a premium either way.";

// Preview images need absolute links. Without NEXT_PUBLIC_SITE_URL they point at
// the local server, which is fine until the site has a domain.
const siteUrl = (() => {
  try {
    return new URL(SITE_URL || "http://localhost:3100");
  } catch {
    return new URL("http://localhost:3100");
  }
})();

// The icon, apple-icon and opengraph-image files in app/ carry the logo; Next
// links them from here.
export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: "Nuvo", type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: "#222F30",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${interTight.variable} ${geistMono.variable}`}>
      <body>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
