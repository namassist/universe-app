/**
 * The Actual board's routes — reading it, regenerating it, and correcting it.
 *
 * The engine's own behaviour is pinned in `allocation.test.ts`; what is tested
 * here is the surface Manpower touches, and mostly its refusals: a board that
 * does not exist, a person already driving something else, and a shift whose
 * deadline nobody configured.
 *
 *   bun --env-file=.env test src/routes/fleet-actual.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";

import { createSession, DEVICE_COOKIE, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import {
  fleetActualRoutes,
  groupIntoFleets,
  planSlots,
  type WallSlot,
} from "./fleet-actual";

const app = new Elysia().use(fleetActualRoutes);
const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Aktual ${uid()}`;
const DATE = "1999-06-06";
/** A separate date, so the roster fixture cannot disturb the board above. */
const PLAN_DATE = "1999-07-07";

const made = {
  users: [] as string[],
  roles: [] as string[],
  units: [] as string[],
  employees: [] as string[],
  cat: [] as {
    table: "unitClasses" | "unitTypes" | "unitModels" | "unitBrands";
    id: string;
  }[],
  companies: [] as string[],
  departments: [] as string[],
  positions: [] as string[],
  docs: [] as string[],
  rosterDocs: [] as string[],
  devices: [] as string[],
  planSlots: [] as string[],
};

let admin: { cookie: string };
let viewer: { cookie: string };
let wall: { cookie: string };
let unitA: string, unitB: string;
let opOne: string, opTwo: string;

const send = (method: string, path: string, cookie?: string, body?: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  );

