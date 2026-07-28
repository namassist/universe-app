/**
 * Seeds the six established roles, their permission rows, a bootstrap
 * superadmin, and the two kiosks that have no admin UI.
 *
 * Idempotent, and deliberately conservative about re-runs: the five editable
 * roles are seeded only when absent, so re-running never clobbers a permission
 * an administrator changed through the Roles screen. `superadmin` is the
 * exception — it is `locked`, its grant on every menu is an invariant rather
 * than a preference, so it is reconciled on every run.
 *
 *   bun run --cwd apps/api db:seed
 */

import { and, eq, notInArray, sql } from "drizzle-orm";
import {
  MENU_SLUGS,
  type AccessMode,
  type DeviceKind,
  type MenuSlug,
  type Scope,
} from "@universe/contracts";

import { hashPassword } from "../auth/password";
import { env } from "../env";
import { db, schema } from "./index";
import { seedMasterData } from "./seed-master";

type RoleSeed = {
  slug: string;
  name: string;
  description: string;
  scope: Scope;
  locked: boolean;
  view: MenuSlug[];
  manage: MenuSlug[];
};

const ROLE_SEEDS: RoleSeed[] = [
  {
    slug: "superadmin",
    name: "Superadmin",
    description: "Akses penuh lintas divisi — semua menu read & write",
    scope: "all",
    locked: true,
    view: [],
    manage: [...MENU_SLUGS],
  },
  {
    slug: "admin",
    name: "Admin",
    description: "Kelola karyawan & roster dalam divisinya",
    scope: "dept",
    locked: false,
    view: [
      "dashboard",
      "display-attendance",
      "display-fleet",
      "fit-to-work",
      "unit-status",
      "fleet-allocation",
      "fleet-setting",
    ],
    manage: ["employees", "roster-data", "roster-revision", "attendance"],
  },
  {
    slug: "manajer",
    name: "Manajer",
    description: "Monitoring divisi + approval revisi roster",
    scope: "dept",
    locked: false,
    view: [
      "dashboard",
      "display-attendance",
      "display-fleet",
      "employees",
      "roster-data",
      "roster-revision",
      "attendance",
      "fit-to-work",
      "unit-status",
      "fleet-allocation",
      "fleet-setting",
    ],
    manage: ["roster-approval"],
  },
  {
    // Scope correction (design D8): `dept` truncated the fleet board — which
    // spans departments — for the very role that owns it.
    slug: "manpower",
    name: "Manpower",
    description: "Konfigurasi display, fleet, dan master operasional",
    scope: "all",
    locked: false,
    view: [],
    manage: [
      "dashboard",
      "display-attendance",
      "display-fleet",
      "display-fitwork",
      "monitoring-fingerprint",
      "unit-status",
      "fleet-allocation",
      "fleet-setting",
      // semua master data
      "database-unit",
      "jenis-unit",
      "model-unit",
      "merk-unit",
      "kelas-unit",
      "simper",
      "kode-simper",
      "departemen",
      "area-kerja",
      "bus",
      "mess",
      "perusahaan",
      "jabatan",
      "running-text",
      "sound",
      "timeline",
      "setting",
    ],
  },
  {
    slug: "medic",
    name: "Medic",
    description: "Fit To Work lintas divisi",
    scope: "all",
    locked: false,
    view: [
      "dashboard",
      "display-attendance",
      "display-fleet",
      "display-fitwork",
      "employees",
    ],
    manage: ["fit-to-work"],
  },
  {
    slug: "user",
    name: "User",
    description: "Akses pribadi — lihat roster & lapor Fit To Work",
    scope: "self",
    locked: false,
    view: [
      "dashboard",
      "employees",
      "roster-data",
      "roster-revision",
      "attendance",
    ],
    manage: ["fit-to-work"],
  },
];

/**
 * Grants for slugs added to `MENU_SLUGS` after an installation was first
 * seeded.
 *
 * `seedRole` leaves an existing editable role alone, which is right — a
 * permission an administrator changed through the Roles screen must survive a
 * re-run. But it also means a role can never gain a *newly introduced* menu,
 * and `manpower` owns every master catalogue by definition. So the new slug is
 * named here and inserted on its own, `ON CONFLICT DO NOTHING`: a role that has
 * no row for it gains one, a role that already has any grant on it keeps
 * whatever that grant is, and no other row is read or written.
 *
 * `superadmin` needs no entry — it is `locked` and reconciled against the whole
 * of `MENU_SLUGS` on every run.
 */
const NEW_SLUG_GRANTS: { slug: MenuSlug; mode: AccessMode; roles: string[] }[] =
  [
    { slug: "kode-simper", mode: "manage", roles: ["manpower"] },
    { slug: "perusahaan", mode: "manage", roles: ["manpower"] },
    { slug: "jabatan", mode: "manage", roles: ["manpower"] },
  ];

/** Kiosks provisioned without an admin UI, by design (D6). */
const DEVICE_SEEDS: { id: string; name: string; kind: DeviceKind }[] = [
  { id: "DSP-W01", name: "TV Fit To Work", kind: "fitwork" },
  { id: "DSP-P01", name: "TV Monitoring Fingerprint", kind: "fingerprint" },
];

