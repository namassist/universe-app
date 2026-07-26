import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { Elysia, t } from "elysia";
import {
  isMenuSlug,
  type EffectivePermissions,
  type MenuSlug,
  type Scope,
} from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { invalidateRoleHolders } from "../auth/principal";
import { db, isUniqueViolation, schema, type RoleRow } from "../db";
import {
  ErrorSchema,
  OptionalScopeSchema,
  PermissionsInputSchema,
  RoleSchema,
  ScopeSchema,
} from "./schemas";

/** Both non-trivial scopes resolve through the employee record a NIK names. */
const NEEDS_NIK: Scope[] = ["dept", "self"];

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "role"
  );
}

async function permissionsOf(roleIds: string[]) {
  if (!roleIds.length) return new Map<string, EffectivePermissions>();
  const rows = await db
    .select()
    .from(schema.rolePermissions)
    .where(inArray(schema.rolePermissions.roleId, roleIds));
  const map = new Map<string, EffectivePermissions>();
  for (const id of roleIds) map.set(id, {});
  for (const r of rows) map.get(r.roleId)![r.menuSlug as MenuSlug] = r.mode;
  return map;
}

async function userCounts(roleIds: string[]) {
  if (!roleIds.length) return new Map<string, number>();
  const rows = await db
    .select({ roleId: schema.users.roleId, n: count() })
    .from(schema.users)
    .where(inArray(schema.users.roleId, roleIds))
    .groupBy(schema.users.roleId);
  const map = new Map<string, number>(roleIds.map((id) => [id, 0]));
  for (const r of rows) map.set(r.roleId, Number(r.n));
  return map;
}

function toRole(
  row: RoleRow,
  permissions: EffectivePermissions,
  userCount: number
) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    scope: row.scope,
    locked: row.locked,
    userCount,
    permissions,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Menus are code, roles are data. A submitted slug is validated against the
 * contracts list rather than a Postgres enum, so adding a menu stays a code
 * change plus a seed — and a caller cannot introduce one through this API.
 */
function invalidSlugs(permissions: Record<string, string>): string[] {
  return Object.keys(permissions).filter((s) => !isMenuSlug(s));
}

async function writePermissions(
  roleId: string,
  permissions: EffectivePermissions
): Promise<void> {
  await db
    .delete(schema.rolePermissions)
    .where(eq(schema.rolePermissions.roleId, roleId));
  const rows = Object.entries(permissions).map(([menuSlug, mode]) => ({
    roleId,
    menuSlug,
    mode: mode!,
  }));
  if (rows.length) await db.insert(schema.rolePermissions).values(rows);
}

