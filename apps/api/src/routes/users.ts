import { asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { requireAuth } from "../auth/macro";
import { hashPassword } from "../auth/password";
import { invalidateUser } from "../auth/principal";
import {
  db,
  isForeignKeyViolation,
  isUniqueViolation,
  schema,
  type Transaction,
} from "../db";
import { env } from "../env";
import {
  extraRolesOf,
  isRoleSetFailure,
  lastRolesAdmin,
  lockRolesAdmin,
  Refusal,
  resolveRoleSet,
  ROLE_NOT_FOUND,
  rolesAdminExists,
  withRoles,
  writeExtras,
} from "./user-roles";
import {
  EmployeeSuggestionSchema,
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

/**
 * Resetting, switching off or deleting the account you are signed in with
 * locks you out, possibly mid-shift with nobody else on hand to let you back
 * in. The phone's Akun screen hides the buttons (docs/prd.md, Mobile app →
 * Superadmin); this is the same rule for every client. Your own password is
 * changed from your profile (`/auth/change-password`).
 */
const ownAccount = (action: string) => ({
  code: "own_account",
  message: `Akun yang sedang dipakai tidak bisa ${action}. Minta admin lain, atau ganti password dari Profil.`,
});
/** A uuid in capitals is still the same row to Postgres, so to this too. */
const isOwn = (principal: { kind: string; id: string }, id: string) =>
  principal.kind === "user" && principal.id.toLowerCase() === id.toLowerCase();

/** Far more than any person holds; a bound so a body cannot be unbounded. */
const MAX_ROLES = 20;

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

const baseQuery = (ex: typeof db | Transaction = db) =>
  ex
    .select(userColumns)
    .from(schema.users)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId));

/**
 * Whether a NIK names an employee.
 *
 * Enforced here rather than by a foreign key on `users.nik`, deliberately
 * (design D2): the two records have different lifetimes — deleting an employee
 * must not delete the account, and D10 refuses that deletion instead — and an
 * application rule can be relaxed per route the day an account that is not a
 * person is needed, where a constraint could not be.
 *
 * The reason to enforce it at all is functional, not tidiness: an account whose
 * role is scoped `dept` or `self` resolves its departemen *through* this NIK
 * (D9), so one that matches nobody is born blind. Refusing it at creation is
 * far better than handing over an account that silently shows nothing.
 *
 * The bootstrap superadmin is exempt by construction — the seed writes it
 * straight to the table and never comes through these routes — which is what
 * keeps the account that recovers a misconfigured installation from being
 * blocked by the master data that installation is missing.
 */
async function employeeExists(nik: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.employees.id })
    .from(schema.employees)
    .where(eq(schema.employees.nik, nik))
    .limit(1);
  return Boolean(row);
}

/** Every NIK the register carries — the import checks against this set. */
async function employeeNiks(): Promise<Set<string>> {
  const rows = await db
    .select({ nik: schema.employees.nik })
    .from(schema.employees);
  return new Set(rows.map((r) => r.nik));
}

const nikNotRegistered = (nik: string) => ({
  code: "nik_not_registered",
  message: `NIK ${nik} tidak terdaftar di data karyawan`,
});

/**
 * Roles by lowercase name, for the import. Slug is accepted too, so a file
 * written against the seed still loads.
 */
async function rolesByName(): Promise<
  Map<string, { id: string; name: string }>
> {
  const roles = await db.select().from(schema.roles);
  const byName = new Map(
    roles.map((r) => [r.name.toLowerCase(), { id: r.id, name: r.name }])
  );
  for (const r of roles)
    if (!byName.has(r.slug)) byName.set(r.slug, { id: r.id, name: r.name });
  return byName;
}

