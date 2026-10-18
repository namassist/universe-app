/**
 * Write the mobile app's OpenAPI document to `apps/mobile/` — the file its
 * Kotlin client is generated from (Gradle, `apps/mobile/README.md`).
 *
 *   bun run openapi:mobile
 *
 * Run it after changing a route the app calls; `src/mobile-openapi.test.ts`
 * fails until the committed copy matches what the code generates.
 */

import { join } from "node:path";

import { buildMobileSpec, MOBILE_SPEC_PATH } from "../src/mobile-openapi";

const root = join(import.meta.dir, "../../..");
const target = join(root, MOBILE_SPEC_PATH);

await Bun.write(
  target,
  `${JSON.stringify(await buildMobileSpec(), null, 2)}\n`
);
// The repo's own formatter, so `format:check` stays clean.
const prettier = Bun.spawnSync(["bunx", "prettier", "--write", target], {
  cwd: root,
});
if (prettier.exitCode !== 0) {
  console.error(prettier.stderr.toString());
  process.exit(1);
}
console.log(`wrote ${MOBILE_SPEC_PATH}`);
process.exit(0);
