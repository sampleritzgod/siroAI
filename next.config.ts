import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Native canvas bindings cannot be bundled into ESM chunks by Turbopack.
  serverExternalPackages: ["@napi-rs/canvas", "unpdf"],
  turbopack: {
    // Keep resolution inside this app when parent directories have other lockfiles.
    root: path.join(__dirname),
  },
};

export default nextConfig;