/** Existing accounts with a NIK, keyed for the import's two uniqueness checks. */
async function existingAccounts() {
  const rows = await withRoles(
    await db
      .select({
        id: schema.users.id,
        nik: schema.users.nik,
        name: schema.users.name,
        email: schema.users.email,
        roleId: schema.users.roleId,
        roleName: schema.roles.name,
        scope: schema.roles.scope,
      })
      .from(schema.users)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
  );
  const accounts: ExistingAccount[] = rows
    .filter((r): r is typeof r & { nik: string } => r.nik !== null)
    .map(({ roles, ...r }) => ({
      id: r.id,
      nik: r.nik,
      name: r.name,
      email: r.email,
      roleId: r.roleId,
      roleName: r.roleName,
      roleIds: roles.map((x) => x.id),
      roleNames: roles.map((x) => x.name),
    }));
  return {
    existingByNik: new Map(accounts.map((a) => [a.nik, a])),
    /** Keyed lowercase — an operator varying the case means the same mailbox. */
    existingByEmail: new Map(
      accounts.filter((a) => !!a.email).map((a) => [a.email!.toLowerCase(), a])
    ),
  };
}

/** Below this a NIK prefix matches half the register; above it, nobody types. */
const SUGGEST_MIN = 2;
const SUGGEST_MAX = 100;
const SUGGEST_LIMIT = 8;

/** `%`, `_` and the escape itself read as themselves in an ILIKE pattern. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Employees whose NIK starts with `q` or whose email contains it, NIK matches
 * first. Unscoped like every `/users` read: an account admin sees everyone.
 */
async function employeeSuggestions(q: string) {
  const emp = schema.employees;
  const users = schema.users;
  const needle = escapeLike(q);
  const byNik = ilike(emp.nik, `${needle}%`);
  const found = await db
    .select({ nik: emp.nik, name: emp.name, email: emp.email })
    .from(emp)
    .where(or(byNik, ilike(emp.email, `%${needle}%`)))
    .orderBy(sql`case when ${byNik} then 0 else 1 end`, asc(emp.nik))
    .limit(SUGGEST_LIMIT);
  if (!found.length) return [];

  // A second query rather than a correlated subquery: eight rows at most, and
  // two plain `in` lists cannot confuse one table's `nik` with the other's.
  // `users.email` is compared lowercased because an account's email keeps the
  // case it was typed in, while the register's is stored lowercased.
  const emails = found.flatMap((e) => (e.email ? [e.email] : []));
  const held = await db
    .select({
      nik: users.nik,
      email: sql<string | null>`lower(${users.email})`,
    })
    .from(users)
    .where(
      or(
        inArray(
          users.nik,
          found.map((e) => e.nik)
        ),
        emails.length ? inArray(sql`lower(${users.email})`, emails) : undefined
      )
    );
  const heldNiks = new Set(held.map((h) => h.nik));
  const heldEmails = new Set(held.map((h) => h.email));
  return found.map((e) => ({
    ...e,
    hasAccount:
      heldNiks.has(e.nik) || (e.email !== null && heldEmails.has(e.email)),
  }));
}

