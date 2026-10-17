/**
 * `/me`: the signed-in person's own muster, for the mobile app. No menu, only
 * a person: whatever the role, these routes answer about the caller's own NIK
 * and nobody else's, so there is nothing for a grant to widen.
 *
 *   bun --env-file=.env test src/routes/me.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";

import { createSession, DEVICE_COOKIE, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { authRoutes } from "./auth";
import { meRoutes } from "./me";

const app = new Elysia().use(meRoutes).use(authRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji Me ${uid()}`;
const ME = "99090001";
const OTHER = "99090002";

const made = {
  company: "",
  department: "",
  position: "",
  employees: [] as string[],
  masters: [] as {
    table: "unitClasses" | "unitTypes" | "unitModels" | "unitBrands";
    id: string;
  }[],
  unit: "",
  docs: [] as string[],
  users: [] as string[],
  devices: [] as string[],
};
let unitCode = "";
let myAccount = "";

async function account(over: { nik?: string | null; mustChange?: boolean }) {
  const [role] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.slug, "user"))
    .limit(1);
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-me-${uid()}@uji.local`,
      nik: over.nik ?? null,
      name: tag,
      passwordHash: "x",
      roleId: role!.id,
      mustChangePassword: over.mustChange ?? false,
    })
    .returning({ id: schema.users.id });
  made.users.push(user!.id);
  return user!.id;
}

const cookieFor = async (userId: string) =>
  `${SESSION_COOKIE}=${(await createSession("user", userId, "cookie")).id}`;

const get = (path: string, headers: Record<string, string> = {}) =>
  app.handle(new Request(`http://localhost${path}`, { headers }));
const send = (method: string, path: string, cookie: string, body?: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        cookie,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );

let mine = "";

beforeAll(async () => {
  const [company] = await db
    .insert(schema.companies)
    .values({ name: `${tag} PT`, code: `ZE${uid().slice(0, 4)}` })
    .returning({ id: schema.companies.id });
  made.company = company!.id;
  const [department] = await db
    .insert(schema.departments)
    .values({ name: `${tag} Dept`, companyId: made.company })
    .returning({ id: schema.departments.id });
  made.department = department!.id;
  const [position] = await db
    .insert(schema.positions)
    .values({
      name: `${tag} Operator`,
      departmentId: made.department,
      fleetAllocation: true,
    })
    .returning({ id: schema.positions.id });
  made.position = position!.id;
  const employees = await db
    .insert(schema.employees)
    .values(
      [ME, OTHER].map((nik) => ({
        nik,
        name: `${tag} ${nik}`,
        companyId: made.company,
        departmentId: made.department,
        positionId: made.position,
        status: "aktif" as const,
      }))
    )
    .returning({ id: schema.employees.id, nik: schema.employees.nik });
  made.employees.push(...employees.map((e) => e.id));
  const idOf = (nik: string) => employees.find((e) => e.nik === nik)!.id;

  const master = async (
    table: "unitClasses" | "unitTypes" | "unitModels" | "unitBrands"
  ) => {
    const [row] = await db
      .insert(schema[table])
      .values({ name: `${tag} ${table}` })
      .returning({ id: schema[table].id });
    made.masters.push({ table, id: row!.id });
    return row!.id;
  };
  const [unit] = await db
    .insert(schema.units)
    .values({
      code: `ZZE-${uid()}`,
      classId: await master("unitClasses"),
      typeId: await master("unitTypes"),
      modelId: await master("unitModels"),
      brandId: await master("unitBrands"),
    })
    .returning({ id: schema.units.id, code: schema.units.code });
  made.unit = unit!.id;
  unitCode = unit!.code;

  /* Two past boards with a seat for me, and one with a seat for somebody
     else that must not show. */
  const docs = await db
    .insert(schema.fleetActualDocuments)
    .values([
      { date: "1998-04-01", shift: "day" },
      { date: "1998-04-02", shift: "night" },
      { date: "1998-04-03", shift: "day" },
      /* A board for a shift still to come, as one regenerated early would
         be: it must never show here. */
      { date: "2999-01-01", shift: "day" },
    ])
    .returning({ id: schema.fleetActualDocuments.id });
  made.docs.push(...docs.map((d) => d.id));
  await db.insert(schema.fleetActualSlots).values([
    {
      documentId: docs[0]!.id,
      unitId: made.unit,
      employeeId: idOf(ME),
      source: "plan",
      workArea: "PIT 1",
      transportCode: "BUS 1",
    },
    {
      documentId: docs[1]!.id,
      unitId: made.unit,
      employeeId: idOf(ME),
      source: "spare",
      workArea: "PIT 2",
    },
    {
      documentId: docs[2]!.id,
      unitId: made.unit,
      employeeId: idOf(OTHER),
      source: "plan",
    },
    {
      documentId: docs[3]!.id,
      unitId: made.unit,
      employeeId: idOf(ME),
      source: "spare",
    },
  ]);

  myAccount = await account({ nik: ME });
  mine = await cookieFor(myAccount);
});

