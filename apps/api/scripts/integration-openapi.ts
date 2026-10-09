/**
 * Write the integration API's OpenAPI document to `docs/` — the file handed
 * to other services' teams (Postman, Insomnia, client generators).
 *
 *   bun run openapi:integration
 *
 * Run it after changing an integration route; `integrations/openapi.test.ts`
 * fails until the committed copy matches what the code generates.
 */

import { join } from "node:path";

import {
  buildIntegrationSpec,
  INTEGRATION_SPEC_PATH,
} from "../src/integrations/openapi";

const root = join(import.meta.dir, "../../..");
const target = join(root, INTEGRATION_SPEC_PATH);

await Bun.write(
  target,
  `${JSON.stringify(await buildIntegrationSpec(), null, 2)}\n`
);
// The repo's own formatter, so `format:check` stays clean.
const prettier = Bun.spawnSync(["bunx", "prettier", "--write", target], {
  cwd: root,
});
if (prettier.exitCode !== 0) {
  console.error(prettier.stderr.toString());
  process.exit(1);
}
console.log(`wrote ${INTEGRATION_SPEC_PATH}`);
process.exit(0);