export const usersRoutes = new Elysia({ prefix: "/users", tags: ["users"] })
  .use(requireAuth)

  .get(
    "/",
    async () =>
      (await withRoles(await baseQuery().orderBy(schema.users.createdAt))).map(
        toUser
      ),
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

  /* ----------------------------------------------------------- suggestions
     Declared before /:id, like the import routes below. */

  .get(
    "/employee-suggestions",
    async ({ query }) => {
      const q = query.q?.trim() ?? "";
      return q.length < SUGGEST_MIN ? [] : employeeSuggestions(q);
    },
    {
      // `manage`, not `view`: it exists to fill the add/edit form, and it
      // reads the employee register for someone who may hold no employee
      // grant at all — so only for those who may write an account.
      auth: { menu: "users", mode: "manage" },
      query: t.Object({
        q: t.Optional(t.String({ maxLength: SUGGEST_MAX })),
      }),
      response: {
        200: t.Array(EmployeeSuggestionSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: {
        summary:
          "Employees matching a typed NIK (from its start) or email (anywhere)",
      },
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

      const roleByName = await rolesByName();

      const { existingByNik, existingByEmail } = await existingAccounts();

      const result = await validateWorkbook(
        await file.arrayBuffer(),
        file.name,
        roleByName,
        existingByNik,
        existingByEmail,
        await employeeNiks()
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

      const roleByName = await rolesByName();
      const roleIdByName = new Map(
        [...roleByName.values()].map((r) => [r.name, r.id])
      );

      const { existingByNik, existingByEmail } = await existingAccounts();

      const preview = await validateWorkbook(
        await file.arrayBuffer(),
        file.name,
        roleByName,
        existingByNik,
        existingByEmail,
        await employeeNiks()
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
          // A sheet replaces role sets wholesale, so it can strip the last
          // roles administrator as surely as the edit dialog can.
          await lockRolesAdmin(tx);
          const adminBefore = await rolesAdminExists(tx);
          for (const row of preview.rows) {
            // The first role written is the default; the rest are extras.
            const [roleId, ...extraIds] = row.roles.map((name) =>
              roleIdByName.get(name)!
            );
            if (row.kind === "new") {
              const [inserted] = await tx
                .insert(schema.users)
                .values({
                  nik: row.nik,
                  email: row.email,
                  name: row.nama,
                  passwordHash: defaultHash,
                  // Authenticates, then is refused everywhere until it sets its own.
                  mustChangePassword: true,
                  roleId: roleId!,
                  active: true,
                })
                .returning({ id: schema.users.id });
              await writeExtras(tx, inserted!.id, extraIds, { fresh: true });
              created++;
              continue;
            }
            const account = existingByNik.get(row.nik)!;
            await tx
              .update(schema.users)
              // Password deliberately untouched: an update must not reset the
              // credential of someone already using the system.
              .set({ name: row.nama, email: row.email, roleId: roleId! })
              .where(eq(schema.users.id, account.id));
            // The file states the whole set, so the extras are replaced.
            await writeExtras(tx, account.id, extraIds);
            touched.push(account.id);
            updated++;
          }
          if (adminBefore && !(await rolesAdminExists(tx)))
            throw lastRolesAdmin(
              "file ini akan melepas akses kelola role darinya"
            );
        });
      } catch (error) {
        if (error instanceof Refusal) return status(409, error.body); // last_roles_admin, the only one thrown here
        // A role the file names was deleted after validation.
        if (isForeignKeyViolation(error)) return status(422, ROLE_NOT_FOUND);
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
      return toUser((await withRoles([row]))[0]!);
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

      // The scope a role carries is a promise about every account holding it,
      // so each role in the set is checked, not only the default.
      const set = await resolveRoleSet(
        body.roleId,
        body.roleIds,
        [],
        body.nik ?? null
      );
      if (isRoleSetFailure(set)) return status(422, set);
      const role = set.defaultRole;
      if (body.nik && !(await employeeExists(body.nik)))
        return status(422, nikNotRegistered(body.nik));
      // Hashed before the transaction: argon2 is slow on purpose, and a pooled
      // connection should not wait on it.
      const passwordHash = await hashPassword(env.DEFAULT_USER_PASSWORD);

      try {
        const row = await db.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(schema.users)
            .values({
              email: body.email ?? null,
              nik: body.nik ?? null,
              name: body.name.trim(),
              passwordHash,
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
          await writeExtras(
            tx,
            inserted!.id,
            set.extras.map((r) => r.id),
            { fresh: true }
          );
          return inserted!;
        });
        return status(201, {
          ...toUser(row),
          roleName: role.name,
          scope: role.scope,
          roles: [role, ...set.extras].map(({ id, name, scope }) => ({
            id,
            name,
            scope,
          })),
        });
      } catch (error) {
        // A role in the set was deleted between the check and the write.
        if (isForeignKeyViolation(error)) return status(422, ROLE_NOT_FOUND);
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
        /** The default role — what a login acts as unless told otherwise. */
        roleId: t.String({ format: "uuid" }),
        /** Every role the account holds, the default among them. */
        roleIds: t.Optional(
          t.Array(t.String({ format: "uuid" }), { maxItems: MAX_ROLES })
        ),
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
    async ({ params, body, status, principal }) => {
      if (body.active === false && isOwn(principal, params.id))
        return status(409, ownAccount("dinonaktifkan"));
      // Checked when the caller *supplies* one, not on every edit: an account
      // predating this rule should still be renameable, and one that keeps its
      // NIK is not being "edited with a NIK".
      if (body.nik && !(await employeeExists(body.nik)))
        return status(422, nikNotRegistered(body.nik));

      let email: string | null = null;
      let nik: string | null = null;
      try {
        // Read, decide and write in one transaction, the account row locked:
        // an edit that read the role set before another edit committed would
        // otherwise write its stale extras back over it.
        await db.transaction(async (tx) => {
          await lockRolesAdmin(tx);
          const [locked] = await tx
            .select({ id: schema.users.id })
            .from(schema.users)
            .where(eq(schema.users.id, params.id))
            .for("update");
          if (!locked)
            throw new Refusal(404, {
              code: "user_not_found",
              message: "Akun tidak ditemukan",
            });
          const [current] = await baseQuery(tx)
            .where(eq(schema.users.id, params.id))
            .limit(1);

          nik = body.nik !== undefined ? body.nik : current!.nik;
          email = body.email !== undefined ? body.email : current!.email;
          if (!email && !nik)
            throw new Refusal(422, {
              code: "identifier_required",
              message: "Akun harus punya email atau NIK",
            });

          const currentExtras = (await extraRolesOf([params.id], tx)).get(
            params.id
          )!;
          const set = await resolveRoleSet(
            body.roleId ?? current!.roleId,
            body.roleIds,
            currentExtras.map((r) => r.id),
            nik,
            tx
          );
          if (isRoleSetFailure(set)) throw new Refusal(422, set);

          const adminBefore = await rolesAdminExists(tx);
          await tx
            .update(schema.users)
            .set({
              email,
              nik,
              ...(body.name !== undefined ? { name: body.name.trim() } : {}),
              roleId: set.defaultRole.id,
              ...(body.active !== undefined ? { active: body.active } : {}),
            })
            .where(eq(schema.users.id, params.id));
          await writeExtras(
            tx,
            params.id,
            set.extras.map((r) => r.id)
          );
          // Switching the account off and taking a role away can both leave
          // nobody able to administer roles — more easily now that an account
          // holds several. Asked after the write, under the lock.
          if (adminBefore && !(await rolesAdminExists(tx)))
            throw lastRolesAdmin(
              body.active === false
                ? "tidak bisa dinonaktifkan"
                : "role tersebut tidak bisa dilepas"
            );
        });
      } catch (error) {
        if (error instanceof Refusal) return status(error.status, error.body);
        if (isForeignKeyViolation(error)) return status(422, ROLE_NOT_FOUND);
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

      // Role reassignment applies on the next request, not at re-login — and a
      // session acting as a role taken away is refused from then on.
      await invalidateUser(params.id);
      const [row] = await baseQuery()
        .where(eq(schema.users.id, params.id))
        .limit(1);
      return toUser((await withRoles([row!]))[0]!);
    },
    {
      auth: { menu: "users", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        email: t.Optional(t.Nullable(t.String({ format: "email" }))),
        nik: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
        name: t.Optional(t.String({ minLength: 1 })),
        roleId: t.Optional(t.String({ format: "uuid" })),
        /** Replaces the whole set; omitted keeps the extras as they are. */
        roleIds: t.Optional(
          t.Array(t.String({ format: "uuid" }), { maxItems: MAX_ROLES })
        ),
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
    async ({ params, status, principal }) => {
      if (isOwn(principal, params.id))
        return status(409, ownAccount("dihapus"));
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
      try {
        await db.transaction(async (tx) => {
          await lockRolesAdmin(tx);
          const adminBefore = await rolesAdminExists(tx);
          await tx.delete(schema.users).where(eq(schema.users.id, params.id));
          if (adminBefore && !(await rolesAdminExists(tx)))
            throw lastRolesAdmin("tidak bisa dihapus");
        });
      } catch (error) {
        if (error instanceof Refusal) return status(409, error.body); // last_roles_admin, the only one thrown here
        throw error;
      }
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
    async ({ params, status, principal }) => {
      if (isOwn(principal, params.id))
        return status(409, ownAccount("direset"));
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
        409: ErrorSchema,
      },
      detail: {
        summary: "Reset an account to the configured default password",
      },
    }
  );
