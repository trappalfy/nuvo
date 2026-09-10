import { Footer } from "@/components/landing/Footer";
import { Header } from "@/components/landing/Header";
import { Hero } from "@/components/landing/Hero";
import { Products } from "@/components/landing/Products";
import { Steps } from "@/components/landing/Steps";
import { VideoBackground } from "@/components/landing/VideoBackground";

export default function Page() {
  return (
    <>
      <VideoBackground />
      <Header />

      <main id="main" className="relative z-20">
        <Hero />
        <Steps />
        <Products />
      </main>

      {/* Brief 6.5: the scroll room the fixed footer is uncovered in. */}
      <div className="hidden h-[100svh] lg:block" aria-hidden="true" />

      <Footer />
    </>
  );
}
