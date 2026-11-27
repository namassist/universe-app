/**
 * The roles an account holds: its default (`users.role_id`) plus the extras in
 * `user_roles`. Shared by the account routes and the account import, so the
 * rules about a role *set* are written once.
 *
 * Every helper takes the executor it runs on, so a write path can read and
 * write inside one transaction — reading the current set outside it lets a
 * concurrent edit's extras be silently reverted.
 */

import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { RoleOption } from "@universe/contracts";

import { db, schema, type RoleRow, type Transaction } from "../db";
import { scopeNeedsNik } from "./roles";

type Executor = typeof db | Transaction;

const ROLES_MENU = "roles";

/**
 * Serializes every write that could take away the last account able to
 * administer roles (switching off, deleting, editing a role set, importing).
 * Without it two administrators removing each other at the same moment both
 * see the other still standing, and nobody is left.
 */
const ROLES_ADMIN_LOCK = 7_300_101;

export async function lockRolesAdmin(tx: Transaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${ROLES_ADMIN_LOCK})`);
}

/** Extra roles of each account, by account id, ordered by name. */
export async function extraRolesOf(
  userIds: string[],
  ex: Executor = db
): Promise<Map<string, RoleOption[]>> {
  const map = new Map<string, RoleOption[]>(userIds.map((id) => [id, []]));
  if (!userIds.length) return map;
  const rows = await ex
    .select({
      userId: schema.userRoles.userId,
      id: schema.roles.id,
      name: schema.roles.name,
      scope: schema.roles.scope,
    })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(inArray(schema.userRoles.userId, userIds))
    .orderBy(asc(schema.roles.name));
  for (const { userId, ...role } of rows) map.get(userId)?.push(role);
  return map;
}

/**
 * Attach `roles` — default first, then the extras — to account rows that carry
 * their default role's id, name and scope.
 */
export async function withRoles<
  T extends {
    id: string;
    roleId: string;
    roleName: string;
    scope: RoleOption["scope"];
  },
>(rows: T[], ex: Executor = db): Promise<(T & { roles: RoleOption[] })[]> {
  const extras = await extraRolesOf(
    rows.map((r) => r.id),
    ex
  );
  return rows.map((row) => ({
    ...row,
    roles: [
      { id: row.roleId, name: row.roleName, scope: row.scope },
      ...(extras.get(row.id) ?? []).filter((r) => r.id !== row.roleId),
    ],
  }));
}

export type RoleSetFailure = { code: string; message: string };
export type RoleSet = { defaultRole: RoleRow; extras: RoleRow[] };

/**
 * Check a role set before it is written: every role exists, the default is one
 * of them, and a NIK is present if any of them needs one (the scope a role
 * carries is a promise about every account holding it, extra or not).
 *
 * `roleIds` omitted means "the extras stay as they are" — `currentExtraIds`
 * — which is what a client that only ever sent `roleId` keeps getting: the
 * default changes, nothing else does.
 */
export async function resolveRoleSet(
  defaultRoleId: string,
  roleIds: string[] | undefined,
  currentExtraIds: string[],
  nik: string | null,
  ex: Executor = db
): Promise<RoleSet | RoleSetFailure> {
  if (roleIds && !roleIds.includes(defaultRoleId))
    return {
      code: "default_role_not_held",
      message: "Role default harus termasuk role yang dimiliki akun",
    };

  const extraIds = [
    ...new Set(
      (roleIds ?? currentExtraIds).filter((id) => id !== defaultRoleId)
    ),
  ];
  const wanted = [defaultRoleId, ...extraIds];
  const found = await ex
    .select()
    .from(schema.roles)
    .where(inArray(schema.roles.id, wanted));
  const byId = new Map(found.map((r) => [r.id, r]));
  if (wanted.some((id) => !byId.has(id))) return ROLE_NOT_FOUND;

  const needing = found.find((r) => scopeNeedsNik(r.scope));
  if (needing && !nik)
    return {
      code: "scope_requires_nik",
      message: `Lingkup "${needing.scope}" (role ${needing.name}) memerlukan NIK`,
    };

  return {
    defaultRole: byId.get(defaultRoleId)!,
    extras: extraIds.map((id) => byId.get(id)!),
  };
}

/**
 * Also the answer when a role is deleted between the check above and the
 * write: the foreign key refuses the row, and the caller says the same thing.
 */
export const ROLE_NOT_FOUND: RoleSetFailure = {
  code: "role_not_found",
  message: "Role tidak ditemukan",
};

export const isRoleSetFailure = (
  value: RoleSet | RoleSetFailure
): value is RoleSetFailure => "code" in value;

/**
 * Replace an account's extras with exactly these. `fresh` skips the delete for
 * an account created in the same transaction, which has none to replace.
 */
export async function writeExtras(
  tx: Transaction,
  userId: string,
  extraRoleIds: string[],
  { fresh = false }: { fresh?: boolean } = {}
): Promise<void> {
  if (!fresh)
    await tx
      .delete(schema.userRoles)
      .where(eq(schema.userRoles.userId, userId));
  if (extraRoleIds.length)
    await tx
      .insert(schema.userRoles)
      .values(extraRoleIds.map((roleId) => ({ userId, roleId })));
}

/**
 * Whether any active account can administer roles — through its default role
 * or an extra one. A write path asks before and after its change, under
 * `lockRolesAdmin`, and refuses only when the change is what took the last
 * one away: an installation that already has none (misconfigured, mid-
 * recovery) is not frozen by it.
 */
export async function rolesAdminExists(ex: Executor): Promise<boolean> {
  const adminRoles = ex
    .select({ id: schema.rolePermissions.roleId })
    .from(schema.rolePermissions)
    .where(
      and(
        eq(schema.rolePermissions.menuSlug, ROLES_MENU),
        eq(schema.rolePermissions.mode, "manage")
      )
    );
  const extraHolders = ex
    .select({ id: schema.userRoles.userId })
    .from(schema.userRoles)
    .where(inArray(schema.userRoles.roleId, adminRoles));
  const [holder] = await ex
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.active, true),
        or(
          inArray(schema.users.roleId, adminRoles),
          inArray(schema.users.id, extraHolders)
        )
      )
    )
    .limit(1);
  return Boolean(holder);
}

/**
 * Thrown inside a transaction to roll it back and answer with this refusal.
 * The routes catch it beside their unique-violation handling.
 */
export class Refusal extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    readonly body: { code: string; message: string }
  ) {
    super(body.code);
  }
}

export const lastRolesAdmin = (consequence: string): Refusal =>
  new Refusal(409, {
    code: "last_roles_admin",
    message: `Akun ini satu-satunya yang masih bisa mengelola role — ${consequence}`,
  });
