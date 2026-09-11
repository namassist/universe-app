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

import { and, eq, ne, notInArray, sql } from "drizzle-orm";
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
import { ORGANISATION, seedMasterData, workforce } from "./seed-master";

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
    manage: ["employees", "roster-data", "attendance"],
  },
  {
    slug: "manajer",
    name: "Manajer",
    description: "Monitoring divisi",
    scope: "dept",
    locked: false,
    view: [
      "dashboard",
      "display-attendance",
      "display-fleet",
      "employees",
      "roster-data",
      "attendance",
      "fit-to-work",
      "unit-status",
      "fleet-allocation",
      "fleet-setting",
    ],
    manage: ["roster-data"],
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
      "allocation-priority",
      // semua master data
      "database-unit",
      "jenis-unit",
      "model-unit",
      "merk-unit",
      "kelas-unit",
      "simper",
      "kode-simper",
      "departemen",
      "bus",
      "mess",
      "perusahaan",
      "jabatan",
      "running-text",
      "sound",
      "timeline",
      "mesin-fingerprint",
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
    view: ["dashboard", "employees", "roster-data", "attendance"],
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
    { slug: "mesin-fingerprint", mode: "manage", roles: ["manpower"] },
    /* Manpower configures the fleet, and the order vacancies are filled in is
       part of configuring it. Nobody else gains it: the two `dept`-scoped
       roles read the fleet screens but do not set the yard's own rules. */
    { slug: "allocation-priority", mode: "manage", roles: ["manpower"] },
    /* Manpower runs the muster and is who a failed board is addressed to.
     Superadmin needs no row — its grants are reconciled to every slug. */
    { slug: "notifications", mode: "manage", roles: ["manpower"] },
    /* The raw tap monitor answers "did he tap at all, and where", which is a
     manpower question during a muster. Read-only: there is nothing on the
     screen to change, only taps to look at and export. */
    { slug: "monitoring-tap", mode: "view", roles: ["manpower"] },
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

/* ------------------------------------------------------------- accounts */

/** `Adi Santoso` → `adi.santoso`, which is what the site's addresses look like. */
const emailLocal = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "");

/**
 * The cross-cutting roles, and the post each is filled from.
 *
 * `manpower` and `medic` are scoped `all` — they read every department of every
 * company — so one account of each is the whole demonstration: a second would
 * see precisely the same rows, and two identical viewpoints in a sample dataset
 * only invite the question of how they differ.
 *
 * They are still filled from a real employee, for the reason `seedAccounts`
 * gives below. Which company that person happens to work for does not narrow
 * what they see; their scope is what makes them cross-cutting, not their desk.
 */
const CROSS_CUTTING: {
  role: string;
  companyCode: string;
  position: string;
}[] = [
  { role: "manpower", companyCode: "UDU", position: "MANPOWER OFFICER" },
  { role: "medic", companyCode: "UDU", position: "PARAMEDIC" },
];

/**
 * One account per department for the roles a department needs, plus one each
 * for the two that belong to no department.
 *
 * The rule is that every department has an `admin`. Two more follow from it
 * rather than from taste: an `admin` may upload a roster and submit a revision
 * but not decide one — `roster-approval` is the `manajer`'s grant — so a
 * department seeded with only an admin has a revision queue nobody can empty.
 * And a `self`-scoped account is the only way to see what an operator sees, so
 * each mining department gets one.
 *
 * `manpower` and `medic` sit outside that loop because they sit outside the
 * department: one of each, `all`-scoped, seeded from `CROSS_CUTTING`.
 *
 * Accounts are matched to *people*, not invented: the identifier is the
 * employee's own NIK, which is what makes the scope resolve at all. An account
 * whose NIK is not in the register is the failure documented in
 * `docs/known-issues.md`, and seeding one would be manufacturing it. That holds
 * even for the `all`-scoped two, whose scope resolves without a NIK — an
 * account nobody can look up in the register is a login, not a person.
 *
 * `mustChangePassword` is false here, unlike a provisioned account. These exist
 * to be logged into immediately; a gate on first login would be a step between
 * `db:seed` and the thing the seed was run to demonstrate.
 */
