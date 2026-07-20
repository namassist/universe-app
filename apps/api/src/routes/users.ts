import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { USER_ROLES, type User } from "@universe/contracts";

import { db, schema, isUniqueViolation, type UserRow } from "../db";

/**
 * TypeBox schemas live here, not in @universe/contracts — they are runtime
 * values, and shipping them to the browser would drag Elysia into the bundle.
 *
 * `t.UnionEnum` keeps the literal union intact; `t.Union(USER_ROLES.map(t.Literal))`
 * widens the tuple to an array and every `role` downstream infers as `never`.
 */
const UserRoleSchema = t.UnionEnum(USER_ROLES);

const UserSchema = t.Object({
  id: t.String(),
  email: t.String({ format: "email" }),
  name: t.String(),
  role: UserRoleSchema,
  createdAt: t.String(),
});

const ErrorSchema = t.Object({
  code: t.String(),
  message: t.String(),
});

/** Postgres returns Date; the wire contract is an ISO string. */
function toUser(row: UserRow): User {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

export const usersRoutes = new Elysia({ prefix: "/users", tags: ["users"] })
  .get("/", async () => (await db.select().from(schema.users)).map(toUser), {
    response: { 200: t.Array(UserSchema) },
    detail: { summary: "List all users" },
  })

  .get(
    "/:id",
    async ({ params, status }) => {
      const [row] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, params.id))
        .limit(1);
      if (!row)
        return status(404, {
          code: "user_not_found",
          message: `No user with id ${params.id}`,
        });
      return toUser(row);
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: { 200: UserSchema, 404: ErrorSchema },
      detail: { summary: "Get one user by id" },
    }
  )

  .post(
    "/",
    async ({ body, status }) => {
      try {
        const [row] = await db.insert(schema.users).values(body).returning();
        return status(201, toUser(row!));
      } catch (error) {
        // Let the unique index decide instead of checking first — a
        // select-then-insert races two concurrent signups on the same email.
        if (isUniqueViolation(error, "users_email_unique")) {
          return status(409, {
            code: "email_taken",
            message: `${body.email} is already registered`,
          });
        }
        throw error;
      }
    },
    {
      // `role` is deliberately not accepted here: a caller must never pick its
      // own privilege level. New users get the column default ('member');
      // promoting someone belongs behind an authenticated admin-only route.
      //
      // Note also that `t.Optional(t.UnionEnum([...]))` injects the *first*
      // enum value when the field is absent, so an optional `role` here would
      // have silently made every signup an admin.
      body: t.Object({
        email: t.String({ format: "email" }),
        name: t.String({ minLength: 1 }),
      }),
      response: { 201: UserSchema, 409: ErrorSchema },
      detail: { summary: "Create a user" },
    }
  );
