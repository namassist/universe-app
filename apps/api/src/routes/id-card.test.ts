/**
 * The ID card scan: what a card answers, and whose card a person may read.
 *
 * The assembly is tested through the route rather than under it, because what
 * is worth being wrong about here is the scope — a screen that resolves any
 * NIK is a way to read the register, and that is decided in the where clause.
 *
 * Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/routes/id-card.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { inArray, ne } from "drizzle-orm";

import { createSession, DEVICE_COOKIE, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { deletePhoto, writePhoto } from "../storage";
import { idCardRoutes } from "./id-card";

const app = new Elysia().use(idCardRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji Kartu ${uid()}`;
const digits = () =>
  `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;

const made = {
  users: [] as string[],
  roles: [] as string[],
  devices: [] as string[],
  employees: [] as string[],
};

/** Two people in two departments — the whole point of the scope test. */
const nikA = digits();
const nikB = digits();
const photoFile = `zz-kartu-${uid()}.jpg`;

const get = (path: string, cookie?: string) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      headers: cookie ? { cookie } : {},
    })
  );

async function makeUser(scope: "all" | "dept", nik?: string) {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-kartu-${uid()}`, name: tag, scope })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db
    .insert(schema.rolePermissions)
    .values([{ roleId: role!.id, menuSlug: "scan-id", mode: "view" }]);
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-${uid()}@uji.local`,
      name: tag,
      passwordHash: "x",
      roleId: role!.id,
      nik: nik ?? null,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(user!.id);
  const session = await createSession("user", user!.id, "cookie");
  return `${SESSION_COOKIE}=${session.id}`;
}

beforeAll(async () => {
  const [seed] = await db
    .select({
      companyId: schema.employees.companyId,
      positionId: schema.employees.positionId,
      departmentId: schema.employees.departmentId,
    })
    .from(schema.employees)
    .limit(1);
  /* A department that is genuinely not the first one's, so "somebody else's
     card" is a real case rather than two rows that happen to share one. */
  const [otherDept] = await db
    .select({ id: schema.departments.id })
    .from(schema.departments)
    .where(ne(schema.departments.id, seed!.departmentId))
    .limit(1);
  const rows = await db
    .insert(schema.employees)
    .values([
      { ...seed!, nik: nikA, name: `${tag} A`, photoFileName: photoFile },
      { ...seed!, nik: nikB, name: `${tag} B`, departmentId: otherDept!.id },
    ])
    .returning({ id: schema.employees.id });
  made.employees.push(...rows.map((r) => r.id));
  await writePhoto(photoFile, new Uint8Array([0xff, 0xd8, 0xff]).buffer);
});

afterAll(async () => {
  if (made.employees.length)
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, made.employees));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
  if (made.devices.length)
    await db
      .delete(schema.devices)
      .where(inArray(schema.devices.id, made.devices));
  await deletePhoto(photoFile);
  redis.disconnect();
});

describe("who may read a card", () => {
  test("no session gets 401", async () => {
    expect((await get(`/id-card/${nikA}`)).status).toBe(401);
    expect((await get(`/id-card/${nikA}/photo`)).status).toBe(401);
  });

  test("a paired screen is not a reader: kiosks never reach the register", async () => {
    const id = `ZZK${uid().toUpperCase()}`;
    await db.insert(schema.devices).values({ id, name: tag, kind: "att" });
    made.devices.push(id);
    const session = await createSession("device", id, "cookie");
    const cookie = `${DEVICE_COOKIE}=${session.id}`;
    expect((await get(`/id-card/${nikA}`, cookie)).status).toBe(403);
    expect((await get(`/id-card/${nikA}/photo`, cookie)).status).toBe(403);
  });

  test("a scope of all reads any card", async () => {
    const cookie = await makeUser("all");
    expect((await get(`/id-card/${nikA}`, cookie)).status).toBe(200);
    expect((await get(`/id-card/${nikB}`, cookie)).status).toBe(200);
  });

  /* A Manajer is scoped to his own department (owner, 2026-09-20): his own
     people resolve, everybody else's card is a 404 — the same 404 as a NIK
     that does not exist, because which is which is not his to learn. */
  test("a department scope reads its own people and nobody else's", async () => {
    const cookie = await makeUser("dept", nikA);
    expect((await get(`/id-card/${nikA}`, cookie)).status).toBe(200);
    expect((await get(`/id-card/${nikB}`, cookie)).status).toBe(404);
    expect((await get(`/id-card/${nikB}/photo`, cookie)).status).toBe(404);
  });

  test("a NIK nobody holds is a 404, whatever the scope", async () => {
    const cookie = await makeUser("all");
    expect((await get(`/id-card/${digits()}`, cookie)).status).toBe(404);
  });
});

describe("what the card says", () => {
  test("who the person is, and where the muster put them", async () => {
    const cookie = await makeUser("all");
    const body = (await (await get(`/id-card/${nikA}`, cookie)).json()) as {
      nik: string;
      name: string;
      photoFile: string | null;
      department: string | null;
      position: string | null;
      simper: string[];
      roster: string | null;
      shift: string | null;
      unit: string | null;
      area: string | null;
      bus: string | null;
      checkInAt: string | null;
    };
    expect(body.nik).toBe(nikA);
    expect(body.name).toBe(`${tag} A`);
    expect(body.photoFile).toBe(photoFile);
    expect(body.department).not.toBeNull();
    expect(body.position).not.toBeNull();
    /* Nothing was arranged for this person today, and the card invents
       nothing: no roster, no seat, no tap. */
    expect(body.roster).toBeNull();
    expect(body.unit).toBeNull();
    expect(body.checkInAt).toBeNull();
  });

  test("a card is read by its digits, however the barcode wrote them", async () => {
    const cookie = await makeUser("all");
    // Leading zeros and a prefix are what the cards carry; the register holds
    // the plain number.
    const res = await get(`/id-card/KBE-UDU-000${nikA}`, cookie);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { nik: string }).nik).toBe(nikA);
  });

  test("the photo of somebody the reader may see", async () => {
    const cookie = await makeUser("all");
    const res = await get(`/id-card/${nikA}/photo`, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/");
  });
});
