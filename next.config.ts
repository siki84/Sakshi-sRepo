import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module; must be required at runtime, not bundled.
  serverExternalPackages: ["better-sqlite3"],
  // Keep the dev badge clear of the sticky Save bar on mobile.
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
