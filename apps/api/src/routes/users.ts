import { and, eq, ne } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { MenuSlug } from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { hashPassword } from "../auth/password";
import { invalidateUser } from "../auth/principal";
import { db, isUniqueViolation, schema } from "../db";
import { env } from "../env";
import { scopeNeedsNik } from "./roles";
import {
  ErrorSchema,
  ImportPreviewSchema,
  ImportResultSchema,
  UserSchema,
} from "./schemas";
import {
  buildTemplate,
  MAX_IMPORT_BYTES,
  validateWorkbook,
  type ExistingAccount,
} from "./users-import";

const ROLES_MENU: MenuSlug = "roles";

const userColumns = {
  id: schema.users.id,
  email: schema.users.email,
  nik: schema.users.nik,
  name: schema.users.name,
  roleId: schema.users.roleId,
  roleName: schema.roles.name,
  scope: schema.roles.scope,
  active: schema.users.active,
  mustChangePassword: schema.users.mustChangePassword,
  createdAt: schema.users.createdAt,
};

/** Postgres returns Date; the wire contract is an ISO string. */
function toUser<T extends { createdAt: Date }>(
  row: T
): Omit<T, "createdAt"> & { createdAt: string } {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

const baseQuery = () =>
  db
    .select(userColumns)
    .from(schema.users)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId));

async function roleOrNull(roleId: string) {
  const [role] = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.id, roleId))
    .limit(1);
  return role ?? null;
}

/**
 * The last account that can still administer roles must not be removable —
 * losing it locks everyone out of the screen that would restore access.
 */
async function isLastRolesAdmin(userId: string): Promise<boolean> {
  const holders = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .innerJoin(
      schema.rolePermissions,
      eq(schema.rolePermissions.roleId, schema.users.roleId)
    )
    .where(
      and(
        eq(schema.users.active, true),
        eq(schema.rolePermissions.menuSlug, ROLES_MENU),
        eq(schema.rolePermissions.mode, "manage"),
        ne(schema.users.id, userId)
      )
    )
    .limit(1);
  return holders.length === 0;
}

