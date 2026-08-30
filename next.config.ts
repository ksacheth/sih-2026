import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Dockerfile runner stage copies .next/standalone, which only exists
  // with this output mode.
  output: "standalone",
};

export default nextConfig;
