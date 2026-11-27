/**
 * One account, several roles, one role per session.
 *
 * A person who is both Superadmin and Pengawas Lapangan holds one account with
 * both roles. Login acts as the default unless the caller names another role
 * it holds; the topbar switches the session's role without a password. What is
 * pinned here is what cannot be seen from the screen: that a role the account
 * does not hold is never granted, that permissions follow the *active* role and
 * nothing else, and that a role taken away ends the session acting as it.
 *
 *   bun --env-file=.env test src/routes/auth-roles.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";

import { requireAuth } from "../auth/macro";
import { hashPassword } from "../auth/password";
import { invalidateUser } from "../auth/principal";
import { createSession, setSessionRole } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { authRoutes } from "./auth";

/** A gate per role, so a test can ask "does this session act as X". */
const gated = new Elysia()
  .use(requireAuth)
  .get("/as-default", () => "ok", { auth: { menu: "users", mode: "view" } })
  .get("/as-extra", () => "ok", { auth: { menu: "roles", mode: "view" } });

const app = new Elysia().use(authRoutes).use(gated);
const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Roles ${uid()}`;
const PASSWORD = "password-sendiri-123";

const made = {
  roles: [] as string[],
  users: [] as string[],
};
/** Default role: may see Users. */
let defaultRole = "";
/** Extra role: may see Roles. */
let extraRole = "";
/** Exists, but no fixture account holds it. */
let foreignRole = "";

let account = "";
let email = "";
let gatedEmail = "";

async function role(name: string, menu: "users" | "roles" | null) {
  const [row] = await db
    .insert(schema.roles)
    .values({ slug: `zz-roles-${uid()}`, name: `${tag} ${name}`, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(row!.id);
  if (menu)
    await db
      .insert(schema.rolePermissions)
      .values({ roleId: row!.id, menuSlug: menu, mode: "view" });
  return row!.id;
}

async function user(mail: string, mustChangePassword: boolean) {
  const [row] = await db
    .insert(schema.users)
    .values({
      email: mail,
      name: `${tag} ${mail}`,
      passwordHash: await hashPassword(PASSWORD),
      mustChangePassword,
      roleId: defaultRole,
      active: true,
    })
    .returning({ id: schema.users.id });
  made.users.push(row!.id);
  await db
    .insert(schema.userRoles)
    .values({ userId: row!.id, roleId: extraRole });
  return row!.id;
}

type Principal = {
  roleId: string;
  roleName: string;
  roles: { id: string; name: string; scope: string }[];
};
type LoginBody = {
  principal: Principal;
  permissions: Record<string, string>;
  sessionId?: string;
};

const login = (identifier: string, roleId?: string) =>
  app.handle(
    new Request("http://localhost/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "192.168.10.10",
      },
      body: JSON.stringify({
        identifier,
        password: PASSWORD,
        transport: "bearer",
        ...(roleId ? { roleId } : {}),
      }),
    })
  );

const bearer = (sessionId: string) => ({
  authorization: `Bearer ${sessionId}`,
});

const get = (path: string, sessionId: string) =>
  app.handle(
    new Request(`http://localhost${path}`, { headers: bearer(sessionId) })
  );

const switchRole = (sessionId: string, roleId: string) =>
  app.handle(
    new Request("http://localhost/auth/switch-role", {
      method: "POST",
      headers: { ...bearer(sessionId), "content-type": "application/json" },
      body: JSON.stringify({ roleId }),
    })
  );

async function sessionOf(sessionId: string) {
  const res = await get("/auth/session", sessionId);
  return { status: res.status, body: (await res.json()) as LoginBody };
}

async function signIn(identifier: string, roleId?: string) {
  const res = await login(identifier, roleId);
  expect(res.status).toBe(200);
  const body = (await res.json()) as LoginBody;
  return { ...body, sessionId: body.sessionId! };
}

const previousProxy = process.env.TRUST_PROXY;

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();
  process.env.TRUST_PROXY = "true";
  defaultRole = await role("Default", "users");
  extraRole = await role("Extra", "roles");
  foreignRole = await role("Foreign", "roles");
  email = `zz-roles-${uid()}@uji.local`;
  gatedEmail = `zz-roles-gated-${uid()}@uji.local`;
  account = await user(email, false);
  await user(gatedEmail, true);
});