export const rolesRoutes = new Elysia({ prefix: "/roles", tags: ["roles"] })
  .use(requireAuth)

  .get(
    "/",
    async () => {
      const rows = await db
        .select()
        .from(schema.roles)
        .orderBy(schema.roles.createdAt);
      const ids = rows.map((r) => r.id);
      const [perms, counts] = await Promise.all([
        permissionsOf(ids),
        userCounts(ids),
      ]);
      return rows.map((r) =>
        toRole(r, perms.get(r.id) ?? {}, counts.get(r.id) ?? 0)
      );
    },
    {
      auth: { menu: "roles", mode: "view" },
      response: {
        200: t.Array(RoleSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "List roles with their permission matrix" },
    }
  )

  .post(
    "/",
    async ({ body, status }) => {
      const unknown = invalidSlugs(body.permissions);
      if (unknown.length)
        return status(422, {
          code: "unknown_menu_slug",
          message: `Menu tidak dikenal: ${unknown.join(", ")}`,
        });

      try {
        const [row] = await db
          .insert(schema.roles)
          .values({
            slug: slugify(body.name),
            name: body.name.trim(),
            description: body.description ?? "",
            scope: body.scope,
            locked: false,
          })
          .returning();
        await writePermissions(row!.id, body.permissions);
        return status(201, toRole(row!, body.permissions, 0));
      } catch (error) {
        if (isUniqueViolation(error, "roles_slug_unique"))
          return status(409, {
            code: "role_exists",
            message: `Role "${body.name}" sudah ada`,
          });
        throw error;
      }
    },
    {
      auth: { menu: "roles", mode: "manage" },
      body: t.Object({
        name: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
        scope: ScopeSchema,
        permissions: PermissionsInputSchema,
      }),
      response: {
        201: RoleSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Create a role" },
    }
  )

  .patch(
    "/:id",
    async ({ params, body, status }) => {
      const [row] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.id, params.id))
        .limit(1);
      if (!row)
        return status(404, {
          code: "role_not_found",
          message: "Role tidak ditemukan",
        });

      if (body.permissions) {
        const unknown = invalidSlugs(body.permissions);
        if (unknown.length)
          return status(422, {
            code: "unknown_menu_slug",
            message: `Menu tidak dikenal: ${unknown.join(", ")}`,
          });
      }

      // Narrowing a scope can invalidate accounts that already hold the role.
      // Naming them is the difference between a blocked save and a silently
      // broken account.
      if (
        body.scope &&
        body.scope !== row.scope &&
        NEEDS_NIK.includes(body.scope)
      ) {
        // A NIK is the sole prerequisite for both dept and self.
        const invalid = await db
          .select({ id: schema.users.id, name: schema.users.name })
          .from(schema.users)
          .where(
            and(eq(schema.users.roleId, row.id), isNull(schema.users.nik))
          );
        if (invalid.length)
          return status(409, {
            code: "scope_unsatisfiable",
            message: `Lingkup "${body.scope}" memerlukan NIK; ${invalid.length} akun tidak memilikinya`,
            holders: invalid,
          });
      }

      const changes = {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        ...(body.scope !== undefined ? { scope: body.scope } : {}),
      };

      // Editing only the permission matrix leaves the role row itself
      // untouched, and Drizzle rejects an UPDATE with nothing to set.
      const updated = Object.keys(changes).length
        ? (
            await db
              .update(schema.roles)
              .set(changes)
              .where(eq(schema.roles.id, params.id))
              .returning()
          )[0]!
        : row;

      if (body.permissions) await writePermissions(row.id, body.permissions);

      // Immediate effect: the next request of every holder is evaluated against
      // the new grants, with no re-login.
      await invalidateRoleHolders(row.id);

      const [perms, counts] = await Promise.all([
        permissionsOf([row.id]),
        userCounts([row.id]),
      ]);
      return toRole(updated!, perms.get(row.id) ?? {}, counts.get(row.id) ?? 0);
    },
    {
      auth: { menu: "roles", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        description: t.Optional(t.String()),
        scope: OptionalScopeSchema,
        permissions: t.Optional(PermissionsInputSchema),
      }),
      response: {
        200: RoleSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: t.Object({
          code: t.String(),
          message: t.String(),
          holders: t.Optional(
            t.Array(t.Object({ id: t.String(), name: t.String() }))
          ),
        }),
        422: ErrorSchema,
      },
      detail: { summary: "Edit a role's name, scope, or permissions" },
    }
  )

  .delete(
    "/:id",
    async ({ params, status }) => {
      const [row] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.id, params.id))
        .limit(1);
      if (!row)
        return status(404, {
          code: "role_not_found",
          message: "Role tidak ditemukan",
        });

      // Losing the bootstrap superadmin locks everyone out.
      if (row.locked)
        return status(409, {
          code: "role_locked",
          message: `Role "${row.name}" terkunci dan tidak bisa dihapus`,
        });

      const [held] = await db
        .select({ n: count() })
        .from(schema.users)
        .where(eq(schema.users.roleId, row.id));
      const holders = Number(held?.n ?? 0);
      if (holders > 0)
        return status(409, {
          code: "role_in_use",
          message: `Role "${row.name}" masih dipakai ${holders} user`,
          holders,
        });

      await db.delete(schema.roles).where(eq(schema.roles.id, row.id));
      await invalidateRoleHolders(row.id);
      return { ok: true };
    },
    {
      auth: { menu: "roles", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: t.Object({
          code: t.String(),
          message: t.String(),
          holders: t.Optional(t.Integer()),
        }),
      },
      detail: { summary: "Delete a role" },
    }
  );

/** Exported for the users route, which enforces the same invariant on assign. */
export function scopeNeedsNik(scope: Scope): boolean {
  return NEEDS_NIK.includes(scope);
}