afterAll(async () => {
  if (made.docs.length)
    await db
      .delete(schema.fleetActualDocuments)
      .where(inArray(schema.fleetActualDocuments.id, made.docs));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.devices.length)
    await db
      .delete(schema.devices)
      .where(inArray(schema.devices.id, made.devices));
  if (made.employees.length)
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, made.employees));
  if (made.unit)
    await db.delete(schema.units).where(eq(schema.units.id, made.unit));
  for (const { table, id } of made.masters)
    await db.delete(schema[table]).where(eq(schema[table].id, id));
  if (made.position)
    await db
      .delete(schema.positions)
      .where(eq(schema.positions.id, made.position));
  if (made.department)
    await db
      .delete(schema.departments)
      .where(eq(schema.departments.id, made.department));
  if (made.company)
    await db
      .delete(schema.companies)
      .where(eq(schema.companies.id, made.company));
});

const SEATS = "/me/seats?from=1998-04-01&to=1998-04-05";

describe("who may ask", () => {
  test("no session gets 401", async () => {
    expect((await get("/me/shift")).status).toBe(401);
    expect((await get(SEATS)).status).toBe(401);
  });

  test("a paired screen is not a person", async () => {
    const id = `ZZE${uid().toUpperCase()}`;
    await db.insert(schema.devices).values({ id, name: tag, kind: "att" });
    made.devices.push(id);
    const session = await createSession("device", id, "cookie");
    const cookie = `${DEVICE_COOKIE}=${session.id}`;
    expect((await get("/me/shift", { cookie })).status).toBe(403);
  });

  test("an account still on the issued password changes it first", async () => {
    const cookie = await cookieFor(await account({ mustChange: true }));
    const res = await get("/me/shift", { cookie });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe(
      "password_change_required"
    );
  });

  test("an account with no NIK has no muster to show", async () => {
    const cookie = await cookieFor(await account({ nik: null }));
    const res = await get("/me/shift", { cookie });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("no_employee");
  });

  test("a mobile client's bearer is a session like the cookie", async () => {
    const session = await createSession("user", myAccount, "bearer");
    const res = await get("/me/shift", {
      authorization: `Bearer ${session.id}`,
    });
    expect(res.status).toBe(200);
  });
});

describe("the coming shift", () => {
  test("answers for the caller's own NIK, whichever shift the timeline is on", async () => {
    const res = await get("/me/shift", { cookie: mine });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      shift: { status: string; phase: string; date: string } | null;
    };
    // The timeline in this database decides which shift; either way the
    // answer is about this person, who is rostered to nothing here.
    if (body.shift) expect(body.shift.status).toBe("off");
  });
});

describe("past seats", () => {
  test("the caller's own, newest first, and nobody else's", async () => {
    const res = await get(SEATS, { cookie: mine });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { seats: unknown[] };
    expect(body.seats).toEqual([
      {
        date: "1998-04-02",
        shift: "night",
        unit: unitCode,
        area: "PIT 2",
        bus: null,
        fleet: null,
        source: "spare",
      },
      {
        date: "1998-04-01",
        shift: "day",
        unit: unitCode,
        area: "PIT 1",
        bus: "BUS 1",
        fleet: null,
        source: "plan",
      },
    ]);
  });

  test("a range backwards or longer than two months is refused", async () => {
    expect(
      (await get("/me/seats?from=1998-04-05&to=1998-04-01", { cookie: mine }))
        .status
    ).toBe(422);
    expect(
      (await get("/me/seats?from=1998-01-01&to=1998-04-01", { cookie: mine }))
        .status
    ).toBe(422);
  });
});

