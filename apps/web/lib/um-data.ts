import {
  MENU_LABELS,
  MENU_SLUGS,
  ROLE_ACCESS,
  ROLE_LABELS,
  ROLES,
  type MenuSlug,
  type Role,
} from "./access";
import { NAV } from "./nav";

/**
 * Static data for User Management. The RBAC matrix is driven by the SAME
 * ROLE_ACCESS matrix that gates the whole app, so what the Roles page shows
 * is exactly what each role can actually do here.
 */

export type UmPerm = "none" | "view" | "manage";
export type UmScope = "all" | "dept" | "self";

export type UmRole = {
  id: string;
  name: string;
  desc: string;
  scope: UmScope;
  locked: boolean;
  perms: Record<MenuSlug, UmPerm>;
};

const SCOPES: Record<Role, UmScope> = {
  superadmin: "all",
  admin: "dept",
  manajer: "dept",
  manpower: "dept",
  medic: "all",
  user: "self",
};

const DESCS: Record<Role, string> = {
  superadmin: "Akses penuh lintas divisi — semua menu read & write",
  admin: "Kelola karyawan & roster dalam divisinya",
  manajer: "Monitoring divisi + approval revisi roster",
  manpower: "Konfigurasi display, fleet, dan master operasional",
  medic: "Fit To Work lintas divisi",
  user: "Akses pribadi — lihat roster & lapor Fit To Work",
};

function permsOf(role: Role): Record<MenuSlug, UmPerm> {
  return Object.fromEntries(
    MENU_SLUGS.map((s) => [s, ROLE_ACCESS[role][s] ?? "none"])
  ) as Record<MenuSlug, UmPerm>;
}

export const ROLES_INIT: UmRole[] = ROLES.map((r) => ({
  id: `r-${r}`,
  name: ROLE_LABELS[r],
  desc: DESCS[r],
  scope: SCOPES[r],
  locked: r === "superadmin",
  perms: permsOf(r),
}));

export type UmUser = {
  id: string;
  email: string;
  name: string | null;
  nik: string | null;
  roleIds: string[];
  active: boolean;
};

export const USERS_INIT: UmUser[] = [
  {
    id: "u1",
    email: "superadmin@unggul.co.id",
    name: null,
    nik: null,
    roleIds: ["r-superadmin"],
    active: true,
  },
  {
    id: "u2",
    email: "budi.santoso@unggul.co.id",
    name: "Budi Santoso",
    nik: "OPS-0421",
    roleIds: ["r-user"],
    active: true,
  },
  {
    id: "u3",
    email: "andi.wijaya@unggul.co.id",
    name: "Andi Wijaya",
    nik: "OPS-0388",
    roleIds: ["r-user"],
    active: true,
  },
  {
    id: "u4",
    email: "admin.hauling@unggul.co.id",
    name: "Sari Lestari",
    nik: "OPS-0233",
    roleIds: ["r-admin"],
    active: true,
  },
  {
    id: "u5",
    email: "manajer.ops@unggul.co.id",
    name: "Hendra Gunawan",
    nik: "OPS-0367",
    roleIds: ["r-manajer"],
    active: true,
  },
  {
    id: "u6",
    email: "dispatcher@unggul.co.id",
    name: "Dewi Anggraini",
    nik: "OPS-0290",
    roleIds: ["r-manpower"],
    active: true,
  },
  {
    id: "u7",
    email: "medic.site@unggul.co.id",
    name: "Rina Marlina",
    nik: "OPS-0602",
    roleIds: ["r-medic"],
    active: true,
  },
  {
    id: "u8",
    email: "agus.salim@unggul.co.id",
    name: "Agus Salim",
    nik: "OPS-0129",
    roleIds: ["r-user", "r-manpower"],
    active: false,
  },
];

/** Jumlah pemakai per role (dari USERS_INIT). */
export function roleUserCount(users: UmUser[], roleId: string): number {
  return users.filter((u) => u.roleIds.includes(roleId)).length;
}

export type PageSection = {
  key: string;
  label: string;
  pages: [MenuSlug, string][];
};

/** Baris matriks RBAC — dikelompokkan mengikuti struktur sidebar (NAV). */
export function pageSections(): PageSection[] {
  return NAV.map((e) =>
    e.kind === "item"
      ? {
          key: e.slug,
          label: e.label,
          pages: [[e.slug, e.label]] as [MenuSlug, string][],
        }
      : {
          key: e.key,
          label: e.label,
          pages: e.children.map((c): [MenuSlug, string] => [c.slug, c.label]),
        }
  );
}

export function emptyPerms(): Record<MenuSlug, UmPerm> {
  return Object.fromEntries(MENU_SLUGS.map((m) => [m, "none"])) as Record<
    MenuSlug,
    UmPerm
  >;
}

export { MENU_LABELS, MENU_SLUGS };
export type { MenuSlug };

/** Akun contoh per role — identitas topbar & halaman Profil. */
export const ROLE_ACCOUNTS: Record<
  Role,
  { name: string; email: string; nik: string | null }
> = {
  superadmin: {
    name: "Super Admin",
    email: "superadmin@unggul.co.id",
    nik: null,
  },
  admin: {
    name: "Sari Lestari",
    email: "admin.hauling@unggul.co.id",
    nik: "OPS-0233",
  },
  manajer: {
    name: "Hendra Gunawan",
    email: "manajer.ops@unggul.co.id",
    nik: "OPS-0367",
  },
  manpower: {
    name: "Dewi Anggraini",
    email: "dispatcher@unggul.co.id",
    nik: "OPS-0290",
  },
  medic: {
    name: "Rina Marlina",
    email: "medic.site@unggul.co.id",
    nik: "OPS-0602",
  },
  user: {
    name: "Budi Santoso",
    email: "budi.santoso@unggul.co.id",
    nik: "OPS-0421",
  },
};
