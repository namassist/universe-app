import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Emits `.next/standalone` — a self-contained server with only the modules
   * the app actually reaches. The Docker image copies that instead of the
   * whole workspace `node_modules`, which in a monorepo means the difference
   * between a few hundred megabytes and a couple of gigabytes.
   *
   * Harmless outside Docker: `next dev` ignores it and `next start` still
   * works from a normal build.
   */
  output: "standalone",
};

export default nextConfig;