async function seedAccounts(roleIds: Map<string, string>): Promise<void> {
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.users);
  // The bootstrap superadmin is the only account a fresh database holds, and it
  // is seeded above. Anything beyond it means accounts exist that this seed did
  // not create, and inventing more beside them is not its business.
  if (count > 1) {
    console.log(
      `  accounts — ${count} users already present, sample accounts skipped`
    );
    return;
  }

  const people = workforce();
  const passwordHash = await hashPassword(env.DEFAULT_USER_PASSWORD);
  const rows: (typeof schema.users.$inferInsert)[] = [];

  const account = (
    person: (typeof people)[number] | undefined,
    roleSlug: string
  ) => {
    const roleId = roleIds.get(roleSlug);
    if (!person || !roleId) return;
    rows.push({
      nik: person.nik,
      email: `${emailLocal(person.name)}.${person.nik.slice(-4)}@${person.companyDomain}`,
      name: person.name,
      passwordHash,
      mustChangePassword: false,
      roleId,
      active: true,
    });
  };

  for (const company of ORGANISATION) {
    for (const department of company.departments) {
      const crew = people.filter(
        (p) =>
          p.companyCode === company.code && p.department === department.name
      );
      const admin = crew.find((p) => p.departmentAdmin);
      // The department's second post — a foreman, a dispatcher, a recruiter.
      // Whoever it is, they are not the same person as the admin, which is the
      // only property the approval flow needs from them.
      const manager = crew.find(
        (p) => p.position === department.positions[1]?.name
      );
      const operator = crew.find((p) =>
        department.positions.some(
          (pos) => pos.operator === true && pos.name === p.position
        )
      );

      account(admin, "admin");
      account(manager, "manajer");
      account(operator, "user");
    }
  }

  // Outside the loop because these two are outside the department: one each,
  // reaching every company. The first holder of the post rather than a named
  // person, so adding a company or renaming a department cannot leave this
  // pointing at nobody.
  for (const cross of CROSS_CUTTING) {
    const holder = people.find(
      (p) =>
        p.companyCode === cross.companyCode && p.position === cross.position
    );
    if (!holder)
      throw new Error(
        `Seed expects a "${cross.position}" in ${cross.companyCode} to fill the ` +
          `${cross.role} account; the organisation tree no longer has one`
      );
    account(holder, cross.role);
  }

  if (rows.length) await db.insert(schema.users).values(rows);
  const per = (slug: string) =>
    rows.filter((r) => r.roleId === roleIds.get(slug)).length;
  console.log(
    `  accounts — ${rows.length} created ` +
      `(${per("admin")} admin, ${per("manajer")} manajer, ${per("user")} user, ` +
      `${per("manpower")} manpower, ${per("medic")} medic)`
  );
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

/**
 * Empty the workforce so the seed can write it again — opt-in, and never a
 * side effect of `db:seed`.
 *
 * Every guard in this file exists because a seed that overwrites is a seed
 * nobody can safely run twice. This is the one door out, and it is deliberately
 * awkward to open: `db:seed:fresh`, which sets `SEED_FRESH`. It refuses on
 * `NODE_ENV=production` outright, because no argument for wiping a production
 * register survives being written down.
 *
 * The order is the reference graph read backwards. `restrict` everywhere means
 * a wrong order does not corrupt anything — it simply fails — but a failure
 * halfway through leaves the database in a state neither the old seed nor the
 * new one describes, so the order is spelled out rather than discovered.
 *
 * The bootstrap superadmin survives: it is the account that gets an operator
 * back into a misconfigured installation, and deleting it to re-create it a
 * moment later is a window with nothing to gain.
 */
