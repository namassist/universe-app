/**
 * The dashboard's two gates.
 *
 * What is worth pinning is not the arithmetic — every count here is a `count(*)`
 * somebody can read — but that a section the caller has no grant for never
 * reaches the wire, and that a `self` account's figures are about themselves.
 * Both are the kind of rule that fails silently: the screen would simply not
 * render a card it was sent, and nobody would know it had arrived.
 *
 *   bun --env-file=.env test src/routes/dashboard.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { inArray } from "drizzle-orm";
import type { MenuSlug, Scope } from "@universe/contracts";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { dashboardRoutes } from "./dashboard";

const app = new Elysia().use(dashboardRoutes);
const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Dash ${uid()}`;

const made = { users: [] as string[], roles: [] as string[] };

/** An account with exactly these grants and this scope, and nothing else. */
async function account(
  scope: Scope,
  grants: MenuSlug[],
  nik?: string
): Promise<string> {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-dash-${uid()}`, name: tag, scope })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db.insert(schema.rolePermissions).values(
    grants.map((menuSlug) => ({
      roleId: role!.id,
      menuSlug,
      mode: "view" as const,
    }))
  );
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-${uid()}@uji.local`,
      name: tag,
      passwordHash: "x",
      roleId: role!.id,
      ...(nik ? { nik } : {}),
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(user!.id);
  const session = await createSession("user", user!.id, "cookie");
  return `${SESSION_COOKIE}=${session.id}`;
}

const read = async (cookie: string) => {
  const response = await app.handle(
    new Request("http://localhost/dashboard", { headers: { cookie } })
  );
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
};

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();
});

afterAll(async () => {
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
});

describe("what a grant lets through", () => {
  test("a section the caller cannot see is absent, not zero", async () => {
    /* The distinction the whole payload rests on: null means "no grant", and a
       number means the number. Sending zeros for withheld sections would be
       indistinguishable from a quiet day — and would have sent the data. */
    const body = await read(await account("all", ["dashboard"]));
    for (const section of [
      "attendance",
      "ftw",
      "units",
      "revisions",
      "devices",
      "fleetConfig",
      "allocation",
    ])
      expect(body[section]).toBeNull();
  });

  test("a grant opens exactly its own section", async () => {
    const body = await read(await account("all", ["dashboard", "unit-status"]));
    expect(body.units).not.toBeNull();
    // …and nothing else came with it.
    expect(body.attendance).toBeNull();
    expect(body.ftw).toBeNull();
    expect(body.fleetConfig).toBeNull();
  });

  test("the attention panel carries only kinds the caller may see", async () => {
    const body = await read(
      await account("all", ["dashboard", "display-fleet"])
    );
    const kinds = new Set(
      (body.attention as { kind: string }[]).map((r) => r.kind)
    );
    expect([...kinds].every((k) => k === "display")).toBe(true);
  });
});

describe("how far scope reaches", () => {
  test("a self account counts only itself", async () => {
    /* The reason this endpoint applies scope at all: without it an operator's
       dashboard would report the whole site's attendance — a number that is
       both useless to them and none of their business. */
    const [employee] = await db
      .select({ nik: schema.employees.nik })
      .from(schema.employees)
      .limit(1);
    const body = await read(
      await account("self", ["dashboard", "attendance"], employee!.nik)
    );
    const attendance = body.attendance as { scheduled: number };
    expect(attendance.scheduled).toBeLessThanOrEqual(1);
  });

  test("an account with no NIK reports on nobody, rather than everybody", async () => {
    // Fails closed: `scopeWhere` yields an empty set for a `self` caller it
    // cannot identify, so the figures are 0 — never the unfiltered site.
    const body = await read(await account("self", ["dashboard", "attendance"]));
    expect((body.attendance as { scheduled: number }).scheduled).toBe(0);
    expect(body.me).toBeNull();
  });

  test("an all-scope account sees more than a self one", async () => {
    // A second employee, because `users.nik` is unique — the account in the
    // test above already holds the first one.
    const employees = await db
      .select({ nik: schema.employees.nik })
      .from(schema.employees)
      .limit(2);
    const wide = await read(await account("all", ["dashboard", "attendance"]));
    const narrow = await read(
      await account("self", ["dashboard", "attendance"], employees[1]!.nik)
    );
    expect(
      (wide.attendance as { scheduled: number }).scheduled
    ).toBeGreaterThan((narrow.attendance as { scheduled: number }).scheduled);
  });
});
