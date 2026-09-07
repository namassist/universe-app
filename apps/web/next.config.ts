import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

/**
 * Read rather than `import pkg from "./package.json"`: a JSON import is
 * inlined whole into whatever bundle reaches it, so the browser would receive
 * the entire dependency manifest to display four characters of version.
 */
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string };

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

  /**
   * Resolved once at build time and inlined as a literal, so the number the
   * login page shows is the number of the build that is serving it — there is
   * no runtime lookup to get out of step with.
   */
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
};

export default nextConfig;
