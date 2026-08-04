/**
 * Manual readiness sync — who may pull, who may look, and what a pull says.
 *
 * Needs the dev Postgres and Redis, and — for the 200-path tests — network
 * reach to the two readiness sources, the same reach the scheduled ingest
 * needs. The pulls are real but idempotent: they amend today's snapshot the
 * same way the morning window does.
 *
 *   bun --env-file=.env test src/routes/ingest-sync.test.ts
 */

import { afterAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { attendanceSyncRoutes, fitToWorkSyncRoutes } from "./ingest-sync";

const app = new Elysia().use(fitToWorkSyncRoutes).use(attendanceSyncRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji Ingest ${uid()}`;

const made = { users: [] as string[], roles: [] as string[] };

async function makeUser(
  menu: "fit-to-work" | "attendance",
  mode: "view" | "manage"
) {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-ingest-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db
    .insert(schema.rolePermissions)
    .values([{ roleId: role!.id, menuSlug: menu, mode }]);
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-${uid()}@uji.local`,
      name: tag,
      passwordHash: "x",
      roleId: role!.id,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(user!.id);
  const session = await createSession("user", user!.id, "cookie");
  return { cookie: `${SESSION_COOKIE}=${session.id}` };
}

const send = (method: string, path: string, cookie?: string) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: cookie ? { cookie } : {},
    })
  );

afterAll(async () => {
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
  redis.disconnect();
});

describe("authorization", () => {
  test("no session gets 401, for the pull and the status both", async () => {
    expect((await send("POST", "/fit-to-work/sync")).status).toBe(401);
    expect((await send("GET", "/fit-to-work/sync-status")).status).toBe(401);
    expect((await send("POST", "/attendance/sync")).status).toBe(401);
    expect((await send("GET", "/attendance/sync-status")).status).toBe(401);
  });

  test("view may read the status but not pull", async () => {
    const viewer = await makeUser("fit-to-work", "view");
    expect(
      (await send("POST", "/fit-to-work/sync", viewer.cookie)).status
    ).toBe(403);
    expect(
      (await send("GET", "/fit-to-work/sync-status", viewer.cookie)).status
    ).toBe(200);
  });

  test("the fit-to-work permission does not open the attendance pull", async () => {
    const manager = await makeUser("fit-to-work", "manage");
    expect(
      (await send("POST", "/attendance/sync", manager.cookie)).status
    ).toBe(403);
  });
});

describe("a manual pull", () => {
  test("returns its honest accounting and moves the status stamp", async () => {
    const manager = await makeUser("attendance", "manage");

    const res = await send("POST", "/attendance/sync", manager.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      fetched: number;
      upserted: number;
      skipped: number;
      syncedAt: string;
    };
    expect(body.fetched).toBeGreaterThanOrEqual(0);
    expect(body.upserted + body.skipped).toBe(body.fetched);
    expect(new Date(body.syncedAt).toString()).not.toBe("Invalid Date");

    const status = await send("GET", "/attendance/sync-status", manager.cookie);
    expect(status.status).toBe(200);
    const { lastSyncedAt } = (await status.json()) as {
      lastSyncedAt: string | null;
    };
    expect(lastSyncedAt).not.toBeNull();
  });
});
