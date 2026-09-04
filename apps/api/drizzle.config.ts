import { defineConfig } from "drizzle-kit";

/**
 * The same store the application picks, by the same rule (`src/env.ts`).
 *
 * Spelled out here rather than imported because drizzle-kit loads this file on
 * its own, outside the app's boot. `NODE_ENV=test bun run db:migrate` is how
 * the test database is brought up to the current schema.
 */
const url =
  (process.env.NODE_ENV === "test" && process.env.TEST_DATABASE_URL) ||
  process.env.DATABASE_URL!;

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
});
