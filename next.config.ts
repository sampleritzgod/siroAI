import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    // Keep resolution inside this app when parent directories have other lockfiles.
    root: path.join(__dirname),
  },
};

export default nextConfig;
