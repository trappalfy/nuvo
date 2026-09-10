import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { formats: ["image/webp"] },
  devIndicators: false,
  // This app sits inside the Recess folder, which has its own lockfile. Pin the
  // root so Turbopack does not walk up into it.
  turbopack: { root: path.resolve(import.meta.dirname) },
};

export default nextConfig;
