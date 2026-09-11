import path from "node:path";
import type { NextConfig } from "next";

// Security headers on every route. The app asks for wallet signatures, so it
// must not be framed by another site (clickjacking). A script CSP is left out:
// the wallet stack loads and connects to hosts that differ per wallet.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  images: { formats: ["image/webp"] },
  devIndicators: false,
  poweredByHeader: false,
  headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // This app sits inside the Recess folder, which has its own lockfile. Pin the
  // root so Turbopack does not walk up into it.
  turbopack: { root: path.resolve(import.meta.dirname) },
};

export default nextConfig;