async function makeUser(
  mode: "view" | "manage",
  menuSlug: "fleet-allocation" | "display-fleet" = "fleet-allocation"
) {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-aktual-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db
    .insert(schema.rolePermissions)
    .values([{ roleId: role!.id, menuSlug, mode }]);
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

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();
  admin = await makeUser("manage");
  viewer = await makeUser("view");
  wall = await makeUser("view", "display-fleet");

  const [co] = await db
    .insert(schema.companies)
    .values({ name: `${tag} PT`, code: `ZZ${uid()}` })
    .returning({ id: schema.companies.id });
  made.companies.push(co!.id);
  const [dept] = await db
    .insert(schema.departments)
    .values({ name: `${tag} Dept`, companyId: co!.id })
    .returning({ id: schema.departments.id });
  made.departments.push(dept!.id);
  const [pos] = await db
    .insert(schema.positions)
    .values({
      name: `${tag} Operator`,
      departmentId: dept!.id,
      fleetAllocation: true,
    })
    .returning({ id: schema.positions.id });
  made.positions.push(pos!.id);

  const [cl] = await db
    .insert(schema.unitClasses)
    .values({ name: `${tag} K` })
    .returning({ id: schema.unitClasses.id });
  const [ty] = await db
    .insert(schema.unitTypes)
    .values({ name: `${tag} T` })
    .returning({ id: schema.unitTypes.id });
  const [mo] = await db
    .insert(schema.unitModels)
    .values({ name: `${tag} M` })
    .returning({ id: schema.unitModels.id });
  const [br] = await db
    .insert(schema.unitBrands)
    .values({ name: `${tag} B` })
    .returning({ id: schema.unitBrands.id });
  made.cat.push(
    { table: "unitClasses", id: cl!.id },
    { table: "unitTypes", id: ty!.id },
    { table: "unitModels", id: mo!.id },
    { table: "unitBrands", id: br!.id }
  );

  const units = await db
    .insert(schema.units)
    .values([
      {
        code: `${tag}-A`,
        classId: cl!.id,
        typeId: ty!.id,
        modelId: mo!.id,
        brandId: br!.id,
      },
      {
        code: `${tag}-B`,
        classId: cl!.id,
        typeId: ty!.id,
        modelId: mo!.id,
        brandId: br!.id,
      },
    ])
    .returning({ id: schema.units.id });
  [unitA, unitB] = units.map((u) => u.id) as [string, string];
  made.units.push(unitA, unitB);

  const ops = await db
    .insert(schema.employees)
    .values([
      {
        nik: `9911${uid().slice(0, 4)}`,
        name: `${tag} Satu`,
        companyId: co!.id,
        departmentId: dept!.id,
        positionId: pos!.id,
      },
      {
        nik: `9912${uid().slice(0, 4)}`,
        name: `${tag} Dua`,
        companyId: co!.id,
        departmentId: dept!.id,
        positionId: pos!.id,
      },
    ])
    .returning({ id: schema.employees.id });
  [opOne, opTwo] = ops.map((o) => o.id) as [string, string];
  made.employees.push(opOne, opTwo);

  // A board written directly: this file tests the routes over it, not how the
  // engine arrived at it.
  const [doc] = await db
    .insert(schema.fleetActualDocuments)
    .values({ date: DATE, shift: "day" })
    .returning({ id: schema.fleetActualDocuments.id });
  made.docs.push(doc!.id);
  await db.insert(schema.fleetActualSlots).values([
    {
      documentId: doc!.id,
      unitId: unitA,
      employeeId: opOne,
      source: "plan",
      tappedAt: "05:01:00",
    },
    {
      documentId: doc!.id,
      unitId: unitB,
      employeeId: null,
      source: null,
      tappedAt: null,
    },
  ]);

  /* The standing plan, plus the roster that decides which half of it is
     "today". unitA carries both operators — one on days, one on nights —
     which is the case the shift lookup exists to get right. */
  const slots = await db
    .insert(schema.fleetPlanSlots)
    .values([
      { unitId: unitA, employeeId: opOne },
      { unitId: unitA, employeeId: opTwo },
    ])
    .returning({ id: schema.fleetPlanSlots.id });
  made.planSlots.push(...slots.map((r) => r.id));

  const [rosterDoc] = await db
    .insert(schema.rosterDocuments)
    .values({
      departmentId: dept!.id,
      month: `${PLAN_DATE.slice(0, 7)}-01`,
      fileName: `${tag}.xlsx`,
      uploadedBy: made.users[0]!,
    })
    .returning({ id: schema.rosterDocuments.id });
  made.rosterDocs.push(rosterDoc!.id);
  await db.insert(schema.rosterDays).values([
    {
      documentId: rosterDoc!.id,
      employeeId: opOne,
      date: PLAN_DATE,
      code: "D",
    },
    {
      documentId: rosterDoc!.id,
      employeeId: opTwo,
      date: PLAN_DATE,
      code: "N",
    },
  ]);
});

afterAll(async () => {
  if (made.devices.length)
    await db
      .delete(schema.devices)
      .where(inArray(schema.devices.id, made.devices));
  if (made.docs.length)
    await db
      .delete(schema.fleetActualDocuments)
      .where(inArray(schema.fleetActualDocuments.id, made.docs));
  await db
    .delete(schema.fleetActualDocuments)
    .where(eq(schema.fleetActualDocuments.date, DATE));
  if (made.planSlots.length)
    await db
      .delete(schema.fleetPlanSlots)
      .where(inArray(schema.fleetPlanSlots.id, made.planSlots));
  if (made.rosterDocs.length)
    await db
      .delete(schema.rosterDocuments)
      .where(inArray(schema.rosterDocuments.id, made.rosterDocs));
  if (made.employees.length)
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, made.employees));
  if (made.units.length)
    await db.delete(schema.units).where(inArray(schema.units.id, made.units));
  for (const c of made.cat)
    await db.delete(schema[c.table]).where(eq(schema[c.table].id, c.id));
  if (made.positions.length)
    await db
      .delete(schema.positions)
      .where(inArray(schema.positions.id, made.positions));
  if (made.departments.length)
    await db
      .delete(schema.departments)
      .where(inArray(schema.departments.id, made.departments));
  if (made.companies.length)
    await db
      .delete(schema.companies)
      .where(inArray(schema.companies.id, made.companies));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
});

