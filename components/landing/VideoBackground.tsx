"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionTemplate, useMotionValue, useMotionValueEvent, useScroll } from "motion/react";

// Brief 4: the background of the whole site is one looped clip in a fixed
// layer. On load it shows through a rounded window inset 12px from the window
// edges; over the first 40vh of scroll the window opens to full bleed.
export function VideoBackground() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [posterOnly, setPosterOnly] = useState(true);
  const { scrollY } = useScroll();
  const inset = useMotionValue(12);
  const radius = useMotionValue(24);
  const clipPath = useMotionTemplate`inset(${inset}px round ${radius}px)`;

  // Brief 4: reduced motion and saveData get the poster only.
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    setPosterOnly(reduced || connection?.saveData === true);
  }, []);

  const update = () => {
    const pad = window.innerWidth < 768 ? 8 : 12;
    const range = window.innerHeight * 0.4;
    const p = Math.min(1, Math.max(0, window.scrollY / range));
    inset.set(pad * (1 - p));
    radius.set(24 * (1 - p));
  };

  useMotionValueEvent(scrollY, "change", update);

  useEffect(() => {
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Brief 4: pause while the tab is hidden.
  useEffect(() => {
    const onVisibility = () => {
      const video = videoRef.current;
      if (!video) return;
      if (document.hidden) video.pause();
      else void video.play().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return (
    <motion.div aria-hidden="true" className="fixed inset-0 z-0" style={{ clipPath }}>
      {posterOnly ? (
        <div
          className="h-full w-full bg-cover bg-center"
          style={{ backgroundImage: "url(/video/bg-poster.webp)" }}
        />
      ) : (
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster="/video/bg-poster.webp"
        >
          <source src="/video/bg-loop.webm" type="video/webm" />
          <source src="/video/bg-loop.mp4" type="video/mp4" />
        </video>
      )}
      {/* Brief 4: dimming so white type reads on the light frames, heavier top left. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, rgba(10,22,16,.34) 0%, rgba(10,22,16,.10) 26%, rgba(10,22,16,0) 46%), " +
            "linear-gradient(155deg, rgba(10,22,16,.40) 0%, rgba(10,22,16,.25) 38%, rgba(10,22,16,.12) 70%, rgba(10,22,16,0) 100%)",
        }}
      />
    </motion.div>
  );
}