/** `none` is never stored — only the slugs a role actually holds. */
function grantsOf(seed: RoleSeed): { menuSlug: MenuSlug; mode: AccessMode }[] {
  return [
    ...seed.view.map((menuSlug) => ({ menuSlug, mode: "view" as const })),
    ...seed.manage.map((menuSlug) => ({ menuSlug, mode: "manage" as const })),
  ];
}

async function seedRole(seed: RoleSeed): Promise<string> {
  const [existing] = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.slug, seed.slug))
    .limit(1);

  if (existing && !seed.locked) {
    console.log(`  role ${seed.slug} — already present, left untouched`);
    return existing.id;
  }

  const [role] = await db
    .insert(schema.roles)
    .values({
      slug: seed.slug,
      name: seed.name,
      description: seed.description,
      scope: seed.scope,
      locked: seed.locked,
    })
    .onConflictDoUpdate({
      target: schema.roles.slug,
      set: {
        name: seed.name,
        description: seed.description,
        scope: seed.scope,
        locked: seed.locked,
      },
    })
    .returning();

  const roleId = role!.id;
  const grants = grantsOf(seed);

  await db
    .insert(schema.rolePermissions)
    .values(grants.map((g) => ({ roleId, menuSlug: g.menuSlug, mode: g.mode })))
    .onConflictDoUpdate({
      target: [schema.rolePermissions.roleId, schema.rolePermissions.menuSlug],
      set: { mode: sql`excluded.mode` },
    });

  // Reconcile rather than accumulate: a slug dropped from the matrix must lose
  // its row, or the role keeps a grant the seed no longer claims.
  await db.delete(schema.rolePermissions).where(
    and(
      eq(schema.rolePermissions.roleId, roleId),
      notInArray(
        schema.rolePermissions.menuSlug,
        grants.map((g) => g.menuSlug)
      )
    )
  );

  console.log(
    `  role ${seed.slug} — ${existing ? "reconciled" : "created"}, ` +
      `${seed.manage.length} manage / ${seed.view.length} view, scope ${seed.scope}`
  );
  return roleId;
}

async function seedNewSlugGrants(roleIds: Map<string, string>): Promise<void> {
  for (const grant of NEW_SLUG_GRANTS) {
    for (const slug of grant.roles) {
      const roleId = roleIds.get(slug);
      if (!roleId) continue;
      const [added] = await db
        .insert(schema.rolePermissions)
        .values({ roleId, menuSlug: grant.slug, mode: grant.mode })
        .onConflictDoNothing()
        .returning({ menuSlug: schema.rolePermissions.menuSlug });
      console.log(
        `  ${slug} → ${grant.slug} — ${added ? `granted ${grant.mode}` : "already decided, left as is"}`
      );
    }
  }
}

async function seedSuperadminAccount(roleId: string): Promise<void> {
  const identifier = env.SUPERADMIN_IDENTIFIER.trim();
  const isEmail = identifier.includes("@");
  const column = isEmail ? schema.users.email : schema.users.nik;

  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(column, identifier))
    .limit(1);

  if (existing) {
    console.log(`  superadmin ${identifier} — already present, password kept`);
    return;
  }

  await db.insert(schema.users).values({
    email: isEmail ? identifier : null,
    nik: isEmail ? null : identifier,
    name: "Superadmin",
    passwordHash: await hashPassword(env.SUPERADMIN_PASSWORD),
    // The bootstrap account is configuration, not a provisioned account: it is
    // not forced through the change-password gate on first login.
    mustChangePassword: false,
    roleId,
    active: true,
  });
  console.log(`  superadmin ${identifier} — created`);
}

async function seedDevices(): Promise<void> {
  const inserted = await db
    .insert(schema.devices)
    .values(DEVICE_SEEDS.map((d) => ({ ...d, active: true })))
    .onConflictDoNothing({ target: schema.devices.id })
    .returning({ id: schema.devices.id });

  const kept = DEVICE_SEEDS.filter((d) => !inserted.some((i) => i.id === d.id));
  for (const d of inserted) console.log(`  device ${d.id} — created`);
  for (const d of kept) console.log(`  device ${d.id} — already present`);
}

export async function seed(): Promise<void> {
  // Held to the same policy it enforces on everyone else — the most privileged
  // account must not be the weakest.
  if (env.SUPERADMIN_PASSWORD.length < env.PASSWORD_MIN_LENGTH) {
    throw new Error(
      `SUPERADMIN_PASSWORD is ${env.SUPERADMIN_PASSWORD.length} characters; ` +
        `PASSWORD_MIN_LENGTH is ${env.PASSWORD_MIN_LENGTH}. Refusing to create ` +
        `a superadmin weaker than the policy it enforces.`
    );
  }

  console.log("[seed] roles");
  const roleIds = new Map<string, string>();
  for (const seedRow of ROLE_SEEDS) {
    roleIds.set(seedRow.slug, await seedRole(seedRow));
  }

  console.log("[seed] grants for newly added menu slugs");
  await seedNewSlugGrants(roleIds);

  console.log("[seed] bootstrap account");
  await seedSuperadminAccount(roleIds.get("superadmin")!);

  console.log("[seed] devices");
  await seedDevices();

  await seedMasterData();

  console.log("[seed] done");
}

if (import.meta.main) {
  await seed();
  process.exit(0);
}