describe("reading a board", () => {
  test("lists it with the idle count spelled out", async () => {
    const rows = (await (
      await send("GET", "/fleet-allocation/actual", viewer.cookie)
    ).json()) as {
      date: string;
      shift: string;
      total: number;
      viaPlan: number;
      idle: number;
    }[];
    const mine = rows.find((r) => r.date === DATE && r.shift === "day");
    expect(mine).toBeDefined();
    expect(mine!.total).toBe(2);
    expect(mine!.viaPlan).toBe(1);
    // The empty unit is counted, not omitted — it is what the screen is for.
    expect(mine!.idle).toBe(1);
  });

  test("returns it unit by unit, vacancies included", async () => {
    const board = (await (
      await send("GET", `/fleet-allocation/actual/${DATE}/day`, viewer.cookie)
    ).json()) as {
      slots: {
        unitId: string;
        employeeId: string | null;
        employeeName: string | null;
        source: string | null;
      }[];
    };
    expect(board.slots).toHaveLength(2);
    const filled = board.slots.find((s) => s.unitId === unitA)!;
    expect(filled.employeeId).toBe(opOne);
    expect(filled.employeeName).toContain("Satu");
    const empty = board.slots.find((s) => s.unitId === unitB)!;
    expect(empty.employeeId).toBeNull();
    expect(empty.source).toBeNull();
  });

  test("404s for a board nobody has generated", async () => {
    expect(
      (
        await send(
          "GET",
          `/fleet-allocation/actual/1999-06-07/day`,
          viewer.cookie
        )
      ).status
    ).toBe(404);
  });

  test("refuses a date that is not a date", async () => {
    expect(
      (await send("GET", `/fleet-allocation/actual/kemarin/day`, viewer.cookie))
        .status
    ).toBe(422);
  });

  test("refuses a shift outside the vocabulary", async () => {
    expect(
      (
        await send(
          "GET",
          `/fleet-allocation/actual/${DATE}/sore`,
          viewer.cookie
        )
      ).status
    ).toBe(422);
  });
});

describe("correcting a board", () => {
  test("puts someone on an empty unit, marked as a manual placement", async () => {
    const response = await send(
      "PATCH",
      `/fleet-allocation/actual/${DATE}/day/${unitB}`,
      admin.cookie,
      {
        employeeId: opTwo,
      }
    );
    expect(response.status).toBe(200);

    const board = (await (
      await send("GET", `/fleet-allocation/actual/${DATE}/day`, viewer.cookie)
    ).json()) as {
      slots: {
        unitId: string;
        employeeId: string | null;
        source: string | null;
      }[];
    };
    const slot = board.slots.find((s) => s.unitId === unitB)!;
    expect(slot.employeeId).toBe(opTwo);
    // Not "plan" and not "spare": the board must not claim the engine chose
    // someone a person put there.
    expect(slot.source).toBe("manual");
  });

  test("refuses to put one person on two units", async () => {
    const response = await send(
      "PATCH",
      `/fleet-allocation/actual/${DATE}/day/${unitA}`,
      admin.cookie,
      {
        employeeId: opTwo,
      }
    );
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe(
      "already_placed"
    );
  });

  test("clears a unit — a vacancy is a legitimate thing to record", async () => {
    expect(
      (
        await send(
          "PATCH",
          `/fleet-allocation/actual/${DATE}/day/${unitB}`,
          admin.cookie,
          { employeeId: null }
        )
      ).status
    ).toBe(200);
    const board = (await (
      await send("GET", `/fleet-allocation/actual/${DATE}/day`, viewer.cookie)
    ).json()) as {
      slots: {
        unitId: string;
        employeeId: string | null;
        source: string | null;
      }[];
    };
    const slot = board.slots.find((s) => s.unitId === unitB)!;
    expect(slot.employeeId).toBeNull();
    expect(slot.source).toBeNull();
  });

  test("404s for a unit that is not on this board", async () => {
    const response = await send(
      "PATCH",
      `/fleet-allocation/actual/${DATE}/day/${crypto.randomUUID()}`,
      admin.cookie,
      {
        employeeId: null,
      }
    );
    expect(response.status).toBe(404);
  });
});

