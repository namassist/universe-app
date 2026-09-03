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
  // The slug stays `fleet-allocation` for the same reason `jabatan` does: it
  // names a route, a permission row on every role, and the `auth` macro's
  // guard in a dozen handlers. The label is what people read, and they read
  // "Unit No-Operator".
  "fleet-allocation": "Unit No-Operator",
  "fleet-setting": "Setting Fleet",
  "database-unit": "Database Unit",
  "jenis-unit": "Jenis Unit",
  "model-unit": "Model Unit",
  "merk-unit": "Merek",
  "kelas-unit": "Kelas Unit",
  simper: "SIMPER",
  "kode-simper": "Kode SIMPER",
  departemen: "Departemen",
  bus: "Bus",
  mess: "Mess",
  perusahaan: "Perusahaan",
  // The slug stays `jabatan` — it names a page, a route, a permission row, and
  // a spreadsheet column, and renaming those would be a migration. The label is
  // what people read, and they read "Posisi".
  jabatan: "Posisi",
  "running-text": "Running Text",
  sound: "Sound",
  timeline: "Timeline",
  "mesin-fingerprint": "Mesin Fingerprint",
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

/**
 * The eleven lookup catalogues reachable through `/v1/master/:kind`.
 *
 * A kind is also a menu slug — the menu that owns a catalogue is what
 * authorizes it — so the list is typed as a subset rather than a parallel
 * vocabulary. `bus`, `running-text`, `sound`, `timeline`, and `database-unit`
 * ride the same Master group in the UI but are not catalogues: they have their
 * own tables and their own routes.
 */
export const MASTER_KINDS = [
  "jenis-unit",
  "model-unit",
  "merk-unit",
  "kelas-unit",
  "simper",
  "kode-simper",
  "departemen",
  "mess",
  "perusahaan",
  "jabatan",
] as const satisfies readonly MenuSlug[];
export type MasterKind = (typeof MASTER_KINDS)[number];

/** Type guard for a `:kind` path segment arriving from the wire. */
export function isMasterKind(value: string): value is MasterKind {
  return (MASTER_KINDS as readonly string[]).includes(value);
}