afterAll(async () => {
  if (previousProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = previousProxy;
  await Promise.all(made.users.map(invalidateUser));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
});

describe("login", () => {
  test("acts as the default role, and offers every role held", async () => {
    const { principal, permissions, sessionId } = await signIn(email);

    expect(principal.roleId).toBe(defaultRole);
    // Default first: it is what the picker pre-selects.
    expect(principal.roles.map((r) => r.id)).toEqual([defaultRole, extraRole]);
    expect(permissions).toEqual({ users: "view" });

    expect((await get("/as-default", sessionId)).status).toBe(200);
    expect((await get("/as-extra", sessionId)).status).toBe(403);
  });

  test("acts as another held role when asked to", async () => {
    const { principal, permissions, sessionId } = await signIn(
      email,
      extraRole
    );

    expect(principal.roleId).toBe(extraRole);
    expect(principal.roleName).toBe(`${tag} Extra`);
    expect(permissions).toEqual({ roles: "view" });

    const session = await sessionOf(sessionId);
    expect(session.body.principal.roleId).toBe(extraRole);
    expect((await get("/as-extra", sessionId)).status).toBe(200);
    // The default's grants do not come along: one role per session.
    expect((await get("/as-default", sessionId)).status).toBe(403);
  });

  test("refuses a role the account does not hold, and issues no session", async () => {
    const res = await login(email, foreignRole);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string; sessionId?: string };
    expect(body.code).toBe("role_not_held");
    expect(body.sessionId).toBeUndefined();
  });

  test("takes the role id in capitals, and keeps the canonical one", async () => {
    const { principal, sessionId } = await signIn(
      email,
      extraRole.toUpperCase()
    );
    expect(principal.roleId).toBe(extraRole);
    const stored = JSON.parse((await redis.get(`session:${sessionId}`))!) as {
      roleId: string;
    };
    expect(stored.roleId).toBe(extraRole);
  });
});

describe("switching role", () => {
  test("moves the session to another held role, no password asked", async () => {
    const { sessionId } = await signIn(email);

    const res = await switchRole(sessionId, extraRole);
    expect(res.status).toBe(200);
    const body = (await res.json()) as LoginBody;
    expect(body.principal.roleId).toBe(extraRole);
    expect(body.permissions).toEqual({ roles: "view" });

    expect((await get("/as-extra", sessionId)).status).toBe(200);
    expect((await get("/as-default", sessionId)).status).toBe(403);

    // And back.
    expect((await switchRole(sessionId, defaultRole)).status).toBe(200);
    expect((await get("/as-default", sessionId)).status).toBe(200);
  });

  test("refuses a role the account does not hold, and keeps the session as it was", async () => {
    const { sessionId } = await signIn(email);

    const res = await switchRole(sessionId, foreignRole);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("role_not_held");
    expect((await sessionOf(sessionId)).body.principal.roleId).toBe(
      defaultRole
    );
  });

  test("is allowed before the issued password is changed", async () => {
    // The login picker runs before the change-password screen.
    const { sessionId } = await signIn(gatedEmail);
    expect((await switchRole(sessionId, extraRole)).status).toBe(200);
    expect((await sessionOf(sessionId)).body.principal.roleId).toBe(extraRole);
  });

  test("does not open the gate: a switched session still changes its password first", async () => {
    const { sessionId } = await signIn(gatedEmail);
    await switchRole(sessionId, extraRole);
    const res = await get("/as-extra", sessionId);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe(
      "password_change_required"
    );
  });

  test("never brings back a session that has ended", async () => {
    const { sessionId } = await signIn(email);
    await redis.del(`session:${sessionId}`);
    // As if logout landed between the switch's read and its write.
    expect(await setSessionRole(sessionId, extraRole)).toBe(false);
    expect(await redis.exists(`session:${sessionId}`)).toBe(0);
  });

  test("needs a session", async () => {
    const res = await app.handle(
      new Request("http://localhost/auth/switch-role", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleId: extraRole }),
      })
    );
    expect(res.status).toBe(401);
  });
});

describe("a role taken away", () => {
  test("ends a session acting as it, on the next request", async () => {
    const mail = `zz-roles-taken-${uid()}@uji.local`;
    const id = await user(mail, false);
    const { sessionId } = await signIn(mail, extraRole);

    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, id));
    // The users route drops the cached principal beside the write.
    await invalidateUser(id);

    expect((await get("/as-extra", sessionId)).status).toBe(401);
    // Not merely refused: the session is gone, so nothing lingers in Redis.
    expect(await redis.exists(`session:${sessionId}`)).toBe(0);
    expect((await sessionOf(sessionId)).status).toBe(401);
  });

  test("leaves a session acting as the default untouched", async () => {
    const mail = `zz-roles-kept-${uid()}@uji.local`;
    const id = await user(mail, false);
    const { sessionId } = await signIn(mail);

    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, id));
    await invalidateUser(id);

    expect((await get("/as-default", sessionId)).status).toBe(200);
    const { body } = await sessionOf(sessionId);
    expect(body.principal.roles.map((r) => r.id)).toEqual([defaultRole]);
  });
});

describe("a session from before multi-role accounts", () => {
  test("carries no role, and acts as the default", async () => {
    // What every session in Redis looks like on the day this deploys.
    const legacy = await createSession("user", account, "bearer");
    const { status, body } = await sessionOf(legacy.id);
    expect(status).toBe(200);
    expect(body.principal.roleId).toBe(defaultRole);
    expect((await get("/as-default", legacy.id)).status).toBe(200);
  });
});
