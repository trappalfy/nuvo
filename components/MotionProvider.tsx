"use client";

import { MotionConfig } from "motion/react";

// Brief 7: with reduced motion on, only fades are left — MotionConfig drops
// every transform for us.
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
