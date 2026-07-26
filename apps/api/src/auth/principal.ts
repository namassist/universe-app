/**
 * Permission snapshots cached in Redis, invalidated on write (design D3).
 *
 * Resolving a request must not cost two Postgres queries, but caching
 * permissions is only safe if every write path drops the affected key — which
 * is why invalidation lives beside each write in the routes, and why the caches
 * carry a short backstop TTL so a missed DEL self-heals rather than persisting.
 */

import { eq } from "drizzle-orm";
import type {
  DeviceKind,
  EffectivePermissions,
  MenuSlug,
  Scope,
} from "@universe/contracts";

import { db, schema } from "../db";
import { redis } from "../redis";

/** Backstop only. Correctness comes from the explicit DELs, not from expiry. */
const CACHE_TTL_SECONDS = 300;

export type CachedUser = {
  id: string;
  name: string;
  email: string | null;
  nik: string | null;
  roleId: string;
  roleName: string;
  scope: Scope;
  active: boolean;
  mustChangePassword: boolean;
};

export type CachedDevice = {
  id: string;
  name: string;
  kind: DeviceKind;
  active: boolean;
};

const userKey = (id: string) => `princ:user:${id}`;
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
    const [row] = await db
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
      .limit(1);
    return row ?? null;
  });
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

/** Every holder of a role loses its cached principal when the role changes. */
export async function invalidateRoleHolders(roleId: string): Promise<void> {
  const holders = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.roleId, roleId));
  await Promise.all([
    invalidatePermissions(roleId),
    ...holders.map((h) => invalidateUser(h.id)),
  ]);
}
