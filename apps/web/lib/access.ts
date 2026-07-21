/**
 * Static role → menu access matrix. This is the single source of truth for the
 * whole app: which menus a role sees, and read-only ("view") vs read-write
 * ("manage") per menu. Transcribed from the reference seed roles
 * (universe/packages/seed-data/src/users.ts → initialUmRoles). No data layer.
 */

export const ROLES = [
  "superadmin",
  "admin",
  "manajer",
  "manpower",
  "medic",
  "user",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: "Superadmin",
  admin: "Admin",
  manajer: "Manajer",
  manpower: "Manpower",
  medic: "Medic",
  user: "User",
};

export const MENU_SLUGS = [
  "dashboard",
  "display-attendance",
  "display-fleet",
  "display-fitwork",
  "monitoring-fingerprint",
  "employees",
  "roster-data",
  "roster-revision",
  "roster-approval",
  "attendance",
  "fit-to-work",
  "unit-status",
  "fleet-allocation",
  "fleet-setting",
  "database-unit",
  "jenis-unit",
  "model-unit",
  "merk-unit",
  "kelas-unit",
  "simper",
  "area-kerja",
  "bus",
  "lokasi-excavator",
  "running-text",
  "setting",
] as const;
export type MenuSlug = (typeof MENU_SLUGS)[number];

export type AccessMode = "view" | "manage";

/** Menu labels (Indonesian), matching the reference nav. */
export const MENU_LABELS: Record<MenuSlug, string> = {
  dashboard: "Dashboard",
  "display-attendance": "Display Attendance",
  "display-fleet": "Display Fleet",
  "display-fitwork": "Display Fit To Work",
  "monitoring-fingerprint": "Monitoring Fingerprint",
  employees: "Karyawan",
  "roster-data": "Data Roster",
  "roster-revision": "Revisi Roster",
  "roster-approval": "Approval Revisi",
  attendance: "Attendance",
  "fit-to-work": "Fit To Work",
  "unit-status": "Status Unit",
  "fleet-allocation": "Fleet Allocation",
  "fleet-setting": "Setting Fleet",
  "database-unit": "Database Unit",
  "jenis-unit": "Jenis Unit",
  "model-unit": "Model Unit",
  "merk-unit": "Product / Merek",
  "kelas-unit": "Kelas Unit",
  simper: "SIMPER",
  "area-kerja": "Area Kerja",
  bus: "Bus",
  "lokasi-excavator": "Lokasi Excavator",
  "running-text": "Running Text",
  setting: "Setting",
};

type AccessRow = Partial<Record<MenuSlug, AccessMode>>;

/** helper: everything manage (superadmin) */
const allManage = (): AccessRow =>
  Object.fromEntries(MENU_SLUGS.map((s) => [s, "manage"])) as AccessRow;

/** helper: build a row from view[] + manage[] lists */
const row = (view: MenuSlug[], manage: MenuSlug[]): AccessRow => {
  const r: AccessRow = {};
  for (const s of view) r[s] = "view";
  for (const s of manage) r[s] = "manage";
  return r;
};

export const ROLE_ACCESS: Record<Role, AccessRow> = {
  superadmin: allManage(),

  admin: row(
    [
      "dashboard",
      "display-attendance",
      "display-fleet",
      "fit-to-work",
      "unit-status",
      "fleet-allocation",
      "fleet-setting",
    ],
    ["employees", "roster-data", "roster-revision", "attendance"]
  ),

  manajer: row(
    [
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
    ["roster-approval"]
  ),

  manpower: row(
    [],
    [
      "dashboard",
      "display-attendance",
      "display-fleet",
      "display-fitwork",
      "monitoring-fingerprint",
      "unit-status",
      "fleet-allocation",
      "fleet-setting",
      "area-kerja",
      "bus",
      "lokasi-excavator",
      "running-text",
      "setting",
    ]
  ),

  medic: row(
    [
      "dashboard",
      "display-attendance",
      "display-fleet",
      "display-fitwork",
      "employees",
    ],
    ["fit-to-work"]
  ),

  user: row(
    ["dashboard", "employees", "roster-data", "roster-revision", "attendance"],
    ["fit-to-work"]
  ),
};

/** Access mode for a role+menu, or undefined if the menu is hidden. */
export function accessOf(role: Role, slug: MenuSlug): AccessMode | undefined {
  return ROLE_ACCESS[role][slug];
}
