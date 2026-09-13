/**
 * The printer registry — CRUD, and the refusals that matter: an address that
 * is not an address, and an address already claimed.
 *
 * The pairing itself is tested with the machines, because that is where the
 * column lives.
 *
 * Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/routes/printers.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { printerRoutes } from "./printers";

const app = new Elysia().use(printerRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji Printer ${uid()}`;

/** Documentation range (TEST-NET-3) — never a real printer on site. */
const ipOf = (last: number) => `203.0.113.${last}`;

const made = {
  users: [] as string[],
  roles: [] as string[],
  printers: [] as string[],
};

let admin: { cookie: string };
let viewer: { cookie: string };

type Printer = {
  id: string;
  name: string;
  ip: string;
  port: number;
  active: boolean;
  createdAt: string;
};

async function makeUser(mode: "view" | "manage") {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-printer-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db
    .insert(schema.rolePermissions)
    .values([{ roleId: role!.id, menuSlug: "mesin-printer", mode }]);
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

const send = (method: string, path: string, cookie?: string, body?: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  );

async function create(
  body: { name: string; ip: string; port?: number; active?: boolean },
  cookie = admin.cookie
) {
  const response = await send("POST", "/printers", cookie, body);
  if (response.status === 201) {
    const row = (await response.clone().json()) as Printer;
    made.printers.push(row.id);
  }
  return response;
}

beforeAll(async () => {
  // scheduler.test.ts disconnects the shared client in its teardown, and bun
  // runs every file in one process.
  if (redis.status === "end") await redis.connect();
  admin = await makeUser("manage");
  viewer = await makeUser("view");
});

afterAll(async () => {
  if (made.printers.length)
    await db
      .delete(schema.printers)
      .where(inArray(schema.printers.id, made.printers));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
});

describe("registry CRUD", () => {
  test("creates a printer and lists it back", async () => {
    const ip = ipOf(51);
    const created = await create({ name: `${tag} SATU`, ip });
    expect(created.status).toBe(201);

    const row = (await created.json()) as Printer;
    expect(row.ip).toBe(ip);
    // The port every printer on site answers on, so it is not asked for.
    expect(row.port).toBe(9100);
    expect(row.active).toBe(true);

    const listed = await send("GET", "/printers", viewer.cookie);
    expect(listed.status).toBe(200);
    const rows = (await listed.json()) as Printer[];
    expect(rows.find((r) => r.ip === ip)?.name).toBe(`${tag} SATU`);
  });

  test("trims a padded name and address", async () => {
    const created = await create({
      name: `   ${tag} SPASI   `,
      ip: `  ${ipOf(52)}  `,
    });
    expect(created.status).toBe(201);
    const row = (await created.json()) as Printer;
    expect(row.name).toBe(`${tag} SPASI`);
    expect(row.ip).toBe(ipOf(52));
  });

  test("renames and deactivates through PATCH", async () => {
    const created = await create({ name: `${tag} EDIT`, ip: ipOf(53) });
    const row = (await created.json()) as Printer;

    const patched = await send("PATCH", `/printers/${row.id}`, admin.cookie, {
      name: `${tag} EDITED`,
      active: false,
    });
    expect(patched.status).toBe(200);
    const updated = (await patched.json()) as Printer;
    expect(updated.name).toBe(`${tag} EDITED`);
    expect(updated.active).toBe(false);
    // Untouched fields survive a partial update.
    expect(updated.ip).toBe(ipOf(53));
  });

  test("deletes once, then reports the row gone", async () => {
    const created = await create({ name: `${tag} HAPUS`, ip: ipOf(54) });
    const row = (await created.json()) as Printer;

    expect(
      (await send("DELETE", `/printers/${row.id}`, admin.cookie)).status
    ).toBe(200);
    expect(
      (await send("DELETE", `/printers/${row.id}`, admin.cookie)).status
    ).toBe(404);
  });
});

describe("the two refusals", () => {
  test("an address that is not an address is 422", async () => {
    const bad = await create({ name: `${tag} SALAH`, ip: "192.168.1.300" });
    expect(bad.status).toBe(422);
  });

  test("an address already registered is 409", async () => {
    const ip = ipOf(55);
    expect((await create({ name: `${tag} A`, ip })).status).toBe(201);
    const second = await create({ name: `${tag} B`, ip });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { code: string }).code).toBe("ip_taken");
  });
});

describe("permissions", () => {
  test("view access cannot create", async () => {
    const denied = await create(
      { name: `${tag} TOLAK`, ip: ipOf(56) },
      viewer.cookie
    );
    expect(denied.status).toBe(403);
  });

  test("no session cannot list", async () => {
    expect((await send("GET", "/printers")).status).toBe(401);
  });
});