describe("my notifications", () => {
  const seen = new Date(Date.now() - 60_000);
  const notYet = new Date(Date.now() + 60 * 60_000);
  let mineId = "";
  let othersId = "";

  beforeAll(async () => {
    const [me] = await db
      .select({ id: schema.employees.id })
      .from(schema.employees)
      .where(eq(schema.employees.nik, ME));
    const [other] = await db
      .select({ id: schema.employees.id })
      .from(schema.employees)
      .where(eq(schema.employees.nik, OTHER));
    const rows = await db
      .insert(schema.personNotifications)
      .values([
        {
          employeeId: me!.id,
          kind: "seat-assigned",
          date: "1998-04-02",
          shift: "night",
          params: { unit: unitCode, area: "PIT 2", bus: null, fleet: null },
          dedupeKey: `zz-me|${uid()}`,
          availableAt: seen,
        },
        {
          // A spare's seat, waiting for the second finger.
          employeeId: me!.id,
          kind: "seat-assigned",
          date: "1998-04-03",
          shift: "day",
          params: { unit: unitCode },
          dedupeKey: `zz-me|${uid()}`,
          availableAt: notYet,
        },
        {
          employeeId: other!.id,
          kind: "seat-assigned",
          date: "1998-04-03",
          shift: "day",
          params: { unit: unitCode },
          dedupeKey: `zz-me|${uid()}`,
          availableAt: seen,
        },
      ])
      .returning({ id: schema.personNotifications.id });
    mineId = rows[0]!.id;
    othersId = rows[2]!.id;
  });

  test("lists my own, only what has come due", async () => {
    const res = await get("/me/notifications", { cookie: mine });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { id: string; kind: string; params: { unit: string } }[];
      unread: number;
    };
    expect(body.items.map((i) => i.id)).toEqual([mineId]);
    expect(body.items[0]).toMatchObject({
      kind: "seat-assigned",
      params: { unit: unitCode },
    });
    expect(body.unread).toBe(1);
  });

  test("marks my own read, and not somebody else's", async () => {
    expect(
      (await send("POST", `/me/notifications/${othersId}/read`, mine)).status
    ).toBe(404);
    expect(
      (await send("POST", `/me/notifications/${mineId}/read`, mine)).status
    ).toBe(200);
    const body = (await (
      await get("/me/notifications", { cookie: mine })
    ).json()) as { unread: number; items: { readAt: string | null }[] };
    expect(body.unread).toBe(0);
    expect(body.items[0]!.readAt).not.toBeNull();
  });

  test("read-all leaves a row that has not come due unread", async () => {
    expect(
      (await send("POST", "/me/notifications/read-all", mine)).status
    ).toBe(200);
    const waiting = await db
      .select({ readAt: schema.personNotifications.readAt })
      .from(schema.personNotifications)
      .where(eq(schema.personNotifications.availableAt, notYet));
    expect(waiting.every((r) => r.readAt === null)).toBe(true);
  });
});

describe("my phone", () => {
  const token = () => `fcm-${uid()}-${uid()}`;
  const devicesWith = (t: string) =>
    db
      .select({
        userId: schema.pushDevices.userId,
        platform: schema.pushDevices.platform,
      })
      .from(schema.pushDevices)
      .where(eq(schema.pushDevices.token, t));

  test("registers for pushes, and the same token twice is one phone", async () => {
    const t = token();
    for (let i = 0; i < 2; i++)
      expect(
        (
          await send("POST", "/me/push-devices", mine, {
            token: t,
            platform: "android",
          })
        ).status
      ).toBe(200);
    expect(await devicesWith(t)).toEqual([
      { userId: myAccount, platform: "android" },
    ]);
  });

  test("a phone signed in as somebody else moves to them", async () => {
    const t = token();
    await send("POST", "/me/push-devices", mine, {
      token: t,
      platform: "android",
    });
    const otherAccount = await account({ nik: OTHER });
    await send("POST", "/me/push-devices", await cookieFor(otherAccount), {
      token: t,
      platform: "android",
    });
    expect(await devicesWith(t)).toEqual([
      { userId: otherAccount, platform: "android" },
    ]);
  });

  test("unregisters my own phone, and cannot reach somebody else's", async () => {
    const t = token();
    const otherAccount = made.users.at(-1)!;
    await send("POST", "/me/push-devices", await cookieFor(otherAccount), {
      token: t,
      platform: "android",
    });
    await send("DELETE", "/me/push-devices", mine, { token: t });
    expect(await devicesWith(t)).toHaveLength(1);
    await send("DELETE", "/me/push-devices", await cookieFor(otherAccount), {
      token: t,
    });
    expect(await devicesWith(t)).toHaveLength(0);
  });

  test("logging out takes the phone off the list", async () => {
    const t = token();
    const session = await cookieFor(myAccount);
    await send("POST", "/me/push-devices", session, {
      token: t,
      platform: "android",
    });
    expect(await devicesWith(t)).toHaveLength(1);
    expect((await send("POST", "/auth/logout", session)).status).toBe(200);
    expect(await devicesWith(t)).toHaveLength(0);
  });

  test("a platform that is not one is refused", async () => {
    expect(
      (
        await send("POST", "/me/push-devices", mine, {
          token: token(),
          platform: "windows",
        })
      ).status
    ).toBe(422);
  });
});

test("a board at or after the running shift never shows in past seats", async () => {
  // A spare would otherwise read their coming unit here before the slip.
  const res = await get("/me/seats?from=2998-12-01&to=2999-01-01", {
    cookie: mine,
  });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { seats: unknown[] }).seats).toEqual([]);
});

test("an account keeps at most five phones, the newest", async () => {
  const tokens = Array.from({ length: 7 }, (_, i) => `cap-${i}-${uid()}`);
  for (const t of tokens)
    await send("POST", "/me/push-devices", mine, {
      token: t,
      platform: "android",
    });
  const kept = await db
    .select({ token: schema.pushDevices.token })
    .from(schema.pushDevices)
    .where(inArray(schema.pushDevices.token, tokens));
  expect(kept.map((k) => k.token).sort()).toEqual(tokens.slice(2).sort());
});
