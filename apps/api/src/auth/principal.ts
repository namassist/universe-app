/**
 * Permission snapshots cached in Redis, invalidated on write (design D3).
 *
 * Resolving a request must not cost two Postgres queries, but caching
 * permissions is only safe if every write path drops the affected key — which
 * is why invalidation lives beside each write in the routes, and why the caches
 * carry a short backstop TTL so a missed DEL self-heals rather than persisting.
 */

import { asc, eq } from "drizzle-orm";
import type {
  DeviceKind,
  EffectivePermissions,
  MenuSlug,
  RoleOption,
  Scope,
} from "@universe/contracts";

import { db, schema } from "../db";
import { redis } from "../redis";

/** Backstop only. Correctness comes from the explicit DELs, not from expiry. */
const CACHE_TTL_SECONDS = 300;

/**
 * The account as stored. `roleId` / `roleName` / `scope` are its **default**
 * role; `roles` is every role it holds, the default first. Which one a request
 * answers to is the session's business — see `actingAs`.
 */
export type CachedUser = {
  id: string;
  name: string;
  email: string | null;
  nik: string | null;
  roleId: string;
  roleName: string;
  scope: Scope;
  roles: RoleOption[];
  active: boolean;
  mustChangePassword: boolean;
};

export type CachedDevice = {
  id: string;
  name: string;
  kind: DeviceKind;
  active: boolean;
};

/* `v2` since multi-role accounts: an entry cached by the previous build has no
   `roles`, and reading one would hand a request an account with no roles at
   all. A new key simply misses, and the old entries age out on the backstop. */
const userKey = (id: string) => `princ:user:v2:${id}`;
const deviceKey = (id: string) => `princ:device:${id}`;
const permsKey = (roleId: string) => `perms:${roleId}`;

async function cached<T>(
  key: string,
  load: () => Promise<T | null>
): Promise<T | null> {
  const hit = await redis.get(key);
  if (hit) {
    try {
      return JSON.parse(hit) as T;
    } catch {
      await redis.del(key);
    }
  }
  const value = await load();
  if (value === null) return null;
  await redis.set(key, JSON.stringify(value), "EX", CACHE_TTL_SECONDS);
  return value;
}

export function loadUser(id: string): Promise<CachedUser | null> {
  return cached(userKey(id), async () => {
    const [[row], extras] = await Promise.all([
      db
        .select({
          id: schema.users.id,
          name: schema.users.name,
          email: schema.users.email,
          nik: schema.users.nik,
          roleId: schema.users.roleId,
          roleName: schema.roles.name,
          scope: schema.roles.scope,
          active: schema.users.active,
          mustChangePassword: schema.users.mustChangePassword,
        })
        .from(schema.users)
        .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
        .where(eq(schema.users.id, id))
        .limit(1),
      db
        .select({
          id: schema.roles.id,
          name: schema.roles.name,
          scope: schema.roles.scope,
        })
        .from(schema.userRoles)
        .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
        .where(eq(schema.userRoles.userId, id))
        .orderBy(asc(schema.roles.name)),
    ]);
    if (!row) return null;
    const roles: RoleOption[] = [
      { id: row.roleId, name: row.roleName, scope: row.scope },
      // The API never stores the default as an extra, but a hand-written row
      // must not show the same role twice in the picker.
      ...extras.filter((r) => r.id !== row.roleId),
    ];
    return { ...row, roles };
  });
}

/**
 * The account as the session acts: `roleId` from the session record, or the
 * default when the record names none (a login that did not choose, and every
 * session from before multi-role accounts).
 *
 * Null when the account no longer holds that role. That is the whole check
 * that keeps the session's role a *choice* rather than a grant: it runs on
 * every request against the account's current roles, so a role an
 * administrator takes away ends the sessions acting as it on their next
 * request, as deactivating the account does.
 *
 * Compared case-insensitively: a uuid in capitals is the same role to
 * Postgres, so it must be to this too. What comes back carries the canonical
 * id, and that is what a session stores.
 *
 * One window is known and accepted: a request that read the account just
 * before an edit committed can cache the pre-edit roles after the edit's
 * invalidation, for up to the backstop TTL. Deactivation has always had the
 * same window (design D16).
 */
export function actingAs(
  user: CachedUser,
  roleId: string | undefined
): CachedUser | null {
  const wanted = roleId?.toLowerCase();
  if (!wanted || wanted === user.roleId) return user;
  const role = user.roles.find((r) => r.id === wanted);
  if (!role) return null;
  return { ...user, roleId: role.id, roleName: role.name, scope: role.scope };
}

export function loadDevice(id: string): Promise<CachedDevice | null> {
  return cached(deviceKey(id), async () => {
    const [row] = await db
      .select({
        id: schema.devices.id,
        name: schema.devices.name,
        kind: schema.devices.kind,
        active: schema.devices.active,
      })
      .from(schema.devices)
      .where(eq(schema.devices.id, id))
      .limit(1);
    return row ?? null;
  });
}

export async function loadPermissions(
  roleId: string
): Promise<EffectivePermissions> {
  const value = await cached<EffectivePermissions>(
    permsKey(roleId),
    async () => {
      const rows = await db
        .select({
          menuSlug: schema.rolePermissions.menuSlug,
          mode: schema.rolePermissions.mode,
        })
        .from(schema.rolePermissions)
        .where(eq(schema.rolePermissions.roleId, roleId));
      // A role with no grants caches as {} rather than as a miss — otherwise
      // every request for it falls through to Postgres.
      return Object.fromEntries(
        rows.map((r) => [r.menuSlug as MenuSlug, r.mode])
      ) as EffectivePermissions;
    }
  );
  return value ?? {};
}

export const invalidateUser = (id: string): Promise<number> =>
  redis.del(userKey(id));

export const invalidateDevice = (id: string): Promise<number> =>
  redis.del(deviceKey(id));

export const invalidatePermissions = (roleId: string): Promise<number> =>
  redis.del(permsKey(roleId));

/** Every account holding a role — as its default or as an extra one. */
export async function roleHolderIds(roleId: string): Promise<string[]> {
  const [byDefault, byExtra] = await Promise.all([
    db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.roleId, roleId)),
    db
      .select({ id: schema.userRoles.userId })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.roleId, roleId)),
  ]);
  return [...new Set([...byDefault, ...byExtra].map((h) => h.id))];
}

/**
 * Every holder of a role loses its cached principal when the role changes —
 * extra holders too, since the cached `roles` carries the role's name and
 * scope.
 */
export async function invalidateRoleHolders(roleId: string): Promise<void> {
  const holders = await roleHolderIds(roleId);
  await Promise.all([
    invalidatePermissions(roleId),
    ...holders.map(invalidateUser),
  ]);
}