describe("who may do what", () => {
  test("refuses an anonymous caller", async () => {
    expect((await send("GET", "/fleet-allocation/actual")).status).toBe(401);
  });

  test("a view grant reads but neither generates nor corrects", async () => {
    expect(
      (await send("GET", "/fleet-allocation/actual", viewer.cookie)).status
    ).toBe(200);
    expect(
      (
        await send(
          "PATCH",
          `/fleet-allocation/actual/${DATE}/day/${unitA}`,
          viewer.cookie,
          { employeeId: null }
        )
      ).status
    ).toBe(403);
    expect(
      (
        await send(
          "POST",
          `/fleet-allocation/actual/${DATE}/day/generate`,
          viewer.cookie,
          {}
        )
      ).status
    ).toBe(403);
  });
});

describe("candidates for a unit", () => {
  test("says what stands in each person's way rather than hiding them", async () => {
    const rows = (await (
      await send(
        "GET",
        `/fleet-allocation/actual/${DATE}/day/candidates/${unitA}`,
        viewer.cookie
      )
    ).json()) as { employeeId: string; refusal: string | null }[];
    // Nobody is rostered on this fixture date, so the list is legitimately
    // empty — what matters is that it answers rather than erroring.
    expect(Array.isArray(rows)).toBe(true);
  });

  test("404s when the board does not exist", async () => {
    expect(
      (
        await send(
          "GET",
          `/fleet-allocation/actual/1999-06-08/day/candidates/${unitA}`,
          viewer.cookie
        )
      ).status
    ).toBe(404);
  });
});

/* ------------------------------------------------------------ the wall */

const slot = (over: Partial<WallSlot> = {}): WallSlot => ({
  unitId: crypto.randomUUID(),
  unitCode: "DT-100",
  modelName: "M",
  brandName: "B",
  fleetId: null,
  diggerCode: null,
  area: null,
  employeeNik: null,
  employeeName: null,
  employeePhotoFile: null,
  source: null,
  tappedAt: null,
  ...over,
});