async function wipeWorkforce(): Promise<void> {
  if (process.env.NODE_ENV === "production")
    throw new Error("SEED_FRESH refuses to run with NODE_ENV=production");

  const superadmin = env.SUPERADMIN_IDENTIFIER.trim();
  const isEmail = superadmin.includes("@");

  console.log("[seed] SEED_FRESH — emptying the workforce first");

  // Roster first: its days reference employees, its documents and revisions
  // reference users, and all of it is derived data that the register outlives.
  await db.delete(schema.rosterRevisionItems);
  await db.delete(schema.rosterRevisions);
  await db.delete(schema.rosterDays);
  await db.delete(schema.rosterDocuments);

  // Plan pairings reference employees and units both, so they go first.
  await db.delete(schema.fleetPlanSlots);
  await db.delete(schema.employeeSkills);
  await db.delete(schema.employees);
  await db
    .delete(schema.users)
    .where(
      isEmail
        ? ne(schema.users.email, superadmin)
        : ne(schema.users.nik, superadmin)
    );

  // Units point at departments, so they go before the catalogues do. They are
  // sample data themselves and are re-seeded in the same run — and the bus
  // schedule and the fleets point at *them*, which are the references the
  // graph above the workforce still holds.
  await db.delete(schema.fleetUnits);
  await db.delete(schema.fleets);
  await db.delete(schema.busSchedules);
  await db.delete(schema.units);

  await db.delete(schema.positions);
  await db.delete(schema.departments);
  await db.delete(schema.companies);

  console.log("  workforce, catalogues, sample fleet, and roster cleared");
}

/**
 * Everything a *real* installation needs and nothing it does not: the six
 * roles, their grants, the superadmin who can log in and create everyone else,
 * and the two kiosks that have no admin UI.
 *
 * Split out from `seed()` because the rest of that function is sample data.
 * On a fresh production database an operator has to be able to log in, and
 * the only way to do that was to run a seed that also inserts an invented
 * workforce — real names would then sit beside fictional ones in the same
 * employee register, which is the kind of mess that is discovered late and
 * cleaned up by hand.
 *
 * Idempotent, like `seed()`: re-running reconciles the locked superadmin role
 * and leaves the five editable ones alone.
 */
export async function bootstrap(): Promise<Map<string, string>> {
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

  return roleIds;
}

/**
 * A first allocation order, so nobody has to rank 55 pairs from an empty
 * screen before the engine does anything useful.
 *
 * **Computed from the register, not written out by hand.** A hardcoded list
 * would miss on spelling alone — this site carries both `FUEL TRUCK 20KL` and
 * `FUELTRUCK20KL` — and would say nothing at all about a class somebody adds
 * next month. Reading the pairs and sorting them means any register gets an
 * order, and a class nobody anticipated still lands somewhere defensible.
 *
 * It is a **starting point, not an answer**. The order between types is a
 * judgement about this kind of mine (a digger with no operator stops the fleet
 * it feeds, so digging outranks hauling, and hauling outranks everything that
 * supports it); the order inside a type is read off the names, which carry
 * size well enough — tonnes for trucks, feet for graders, kilolitres for
 * tankers, words for diggers. Both are meant to be corrected on the screen.
 */
/**
 * One site's order of allocation, description by description.
 *
 * **Development only** (owner, 2026-09-09). A site sets its own order on the
 * Prioritas Alokasi screen; this list makes a development database useful
 * immediately, and is not called from `bootstrap`, which is what a real
 * installation runs.
 *
 * Written out rather than derived, because it is a decision and not a
 * measurement — and because no rule could produce it. It interleaves types:
 * REARDUMP100T, DUMPTRUCK100T, REARDUMP60T, DUMPTRUCK60T. That interleaving is
 * also the plainest evidence the ordering has to be one list rather than one
 * per type.
 *
 * The excavators are where the description earns its place: the class said
 * BIGDIGGER / MEDIUMDIGGER / SMALLDIGGER, and the description says the tonnage
 * those three were hiding.
 *
 * `"0"` is in the list on purpose, and where the owner put it — it is the
 * register's way of saying a machine's details are not filled in, and such a
 * machine is worth crewing after everything the yard can name but before the
 * vehicles that move people. Leaving it out would have sorted it last by
 * accident rather than by decision.
 */