export const usersRoutes = new Elysia({ prefix: "/users", tags: ["users"] })
  .use(requireAuth)

  .get(
    "/",
    async () => (await baseQuery().orderBy(schema.users.createdAt)).map(toUser),
    {
      auth: { menu: "users", mode: "view" },
      response: {
        200: t.Array(UserSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "List accounts" },
    }
  )

  /* ---------------------------------------------------------------- import
     Declared before /:id so "import" is never parsed as an account id. */

  .get(
    "/import/template",
    async ({ set }) => {
      set.headers["content-type"] =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      set.headers["content-disposition"] =
        'attachment; filename="template_akun.xlsx"';
      return new Response(new Uint8Array(await buildTemplate()));
    },
    {
      auth: { menu: "users", mode: "manage" },
      // Described by hand rather than with a `response` schema: the body is a
      // binary workbook, and a TypeBox schema would try to validate it. The
      // spec still has to describe it, or a generated client cannot call it.
      detail: {
        summary: "Download the account import template (.xlsx)",
        responses: {
          200: {
            description: "An .xlsx with the columns nik, nama, email, role",
            content: {
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                { schema: { type: "string", format: "binary" } },
            },
          },
          401: { description: "No session" },
          403: { description: "Lacks manage on the users menu" },
        },
      },
    }
  )

  .post(
    "/import/validate",
    async ({ body, status }) => {
      const file = body.file;
      if (file.size > MAX_IMPORT_BYTES)
        return status(422, {
          code: "file_too_large",
          message: `File melebihi ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MB`,
        });

      const roles = await db.select().from(schema.roles);
      const roleByName = new Map(
        roles.map((r) => [r.name.toLowerCase(), { id: r.id, name: r.name }])
      );
      // Slug is accepted too, so a file written against the seed still loads.
      for (const r of roles)
        if (!roleByName.has(r.slug))
          roleByName.set(r.slug, { id: r.id, name: r.name });

      const existing = await db
        .select({
          id: schema.users.id,
          nik: schema.users.nik,
          name: schema.users.name,
          email: schema.users.email,
          roleId: schema.users.roleId,
          roleName: schema.roles.name,
        })
        .from(schema.users)
        .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId));
      const existingByNik = new Map<string, ExistingAccount>(
        existing
          .filter((e): e is ExistingAccount => e.nik !== null)
          .map((e) => [e.nik, e])
      );
      const existingByEmail = new Map<string, ExistingAccount>(
        existing
          .filter((e): e is ExistingAccount => e.nik !== null && !!e.email)
          .map((e) => [e.email!.toLowerCase(), e])
      );

      const result = await validateWorkbook(
        await file.arrayBuffer(),
        file.name,
        roleByName,
        existingByNik,
        existingByEmail
      );
      if ("code" in result) return status(422, result);
      return result;
    },
    {
      auth: { menu: "users", mode: "manage" },
      body: t.Object({ file: t.File({ maxSize: MAX_IMPORT_BYTES }) }),
      response: {
        200: ImportPreviewSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: {
        summary: "Validate an account spreadsheet and preview the changes",
      },
    }
  )

  .post(
    "/import/commit",
    async ({ body, status }) => {
      const file = body.file;
      if (file.size > MAX_IMPORT_BYTES)
        return status(422, {
          code: "file_too_large",
          message: `File melebihi ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MB`,
        });

      const roles = await db.select().from(schema.roles);
      const roleByName = new Map(
        roles.map((r) => [r.name.toLowerCase(), { id: r.id, name: r.name }])
      );
      for (const r of roles)
        if (!roleByName.has(r.slug))
          roleByName.set(r.slug, { id: r.id, name: r.name });
      const roleIdByName = new Map(roles.map((r) => [r.name, r.id]));

      const existing = await db
        .select({
          id: schema.users.id,
          nik: schema.users.nik,
          name: schema.users.name,
          email: schema.users.email,
          roleId: schema.users.roleId,
          roleName: schema.roles.name,
        })
        .from(schema.users)
        .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId));
      const existingByNik = new Map<string, ExistingAccount>(
        existing
          .filter((e): e is ExistingAccount => e.nik !== null)
          .map((e) => [e.nik, e])
      );
      const existingByEmail = new Map<string, ExistingAccount>(
        existing
          .filter((e): e is ExistingAccount => e.nik !== null && !!e.email)
          .map((e) => [e.email!.toLowerCase(), e])
      );

      const preview = await validateWorkbook(
        await file.arrayBuffer(),
        file.name,
        roleByName,
        existingByNik,
        existingByEmail
      );
      if ("code" in preview) return status(422, preview);
      // Re-validated rather than trusted from the client: the preview the
      // caller saw is advisory, this parse is what gets written.
      if (preview.errorCount > 0)
        return status(422, {
          code: "validation_failed",
          message: `${preview.errorCount} baris masih bermasalah`,
        });

      const defaultHash = await hashPassword(env.DEFAULT_USER_PASSWORD);
      let created = 0;
      let updated = 0;
      const touched: string[] = [];

      try {
        // One transaction for the whole file. The import is all-or-nothing by
        // design, and without this a row failing halfway leaves every row
        // before it already written — the exact partial state the validation
        // gate exists to prevent.
        await db.transaction(async (tx) => {
          for (const row of preview.rows) {
            const roleId = roleIdByName.get(row.role)!;
            if (row.kind === "new") {
              await tx.insert(schema.users).values({
                nik: row.nik,
                email: row.email,
                name: row.nama,
                passwordHash: defaultHash,
                // Authenticates, then is refused everywhere until it sets its own.
                mustChangePassword: true,
                roleId,
                active: true,
              });
              created++;
              continue;
            }
            const account = existingByNik.get(row.nik)!;
            await tx
              .update(schema.users)
              // Password deliberately untouched: an update must not reset the
              // credential of someone already using the system.
              .set({ name: row.nama, email: row.email, roleId })
              .where(eq(schema.users.id, account.id));
            touched.push(account.id);
            updated++;
          }
        });
      } catch (error) {
        // Validation checks both unique columns, but it reads the database a
        // moment before the write: another administrator can take an email or
        // a NIK in between. Answer with the conflict rather than a 500.
        if (isUniqueViolation(error, "users_email_unique"))
          return status(409, {
            code: "email_taken",
            message:
              "Sebuah email dalam file ini baru saja dipakai akun lain — validasi ulang filenya",
          });
        if (isUniqueViolation(error, "users_nik_unique"))
          return status(409, {
            code: "nik_taken",
            message:
              "Sebuah NIK dalam file ini baru saja dipakai akun lain — validasi ulang filenya",
          });
        throw error;
      }

      // After the commit, never inside it: a rolled-back transaction must not
      // leave the caches saying the write happened.
      await Promise.all(touched.map(invalidateUser));

      return { created, updated };
    },
    {
      auth: { menu: "users", mode: "manage" },
      body: t.Object({ file: t.File({ maxSize: MAX_IMPORT_BYTES }) }),
      response: {
        200: ImportResultSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Commit a validated account spreadsheet" },
    }
  )

  /* ------------------------------------------------------------------ crud */

  .get(
    "/:id",
    async ({ params, status }) => {
      const [row] = await baseQuery()
        .where(eq(schema.users.id, params.id))
        .limit(1);
      if (!row)
        return status(404, {
          code: "user_not_found",
          message: `Akun ${params.id} tidak ditemukan`,
        });
      return toUser(row);
    },
    {
      auth: { menu: "users", mode: "view" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: UserSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Get one account" },
    }
  )

  .post(
    "/",
    async ({ body, status }) => {
      if (!body.email && !body.nik)
        return status(422, {
          code: "identifier_required",
          message: "Akun harus punya email atau NIK",
        });

      const role = await roleOrNull(body.roleId);
      if (!role)
        return status(422, {
          code: "role_not_found",
          message: "Role tidak ditemukan",
        });
      // The scope a role carries is a promise about the account holding it.
      if (scopeNeedsNik(role.scope) && !body.nik)
        return status(422, {
          code: "scope_requires_nik",
          message: `Lingkup "${role.scope}" memerlukan NIK`,
        });

      try {
        const [row] = await db
          .insert(schema.users)
          .values({
            email: body.email ?? null,
            nik: body.nik ?? null,
            name: body.name.trim(),
            passwordHash: await hashPassword(env.DEFAULT_USER_PASSWORD),
            mustChangePassword: true,
            roleId: role.id,
            active: body.active ?? true,
          })
          // Named columns, not `.returning()` — the row Drizzle hands back
          // carries password_hash, and spreading it is exactly how a hash
          // reaches a response.
          .returning({
            id: schema.users.id,
            email: schema.users.email,
            nik: schema.users.nik,
            name: schema.users.name,
            roleId: schema.users.roleId,
            active: schema.users.active,
            mustChangePassword: schema.users.mustChangePassword,
            createdAt: schema.users.createdAt,
          });
        return status(201, {
          ...toUser(row!),
          roleName: role.name,
          scope: role.scope,
        });
      } catch (error) {
        if (isUniqueViolation(error, "users_email_unique"))
          return status(409, {
            code: "email_taken",
            message: `${body.email} sudah terdaftar`,
          });
        if (isUniqueViolation(error, "users_nik_unique"))
          return status(409, {
            code: "nik_taken",
            message: `NIK ${body.nik} sudah terdaftar`,
          });
        throw error;
      }
    },
    {
      // No password field: an initial password is configuration, never a value
      // a caller supplies. No role *name* either — only an explicit role id,
      // checked against the table.
      auth: { menu: "users", mode: "manage" },
      body: t.Object({
        email: t.Optional(t.String({ format: "email" })),
        nik: t.Optional(t.String({ minLength: 1 })),
        name: t.String({ minLength: 1 }),
        roleId: t.String({ format: "uuid" }),
        active: t.Optional(t.Boolean()),
      }),
      response: {
        201: UserSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Create an account" },
    }
  )

  .patch(
    "/:id",
    async ({ params, body, status }) => {
      const [current] = await baseQuery()
        .where(eq(schema.users.id, params.id))
        .limit(1);
      if (!current)
        return status(404, {
          code: "user_not_found",
          message: "Akun tidak ditemukan",
        });

      const roleId = body.roleId ?? (current.roleId as string);
      const role = await roleOrNull(roleId);
      if (!role)
        return status(422, {
          code: "role_not_found",
          message: "Role tidak ditemukan",
        });

      const nik =
        body.nik !== undefined ? body.nik : (current.nik as string | null);
      const email =
        body.email !== undefined
          ? body.email
          : (current.email as string | null);
      if (!email && !nik)
        return status(422, {
          code: "identifier_required",
          message: "Akun harus punya email atau NIK",
        });
      if (scopeNeedsNik(role.scope) && !nik)
        return status(422, {
          code: "scope_requires_nik",
          message: `Lingkup "${role.scope}" memerlukan NIK`,
        });

      if (body.active === false && (await isLastRolesAdmin(params.id)))
        return status(409, {
          code: "last_roles_admin",
          message:
            "Akun ini satu-satunya yang masih bisa mengelola role — tidak bisa dinonaktifkan",
        });

      try {
        await db
          .update(schema.users)
          .set({
            email,
            nik,
            ...(body.name !== undefined ? { name: body.name.trim() } : {}),
            roleId: role.id,
            ...(body.active !== undefined ? { active: body.active } : {}),
          })
          .where(eq(schema.users.id, params.id));
      } catch (error) {
        if (isUniqueViolation(error, "users_email_unique"))
          return status(409, {
            code: "email_taken",
            message: `${email} sudah terdaftar`,
          });
        if (isUniqueViolation(error, "users_nik_unique"))
          return status(409, {
            code: "nik_taken",
            message: `NIK ${nik} sudah terdaftar`,
          });
        throw error;
      }

      // Role reassignment applies on the next request, not at re-login.
      await invalidateUser(params.id);
      const [row] = await baseQuery()
        .where(eq(schema.users.id, params.id))
        .limit(1);
      return toUser(row!);
    },
    {
      auth: { menu: "users", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        email: t.Optional(t.Nullable(t.String({ format: "email" }))),
        nik: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
        name: t.Optional(t.String({ minLength: 1 })),
        roleId: t.Optional(t.String({ format: "uuid" })),
        active: t.Optional(t.Boolean()),
      }),
      response: {
        200: UserSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Edit an account" },
    }
  )

  .delete(
    "/:id",
    async ({ params, status }) => {
      const [row] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, params.id))
        .limit(1);
      if (!row)
        return status(404, {
          code: "user_not_found",
          message: "Akun tidak ditemukan",
        });
      if (await isLastRolesAdmin(params.id))
        return status(409, {
          code: "last_roles_admin",
          message:
            "Akun ini satu-satunya yang masih bisa mengelola role — tidak bisa dihapus",
        });

      await db.delete(schema.users).where(eq(schema.users.id, params.id));
      await invalidateUser(params.id);
      return { ok: true };
    },
    {
      auth: { menu: "users", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
      },
      detail: { summary: "Delete an account" },
    }
  )

  .post(
    "/:id/reset-password",
    async ({ params, status }) => {
      const [row] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, params.id))
        .limit(1);
      if (!row)
        return status(404, {
          code: "user_not_found",
          message: "Akun tidak ditemukan",
        });

      await db
        .update(schema.users)
        .set({
          passwordHash: await hashPassword(env.DEFAULT_USER_PASSWORD),
          // Re-arms the gate: the account authenticates but is refused
          // everywhere else until it sets a new password.
          mustChangePassword: true,
        })
        .where(eq(schema.users.id, params.id));
      await invalidateUser(params.id);
      return { ok: true };
    },
    {
      auth: { menu: "users", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: {
        summary: "Reset an account to the configured default password",
      },
    }
  );
