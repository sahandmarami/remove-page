import type { NextConfig } from "next";

/**
 * Two build modes:
 * - Default (sandbox preview): standalone server, full /api routes.
 * - STATIC_EXPORT=1: pure static export for GitHub Pages hosting.
 *   NEXT_PUBLIC_BASE_PATH must match the repo name (e.g. "/spriteforge").
 */
const isStatic = process.env.STATIC_EXPORT === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  ...(isStatic
    ? {
        output: "export",
        // dedicated distDir so the sandbox dev server's .next is never clobbered;
        // with a custom distDir the static site is written into it directly
        distDir: ".next-export",
        basePath,
        assetPrefix: basePath || undefined,
        images: { unoptimized: true },
      }
    : {
        output: "standalone",
      }),
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
