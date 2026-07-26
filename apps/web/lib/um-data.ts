import { MENU_LABELS, MENU_SLUGS, type MenuSlug } from "./access";
import { NAV } from "./nav";

/**
 * Shapes and helpers for the User Management screens.
 *
 * Roles, accounts, and the permission matrix are now database rows served by
 * `/v1/roles` and `/v1/users` — what remains here is the row grouping the RBAC
 * matrix renders from, which follows the sidebar and is therefore code.
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

/**
 * An account holds exactly one role. It was `roleIds: string[]`, which the
 * screen rendered as a multi-select — but two simultaneous roles have no
 * meaning once scope is enforced, since the two could disagree about how much
 * of the workforce the account may see.
 */
export type UmUser = {
  id: string;
  email: string | null;
  name: string;
  nik: string | null;
  roleId: string;
  active: boolean;
};

/** Jumlah pemakai per role. */
export function roleUserCount(users: UmUser[], roleId: string): number {
  return users.filter((u) => u.roleId === roleId).length;
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

/** API sends only the slugs a role holds; the matrix wants every slug. */
export function permsFromApi(
  granted: Partial<Record<MenuSlug, "view" | "manage">>
): Record<MenuSlug, UmPerm> {
  return Object.fromEntries(
    MENU_SLUGS.map((m) => [m, granted[m] ?? "none"])
  ) as Record<MenuSlug, UmPerm>;
}

/** …and the API stores only real grants, never `none`. */
export function permsToApi(
  perms: Record<MenuSlug, UmPerm>
): Partial<Record<MenuSlug, "view" | "manage">> {
  const out: Partial<Record<MenuSlug, "view" | "manage">> = {};
  for (const m of MENU_SLUGS) if (perms[m] !== "none") out[m] = perms[m];
  return out;
}

export { MENU_LABELS, MENU_SLUGS };
export type { MenuSlug };
