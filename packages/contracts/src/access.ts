/**
 * The access vocabulary shared by api / web / mobile.
 *
 * Menu slugs are deliberately **static**: a slug names a page that exists in
 * code, so adding a menu is a code change plus a seed, never a runtime insert.
 * Roles, by contrast, are database rows — see the `rbac` capability.
 */

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
  "departemen",
  "area-kerja",
  "bus",
  "mess",
  "running-text",
  "sound",
  "timeline",
  "users",
  "roles",
  "setting",
] as const;
export type MenuSlug = (typeof MENU_SLUGS)[number];

/** Menu labels (Indonesian). */
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
  "merk-unit": "Merek",
  "kelas-unit": "Kelas Unit",
  simper: "SIMPER",
  departemen: "Departemen",
  "area-kerja": "Area Kerja",
  bus: "Bus",
  mess: "Mess",
  "running-text": "Running Text",
  sound: "Sound",
  timeline: "Timeline",
  users: "User",
  roles: "Role",
  setting: "Setting",
};

/**
 * A grant is a mode on a menu. `none` is never stored — the absence of a
 * permission row is what "no access" means.
 */
export const ACCESS_MODES = ["view", "manage"] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

/** How much of the workforce a role may see. */
export const SCOPES = ["all", "dept", "self"] as const;
export type Scope = (typeof SCOPES)[number];

/** A role's resolved grants: slug → mode, absent slug meaning no access. */
export type EffectivePermissions = Partial<Record<MenuSlug, AccessMode>>;

/** Type guard for a value arriving from the wire or a spreadsheet. */
export function isMenuSlug(value: string): value is MenuSlug {
  return (MENU_SLUGS as readonly string[]).includes(value);
}