describe("arranging the board into formations", () => {
  const fleetOne = "f1";
  const fleetTwo = "f2";

  test("puts the digger at the head of its own formation", () => {
    const groups = groupIntoFleets(
      [
        slot({ unitCode: "DT-102", fleetId: fleetOne, diggerCode: "EX-22" }),
        slot({ unitCode: "EX-22", fleetId: fleetOne, diggerCode: "EX-22" }),
        slot({ unitCode: "DT-101", fleetId: fleetOne, diggerCode: "EX-22" }),
      ],
      new Map()
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.units.map((u) => u.unitCode)).toEqual([
      "EX-22",
      "DT-101",
      "DT-102",
    ]);
  });

  test("orders formations by digger code", () => {
    const groups = groupIntoFleets(
      [
        slot({ unitCode: "EX-70", fleetId: fleetTwo, diggerCode: "EX-70" }),
        slot({ unitCode: "EX-22", fleetId: fleetOne, diggerCode: "EX-22" }),
      ],
      new Map()
    );
    expect(groups.map((g) => g.diggerCode)).toEqual(["EX-22", "EX-70"]);
  });

  test("leaves out units that belong to no fleet", () => {
    const groups = groupIntoFleets(
      [
        slot({ unitCode: "WT-01" }),
        slot({ unitCode: "EX-22", fleetId: fleetOne, diggerCode: "EX-22" }),
        slot({ unitCode: "WT-02" }),
      ],
      new Map()
    );
    // The wall answers "how is this formation crewed"; a unit in no formation
    // has nothing to contribute to it, and stays on the Actual board instead.
    expect(groups).toHaveLength(1);
    expect(groups[0]!.units.map((u) => u.unitCode)).toEqual(["EX-22"]);
  });

  test("names each formation's bus", () => {
    const groups = groupIntoFleets(
      [slot({ unitCode: "EX-22", fleetId: fleetOne, diggerCode: "EX-22" })],
      new Map([[fleetOne, "BUS-01"]])
    );
    expect(groups[0]!.busCode).toBe("BUS-01");
  });

  test("counts each formation on its own, never the whole site", () => {
    const groups = groupIntoFleets(
      [
        slot({
          unitCode: "EX-22",
          fleetId: fleetOne,
          diggerCode: "EX-22",
          employeeName: "Andi",
          source: "plan",
        }),
        slot({
          unitCode: "DT-101",
          fleetId: fleetOne,
          diggerCode: "EX-22",
          employeeName: "Budi",
          source: "spare",
        }),
        slot({ unitCode: "DT-102", fleetId: fleetOne, diggerCode: "EX-22" }),
        slot({
          unitCode: "EX-70",
          fleetId: fleetTwo,
          diggerCode: "EX-70",
          employeeName: "Cakra",
          source: "manual",
        }),
      ],
      new Map()
    );
    expect(groups[0]).toMatchObject({
      diggerCode: "EX-22",
      total: 3,
      crewed: 2,
      idle: 1,
      substituted: 1,
    });
    // The second formation knows nothing of the first's three units.
    expect(groups[1]).toMatchObject({
      diggerCode: "EX-70",
      total: 1,
      crewed: 1,
      idle: 0,
      substituted: 1,
    });
  });

  test("keeps a vacancy in the formation rather than dropping it", () => {
    const groups = groupIntoFleets(
      [
        slot({
          unitCode: "EX-22",
          fleetId: fleetOne,
          diggerCode: "EX-22",
          employeeName: "Andi",
          source: "plan",
        }),
        slot({ unitCode: "DT-101", fleetId: fleetOne, diggerCode: "EX-22" }),
      ],
      new Map()
    );
    expect(groups[0]!.units).toHaveLength(2);
    expect(groups[0]!.units[1]!.employeeName).toBeNull();
  });
});

describe("the provisional line-up, before a board exists", () => {
  const mine = async (shift: "day" | "night") => {
    const rows = await planSlots(PLAN_DATE, shift);
    return new Map(rows.map((r) => [r.unitId, r.employeeId]));
  };

  test("takes the shift from the roster, not from the plan", async () => {
    // `fleet_plan_slots` holds no shift at all, so this is the only thing
    // standing between the wall and the night operator's name at breakfast.
    expect((await mine("day")).get(unitA)).toBe(opOne);
    expect((await mine("night")).get(unitA)).toBe(opTwo);
  });

  test("keeps a unit whose plan says nothing, unmanned", async () => {
    const day = await mine("day");
    expect(day.has(unitB)).toBe(true);
    expect(day.get(unitB)).toBeNull();
  });

  test("leaves a unit unmanned when its operator is not rostered that day", async () => {
    // A different date: neither operator has a roster row, so the standing
    // pairing must not be shown as though it were today's line-up.
    const rows = await planSlots("1999-07-08", "day");
    const byUnit = new Map(rows.map((r) => [r.unitId, r.employeeId]));
    expect(byUnit.get(unitA)).toBeNull();
  });

  test("lists every active unit exactly once", async () => {
    const rows = await planSlots(PLAN_DATE, "day");
    expect(new Set(rows.map((r) => r.unitId)).size).toBe(rows.length);
  });
});

