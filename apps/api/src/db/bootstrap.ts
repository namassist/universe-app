/**
 * Prepares an empty database for a real installation — roles, their grants,
 * the superadmin, and the two kiosks with no admin UI. No sample master data
 * and no invented workforce; those come from `db:seed`, which is for
 * development only.
 *
 * Run once after the migrations, on a fresh deployment:
 *
 *   bun run --cwd apps/api db:bootstrap
 *
 * Safe to run again: it reconciles the locked superadmin role and leaves the
 * editable roles as an administrator left them.
 */

import { bootstrap } from "./seed";

await bootstrap();
console.log("[seed] bootstrap done");
process.exit(0);
