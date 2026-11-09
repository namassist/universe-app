import { eq, or } from "drizzle-orm";
import { Elysia, t } from "elysia";

import {
  reserveLoginAttempt,
  settleLoginSuccess,
} from "../auth/login-throttle";
import { requireSession } from "../auth/macro";
import { invalidateUser, loadPermissions, loadUser } from "../auth/principal";
import {
  checkPasswordPolicy,
  DUMMY_HASH,
  hashPassword,
  verifyPassword,
} from "../auth/password";
import {
  DEFAULT_PASSWORD_HASH,
  provisionableEmployee,
  provisionUser,
} from "../auth/provision";
import {
  cookieAttributes,
  createSession,
  deleteSession,
  SESSION_COOKIE,
} from "../auth/session";
import { onSiteNetwork } from "../auth/site-network";
import { forgetSessionDevices } from "../push/devices";
import { db, schema } from "../db";
import { clientIp } from "../ops/client-ip";
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

/**
 * Only said to somebody who presented the right password, so it tells a
 * stranger nothing a stranger could use: the account is waiting for a first
 * login, and that login cannot happen from where they are.
 */
const FIRST_LOGIN_ON_SITE = {
  code: "first_login_on_site",
  message:
    "Login pertama harus dari jaringan site. Setelah password diganti, akun bisa dipakai dari mana saja.",
};

export const authRoutes = new Elysia({ prefix: "/auth", tags: ["auth"] })
  .use(requireSession)

  .post(
    "/login",
    async ({ body, cookie, request, server, set, status }) => {
      const identifier = body.identifier.trim();
      const ip = clientIp(request, server);
      const onSite = onSiteNetwork(ip);

      // Spent before anything is looked up or verified, so a locked-out
      // guesser learns nothing even by trying the right password.
      const attempt = await reserveLoginAttempt(identifier, ip, onSite);
      if (attempt.kind === "locked") {
        set.headers["retry-after"] = String(attempt.retryAfter);
        return status(429, {
          code: "too_many_attempts",
          message: `Terlalu banyak percobaan login. Coba lagi dalam ${Math.ceil(attempt.retryAfter / 60)} menit.`,
        });
      }

      const [row] = await db
        .select({
          id: schema.users.id,
          passwordHash: schema.users.passwordHash,
          active: schema.users.active,
          mustChangePassword: schema.users.mustChangePassword,
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

      // No account yet? The employee register decides whether there should be
      // one. Resolved before the verify rather than after, so all three cases
      // spend the same argon2id time — see auth/provision.
      const candidate = row ? null : await provisionableEmployee(identifier);

      // Verify even when there is nothing to verify against, using a hash
      // nobody can present: without it the response time answers "does this
      // identifier exist" for free.
      const ok = await verifyPassword(
        body.password,
        row?.passwordHash ?? (candidate ? DEFAULT_PASSWORD_HASH : DUMMY_HASH)
      );
      if (!ok || (row && !row.active)) return status(401, LOGIN_FAILED);

      // The issued password is one everybody was given and NIKs are printed
      // on every ID card, so from the internet it would open any account not
      // yet claimed. Checked before provisioning: no account is created from
      // outside.
      if (!onSite && (candidate || row?.mustChangePassword))
        return status(403, FIRST_LOGIN_ON_SITE);

      const id = row
        ? row.id
        : candidate
          ? await provisionUser(candidate)
          : null;
      if (!id) return status(401, LOGIN_FAILED);

      const user = await loadUser(id);
      if (!user) return status(401, LOGIN_FAILED);
      await settleLoginSuccess(identifier, ip);

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
        403: ErrorSchema,
        429: ErrorSchema,
      },
      detail: { summary: "Log in with an email or a NIK" },
    }
  )

  .post(
    "/logout",
    async ({ sessionId, cookie }) => {
      /* The phone this session registered stops receiving pushes: a device
         handed to the next shift's operator must not keep buzzing with the
         last one's seat. */
      await forgetSessionDevices(sessionId);
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