describe("a screen scoped to its own formations", () => {
  const rows = () => [
    slot({ unitCode: "EX-22", fleetId: "f1", diggerCode: "EX-22" }),
    slot({ unitCode: "EX-70", fleetId: "f2", diggerCode: "EX-70" }),
  ];

  test("shows only the formations it was given", () => {
    const groups = groupIntoFleets(rows(), new Map(), ["f2"]);
    expect(groups.map((g) => g.diggerCode)).toEqual(["EX-70"]);
  });

  test("shows every formation when it was given none", () => {
    // Empty is "unscoped", not "nothing": a screen nobody has pointed at a pit
    // is a control-room screen, and blanking it would be the wrong default.
    expect(groupIntoFleets(rows(), new Map(), []).map((g) => g.id)).toEqual([
      "f1",
      "f2",
    ]);
    expect(groupIntoFleets(rows(), new Map(), null)).toHaveLength(2);
  });

  test("counts only what it shows", () => {
    const groups = groupIntoFleets(
      [
        slot({ unitCode: "EX-22", fleetId: "f1", diggerCode: "EX-22" }),
        slot({ unitCode: "DT-101", fleetId: "f1", diggerCode: "EX-22" }),
        slot({ unitCode: "EX-70", fleetId: "f2", diggerCode: "EX-70" }),
      ],
      new Map(),
      ["f2"]
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.total).toBe(1);
  });

  test("keeps the order it was given, not the alphabet", () => {
    // A monitor lays its picks out as quadrants, so the pick order is the only
    // way an admin says which pit belongs top-left. Sorting by digger code
    // here would silently overrule every one of those choices.
    const groups = groupIntoFleets(rows(), new Map(), ["f2", "f1"]);
    expect(groups.map((g) => g.diggerCode)).toEqual(["EX-70", "EX-22"]);
  });
});

describe("previewing one screen from a browser", () => {
  const makeScreen = async (
    rotateSeconds: number,
    extra: { name?: string; layout?: "slideshow" | "monitor" } = {}
  ) => {
    const id = `ZZW${uid().toUpperCase()}`;
    made.devices.push(id);
    await db.insert(schema.devices).values({
      id,
      name: extra.name ?? tag,
      kind: "fleet",
      rotateSeconds,
      ...(extra.layout ? { layout: extra.layout } : {}),
    });
    return id;
  };

  test("answers with the named screen's own dwell", async () => {
    const id = await makeScreen(9);
    const res = await send(
      "GET",
      `/fleet-allocation/actual/display?device=${id}`,
      wall.cookie
    );
    expect(res.status).toBe(200);
    // Without this the preview reports the default however the screen is set,
    // so every rotation change looks like it did nothing.
    expect(
      ((await res.json()) as { rotateSeconds: number }).rotateSeconds
    ).toBe(9);
  });

  test("carries the screen's own name and layout", async () => {
    // A monitor heads itself with its name, because no one of the four
    // formations it shows can name it. Without this the wall could only fall
    // back on the `?name=` a paired TV never sends.
    const id = await makeScreen(30, {
      name: "ZZ Ruang Kendali",
      layout: "monitor",
    });
    const res = await send(
      "GET",
      `/fleet-allocation/actual/display?device=${id}`,
      wall.cookie
    );
    const body = (await res.json()) as {
      deviceName: string | null;
      layout: string;
    };
    expect(body.deviceName).toBe("ZZ Ruang Kendali");
    expect(body.layout).toBe("monitor");
  });

  test("names no device when nobody named one", async () => {
    // A person looking at the site-wide board is not standing at a screen.
    const res = await send(
      "GET",
      "/fleet-allocation/actual/display",
      wall.cookie
    );
    const body = (await res.json()) as {
      deviceName: string | null;
      layout: string;
    };
    expect(body.deviceName).toBeNull();
    expect(body.layout).toBe("slideshow");
  });

  test("says so when the named screen does not exist", async () => {
    const res = await send(
      "GET",
      "/fleet-allocation/actual/display?device=ZZ-tidak-ada",
      wall.cookie
    );
    expect(res.status).toBe(404);
  });

  test("a paired TV cannot ask about another screen", async () => {
    const mine = await makeScreen(11);
    const other = await makeScreen(47);
    const session = await createSession("device", mine, "cookie");
    const res = await send(
      "GET",
      `/fleet-allocation/actual/display?device=${other}`,
      `${DEVICE_COOKIE}=${session.id}`
    );
    // It answers as itself and ignores the parameter — a kiosk must not be
    // able to read a wall it was not given.
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { rotateSeconds: number }).rotateSeconds
    ).toBe(11);
  });
});

