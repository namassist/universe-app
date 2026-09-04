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
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { MenuSlug, Scope } from "@universe/contracts";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { localDate } from "../scheduler";
import { dashboardRoutes } from "./dashboard";

const app = new Elysia().use(dashboardRoutes);
const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Dash ${uid()}`;

const made = {
  users: [] as string[],
  roles: [] as string[],
  rosterDocs: [] as string[],
};

/**
 * Employees this file may hand an account, with a roster row for today.
 *
 * Both halves matter and neither can be borrowed from the site. `users.nik` is
 * unique, so an employee the seed already gave an account to cannot be given a
 * second one — and the figures these tests compare count *today's* roster,
 * which a freshly seeded database has none of. Reading whatever the site
 * happened to hold is why these two passed on a database with a roster loaded
 * and failed on a clean one.
 */
async function rosteredWithoutAccount(count: number) {
  const rows = await db
    .select({ id: schema.employees.id, nik: schema.employees.nik })
    .from(schema.employees)
    .where(
      and(
        eq(schema.employees.status, "aktif"),
        sql`not exists (select 1 from users u where u.nik = ${schema.employees.nik})`
      )
    )
    .orderBy(asc(schema.employees.nik))
    .limit(count);
  if (rows.length < count)
    throw new Error("fixture: not enough employees without an account");
  await ensureRosterDoc();

  await db.insert(schema.rosterDays).values(
    rows.map((r) => ({
      documentId: rosterDocId!,
      employeeId: r.id,
      date: localDate(new Date()),
      code: "D" as const,
    }))
  );
  return rows;
}

/**
 * One document for the whole file.
 *
 * `roster_documents` is unique on (department, month) while active, so a helper
 * that filed its own each time collided with itself the second time it ran.
 */
let rosterDocId: string | null = null;
async function ensureRosterDoc(): Promise<void> {
  if (rosterDocId) return;
  const [department] = await db
    .select({ id: schema.departments.id })
    .from(schema.departments)
    .limit(1);
  const [doc] = await db
    .insert(schema.rosterDocuments)
    .values({
      departmentId: department!.id,
      month: `${localDate(new Date()).slice(0, 7)}-01`,
      fileName: `${tag}.xlsx`,
      uploadedBy: made.users[0]!,
    })
    .returning({ id: schema.rosterDocuments.id });
  rosterDocId = doc!.id;
  made.rosterDocs.push(doc!.id);
}

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
  // Roster days cascade with their document; the document references the
  // uploader, so it goes before the accounts.
  if (made.rosterDocs.length)
    await db
      .delete(schema.rosterDocuments)
      .where(inArray(schema.rosterDocuments.id, made.rosterDocs));
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
    const [employee] = await rosteredWithoutAccount(1);
    const body = await read(
      await account("self", ["dashboard", "attendance"], employee!.nik)
    );
    const attendance = body.attendance as { scheduled: number };
    expect(attendance.scheduled).toBe(1);
  });

  test("an account with no NIK reports on nobody, rather than everybody", async () => {
    // Fails closed: `scopeWhere` yields an empty set for a `self` caller it
    // cannot identify, so the figures are 0 — never the unfiltered site.
    const body = await read(await account("self", ["dashboard", "attendance"]));
    expect((body.attendance as { scheduled: number }).scheduled).toBe(0);
    expect(body.me).toBeNull();
  });

  test("an all-scope account sees more than a self one", async () => {
    // Two of its own, rostered today: one for the `self` account to be, and a
    // second so the site-wide figure has something more to count.
    const employees = await rosteredWithoutAccount(2);
    const wide = await read(await account("all", ["dashboard", "attendance"]));
    const narrow = await read(
      await account("self", ["dashboard", "attendance"], employees[1]!.nik)
    );
    expect(
      (wide.attendance as { scheduled: number }).scheduled
    ).toBeGreaterThan((narrow.attendance as { scheduled: number }).scheduled);
  });
});
