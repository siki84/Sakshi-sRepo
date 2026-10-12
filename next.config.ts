import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module; must be required at runtime, not bundled.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