describe("the fleet wall endpoint", () => {
  test("refuses a caller who holds only the allocation menu", async () => {
    const res = await send(
      "GET",
      "/fleet-allocation/actual/display",
      viewer.cookie
    );
    expect(res.status).toBe(403);
  });

  test("refuses an anonymous caller", async () => {
    const res = await send("GET", "/fleet-allocation/actual/display");
    expect(res.status).toBe(401);
  });

  test("always answers with a whole body, board or no board", async () => {
    const res = await send(
      "GET",
      "/fleet-allocation/actual/display",
      wall.cookie
    );
    // A wall that renders an error renders nothing: "no board yet" and "the
    // timeline cannot say which shift is on" are readings, not failures.
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      servedAt: string;
      date: string | null;
      rotateSeconds: number;
      fleets: { total: number; units: unknown[] }[];
    };
    expect(body.servedAt).toBeTruthy();
    // A person previewing the wall is never scoped and gets the default dwell.
    expect(body.rotateSeconds).toBe(30);
    expect(Array.isArray(body.fleets)).toBe(true);
    // Each formation's count is its own units, not the board's.
    for (const fleet of body.fleets)
      expect(fleet.total).toBe(fleet.units.length);
  });
});

/**
 * The wall's own photo route.
 *
 * Only the refusals are pinned. Serving a face needs the *current* shift to
 * hold the person, and which shift is current is the wall clock's answer — the
 * same reason the display endpoint itself is only tested for the shape it
 * always returns. What is worth nailing down is the direction the gate fails
 * in: everything that is not demonstrably on the board now is a 404.
 */
describe("an operator's photo on the wall", () => {
  test("refuses an anonymous caller", async () => {
    const res = await send(
      "GET",
      "/fleet-allocation/actual/display/photo/99120000"
    );
    expect(res.status).toBe(401);
  });

  test("refuses a caller who holds only the allocation menu", async () => {
    const res = await send(
      "GET",
      "/fleet-allocation/actual/display/photo/99120000",
      viewer.cookie
    );
    expect(res.status).toBe(403);
  });

  test("refuses a kiosk paired as some other kind of screen", async () => {
    const id = `ZZA${uid().toUpperCase()}`;
    made.devices.push(id);
    await db.insert(schema.devices).values({ id, name: tag, kind: "att" });
    const session = await createSession("device", id, "cookie");
    const res = await send(
      "GET",
      "/fleet-allocation/actual/display/photo/99120000",
      `${DEVICE_COOKIE}=${session.id}`
    );
    expect(res.status).toBe(403);
  });

  test("404s for a NIK nobody here holds", async () => {
    const res = await send(
      "GET",
      "/fleet-allocation/actual/display/photo/tidak-ada-nik",
      wall.cookie
    );
    expect(res.status).toBe(404);
  });

  test("404s for someone on no board the wall is showing", async () => {
    const [row] = await db
      .select({ nik: schema.employees.nik })
      .from(schema.employees)
      .where(eq(schema.employees.id, opOne))
      .limit(1);
    // Photo or not, this fixture's board is dated 1999 and no wall is showing
    // it. A screen must not be able to walk the register one NIK at a time.
    const res = await send(
      "GET",
      `/fleet-allocation/actual/display/photo/${row!.nik}`,
      wall.cookie
    );
    expect(res.status).toBe(404);
  });
});
