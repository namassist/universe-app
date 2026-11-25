/**
 * The seeded roles that are decisions rather than data entry. A seed only
 * creates a role that is absent, so whatever ships here is what every new
 * installation, and every installation that runs `db:bootstrap` after the
 * role is added, starts from.
 */

import { expect, test } from "bun:test";

import { ROLE_SEEDS } from "./seed";

test("Pengawas Lapangan reads the muster across the site and changes nothing", () => {
  // Owner, 2026-10-17 (docs/prd.md, Mobile app → Pengawas Lapangan).
  const pengawas = ROLE_SEEDS.find((r) => r.slug === "pengawas-lapangan");
  expect(pengawas).toBeDefined();
  expect(pengawas!.scope).toBe("all");
  expect(pengawas!.locked).toBe(false);
  expect(pengawas!.manage).toEqual([]);
  const view: string[] = [...pengawas!.view];
  expect(view.sort()).toEqual(
    [
      "dashboard",
      "fleet-allocation",
      "notifications",
      "report",
      "scan-id",
      "unit-status",
    ].sort()
  );
});
