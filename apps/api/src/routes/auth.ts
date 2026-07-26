import { eq, or } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { requireSession } from "../auth/macro";
import { invalidateUser, loadPermissions, loadUser } from "../auth/principal";
import {
  checkPasswordPolicy,
  DUMMY_HASH,
  hashPassword,
  verifyPassword,
} from "../auth/password";
import {
  cookieAttributes,
  createSession,
  deleteSession,
  SESSION_COOKIE,
} from "../auth/session";
import { db, schema } from "../db";
import {
  ErrorSchema,
  PermissionsSchema,
  PrincipalSchema,
  UserPrincipalSchema,
} from "./schemas";

/**
 * One message and one shape for both failure modes. Distinguishing "no such
 * account" from "wrong password" turns login into an account enumerator.
 */
const LOGIN_FAILED = {
  code: "invalid_credentials",
  message: "Identifier atau password salah",
};

export const authRoutes = new Elysia({ prefix: "/auth", tags: ["auth"] })
  .use(requireSession)

  .post(
    "/login",
    async ({ body, cookie, status }) => {
      const identifier = body.identifier.trim();

      const [row] = await db
        .select({
          id: schema.users.id,
          passwordHash: schema.users.passwordHash,
          active: schema.users.active,
        })
        .from(schema.users)
        // Email first, then NIK — office staff carry one, field operators the
        // other, and the two namespaces cannot collide (an email has an @).
        .where(
          or(
            eq(schema.users.email, identifier),
            eq(schema.users.nik, identifier)
          )
        )
        .limit(1);

      // Verify even when there is no account, against a hash nobody can
      // present: without it the response time answers "does this identifier
      // exist" for free.
      const ok = await verifyPassword(
        body.password,
        row?.passwordHash ?? DUMMY_HASH
      );
      if (!row || !ok || !row.active) return status(401, LOGIN_FAILED);

      const user = await loadUser(row.id);
      if (!user) return status(401, LOGIN_FAILED);

      const transport = body.transport ?? "cookie";
      const session = await createSession("user", user.id, transport);
      const permissions = await loadPermissions(user.roleId);

      if (transport === "cookie") {
        cookie[SESSION_COOKIE]!.set({
          value: session.id,
          ...cookieAttributes(session.maxAge),
        });
      }

      return {
        principal: {
          kind: "user" as const,
          id: user.id,
          name: user.name,
          email: user.email,
          nik: user.nik,
          roleId: user.roleId,
          roleName: user.roleName,
          scope: user.scope,
          mustChangePassword: user.mustChangePassword,
        },
        permissions,
        // Only a bearer client is told the identifier; a browser gets the
        // httpOnly cookie and never sees it.
        ...(transport === "bearer" ? { sessionId: session.id } : {}),
      };
    },
    {
      body: t.Object({
        identifier: t.String({ minLength: 1 }),
        password: t.String({ minLength: 1 }),
        transport: t.Optional(
          t.Union([t.Literal("cookie"), t.Literal("bearer")])
        ),
      }),
      response: {
        200: t.Object({
          principal: UserPrincipalSchema,
          permissions: PermissionsSchema,
          sessionId: t.Optional(t.String()),
        }),
        401: ErrorSchema,
      },
      detail: { summary: "Log in with an email or a NIK" },
    }
  )

  .post(
    "/logout",
    async ({ sessionId, cookie }) => {
      await deleteSession(sessionId);
      cookie[SESSION_COOKIE]!.remove();
      return { ok: true };
    },
    {
      session: true,
      response: { 200: t.Object({ ok: t.Boolean() }), 401: ErrorSchema },
      detail: { summary: "End the current session" },
    }
  )

  .get(
    "/session",
    async ({ principal }) => ({
      principal,
      permissions:
        principal.kind === "user"
          ? await loadPermissions(principal.roleId)
          : {},
    }),
    {
      session: true,
      response: {
        200: t.Object({
          principal: PrincipalSchema,
          permissions: PermissionsSchema,
        }),
        401: ErrorSchema,
      },
      detail: { summary: "The caller's principal and effective permissions" },
    }
  )

  .post(
    "/change-password",
    async ({ body, principal, status }) => {
      if (principal.kind !== "user")
        return status(403, {
          code: "forbidden",
          message: "Perangkat display tidak punya password",
        });

      const [row] = await db
        .select({ passwordHash: schema.users.passwordHash })
        .from(schema.users)
        .where(eq(schema.users.id, principal.id))
        .limit(1);
      if (
        !row ||
        !(await verifyPassword(body.currentPassword, row.passwordHash))
      )
        return status(401, {
          code: "invalid_credentials",
          message: "Password saat ini salah",
        });

      const problem = checkPasswordPolicy(body.newPassword);
      if (problem) return status(422, problem);

      await db
        .update(schema.users)
        .set({
          passwordHash: await hashPassword(body.newPassword),
          mustChangePassword: false,
        })
        .where(eq(schema.users.id, principal.id));
      // The gate is read from the cached principal, so it stays armed until
      // this drops.
      await invalidateUser(principal.id);

      return { ok: true };
    },
    {
      session: true,
      body: t.Object({
        currentPassword: t.String({ minLength: 1 }),
        newPassword: t.String({ minLength: 1 }),
      }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Set a new password for the current account" },
    }
  );