const DESCRIPTION_ORDER = [
  "EXCAVATOR250T",
  "EXCAVATOR200T",
  "EXCAVATOR120T",
  "EXCAVATOR80T",
  "EXCAVATOR40T",
  "EXCAVATOR30T",
  "EXCAVATOR20T",
  "WHEELEXCAVATOR20T",
  "REARDUMP100T",
  "DUMPTRUCK100T",
  "REARDUMP60T",
  "DUMPTRUCK60T",
  "DUMPTRUCK40T",
  "DUMPTRUCK30T",
  "BULLDOZER60T",
  "BULLDOZER38T",
  "BULLDOZER20T",
  "GRADER16FT",
  "GRADER14FT",
  "ROTARYBLASTHOLEDRILL",
  "0",
  "FORKLIFT 30T DP30ND",
  "LOWBOY RENAULT KR500 - CAP 120 TON",
  "LOWBOY FAW - CAP 80 TON",
  "SERVICE/LUBETRUCK",
  "FUELTRUCK20KL",
  "WATERTRUCK20KL",
  "WATER TRUCK16KL",
  "WATER TRUCK50KL",
  "CRANETRUCK10T",
  "MANHAUL 42 SEATS",
  "MANHAUL 45 SEATS",
  "AMBULANCE TRITON 2.5L SC HDX-L (4X4) M/T",
  "BUS MITSUBISHI / CANTER F84G BC N MT",
  "MITSUBISHICOLTDIESELFE71LONGBC(4X4)M/TBUS",
];

/**
 * A first allocation order, so nobody ranks the descriptions from an empty
 * screen.
 *
 * Runs **only when the table is empty**: an order somebody has adjusted on the
 * screen is theirs, and a re-run must not quietly put the yard back to the day
 * it was installed.
 */
async function seedAllocationPriority(): Promise<void> {
  const held = await db
    .select({ id: schema.allocationPriorities.id })
    .from(schema.allocationPriorities)
    .limit(1);
  if (held.length) {
    console.log("  prioritas alokasi — sudah diatur, dilewati");
    return;
  }

  const rows = await db
    .selectDistinct({ description: schema.units.description })
    .from(schema.units)
    .where(eq(schema.units.active, true));

  if (!rows.length) {
    console.log("  prioritas alokasi — belum ada unit aktif");
    return;
  }

  /* A description nobody listed sorts after every listed one rather than
     first: a machine this file has never heard of is not the site's first
     priority, and an empty description least of all. */
  const rank = (description: string) => {
    const at = DESCRIPTION_ORDER.indexOf(description);
    return at === -1 ? DESCRIPTION_ORDER.length : at;
  };

  const ordered = rows.sort(
    (a, b) =>
      rank(a.description) - rank(b.description) ||
      /* Unlisted descriptions among themselves, so two runs cannot disagree. */
      a.description.localeCompare(b.description)
  );

  await db.insert(schema.allocationPriorities).values(
    ordered.map((row, index) => ({
      description: row.description,
      rank: index + 1,
    }))
  );
  console.log(`  prioritas alokasi — ${ordered.length} deskripsi diurutkan`);
}

export async function seed(): Promise<void> {
  if (process.env.SEED_FRESH === "1") {
    // Checked before the wipe rather than inside bootstrap(): refusing to
    // create a weak superadmin *after* emptying the workforce would leave the
    // database worse than it was found.
    if (env.SUPERADMIN_PASSWORD.length < env.PASSWORD_MIN_LENGTH)
      throw new Error(
        `SUPERADMIN_PASSWORD is ${env.SUPERADMIN_PASSWORD.length} characters; ` +
          `PASSWORD_MIN_LENGTH is ${env.PASSWORD_MIN_LENGTH}. Refusing to create ` +
          `a superadmin weaker than the policy it enforces.`
      );
    await wipeWorkforce();
  }

  const roleIds = await bootstrap();

  await seedMasterData();

  console.log("[seed] prioritas alokasi");
  await seedAllocationPriority();

  console.log("[seed] accounts");
  await seedAccounts(roleIds);

  console.log("[seed] done");
}

if (import.meta.main) {
  await seed();
  process.exit(0);
}
