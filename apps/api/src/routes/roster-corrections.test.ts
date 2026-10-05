/**
 * Koreksi Roster, end to end through the routes.
 *
 * The case under test is the owner's (2026-10-05): rostered N, called in for
 * the morning, corrected to D after the 03:00 pull. What must hold is that the
 * correction lands in the day the board reads — so the engine sees him with no
 * change of its own — and that it can be withdrawn, refused, and scoped.
 *
 * Dates are 1998 so no real roster can ever cover them.
 *
 * Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/routes/roster-corrections.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { and, eq, inArray } from "drizzle-orm";
import type {
  AccessMode,
  MenuSlug,
  RosterCode,
  Scope,
} from "@universe/contracts";

import { candidates } from "../allocation";
import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { rosterRoutes } from "./roster";
import { rosterCorrectionRoutes } from "./roster-corrections";

const app = new Elysia().use(rosterRoutes).use(rosterCorrectionRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Koreksi ${uid()}`;
const nikOf = () =>
  `98${Math.floor(Math.random() * 1e7)
    .toString()
    .padStart(7, "0")}`;

const MONTH = "1998-03-01";
const DAY = "1998-03-06";
/** A month with no roster document for anybody. */
const BARE_DAY = "1998-04-06";

const made = {
  users: [] as string[],
  roles: [] as string[],
  employees: [] as string[],
  docs: [] as string[],
  departments: [] as string[],
  positions: [] as string[],
  companies: [] as string[],
};

let deptA = "";
let deptB = "";
let docA = "";
let docB = "";
let position = "";
let companyId = "";

type Correction = {
  id: string;
  nik: string;
  date: string;
  fromCode: string | null;
  toCode: string;
  reason: string;
  createdByName: string;
  revokedAt: string | null;
  revokedByName: string | null;
};

async function addEmployee(departmentId: string) {
  const nik = nikOf();
  const [row] = await db
    .insert(schema.employees)
    .values({
      nik,
      name: `${tag} ${nik}`,
      companyId,
      departmentId,
      positionId: position,
      status: "aktif",
    })
    .returning({ id: schema.employees.id });
  made.employees.push(row!.id);
  return { id: row!.id, nik };
}

async function rosterDay(
  documentId: string,
  employeeId: string,
  date: string,
  code: RosterCode
) {
  await db
    .insert(schema.rosterDays)
    .values({ documentId, employeeId, date, code });
}

async function makeUser(
  grants: { menu: MenuSlug; mode: AccessMode }[],
  scope: Scope = "all",
  nik: string | null = null
) {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-koreksi-${uid()}`, name: tag, scope })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  if (grants.length)
    await db.insert(schema.rolePermissions).values(
      grants.map((g) => ({
        roleId: role!.id,
        menuSlug: g.menu,
        mode: g.mode,
      }))
    );
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-${uid()}@uji.local`,
      nik,
      name: `${tag} admin`,
      passwordHash: "x",
      roleId: role!.id,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(user!.id);
  const session = await createSession("user", user!.id, "cookie");
  return `${SESSION_COOKIE}=${session.id}`;
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

type Entry = { nik: string; code: string; reason?: string };
type Refused = {
  code: string;
  message: string;
  issues: { field: string; message: string }[];
};

/** One date, several people — the submission the form sends. */
const submit = (cookie: string, date: string, entries: Entry[]) =>
  send("POST", "/roster-corrections", cookie, {
    date,
    entries: entries.map((e) => ({ reason: "dipanggil masuk pagi", ...e })),
  });

/**
 * A submission of one, answered as that one row — most of these tests are
 * about a single person's day.
 */
async function correct(
  cookie: string,
  body: { nik: string; date: string; code: string; reason?: string }
) {
  const { date, ...entry } = body;
  const response = await submit(cookie, date, [entry]);
  const payload: unknown = await response.json();
  return {
    status: response.status,
    json: async () => (Array.isArray(payload) ? payload[0] : payload),
  };
}

async function codeOn(documentId: string, employeeId: string, date: string) {
  const [row] = await db
    .select({ code: schema.rosterDays.code })
    .from(schema.rosterDays)
    .where(
      and(
        eq(schema.rosterDays.documentId, documentId),
        eq(schema.rosterDays.employeeId, employeeId),
        eq(schema.rosterDays.date, date)
      )
    );
  return row?.code ?? null;
}

let manager = "";

beforeAll(async () => {
  // scheduler.test.ts disconnects the shared client in its teardown, and bun
  // runs every file in one process.
  if (redis.status === "end") await redis.connect();

  const [company] = await db
    .insert(schema.companies)
    .values({ name: `${tag} PT`, code: `ZK${uid()}` })
    .returning({ id: schema.companies.id });
  companyId = company!.id;
  made.companies.push(companyId);

  const depts = await db
    .insert(schema.departments)
    .values([
      { name: `${tag} Dept A`, companyId },
      { name: `${tag} Dept B`, companyId },
    ])
    .returning({ id: schema.departments.id });
  [deptA, deptB] = depts.map((d) => d.id) as [string, string];
  made.departments.push(deptA, deptB);

  const [pos] = await db
    .insert(schema.positions)
    .values({
      name: `${tag} Operator`,
      departmentId: deptA,
      fleetAllocation: true,
    })
    .returning({ id: schema.positions.id });
  position = pos!.id;
  made.positions.push(position);

  const docs = await db
    .insert(schema.rosterDocuments)
    .values([
      {
        departmentId: deptA,
        month: MONTH,
        fileName: `${tag}-a`,
        source: "unggul",
      },
      {
        departmentId: deptB,
        month: MONTH,
        fileName: `${tag}-b`,
        source: "unggul",
      },
    ])
    .returning({ id: schema.rosterDocuments.id });
  [docA, docB] = docs.map((d) => d.id) as [string, string];
  made.docs.push(docA, docB);

  manager = await makeUser([
    { menu: "roster-correction", mode: "manage" },
    { menu: "roster-data", mode: "view" },
  ]);
});

afterAll(async () => {
  if (made.employees.length) {
    await db
      .delete(schema.rosterCorrections)
      .where(inArray(schema.rosterCorrections.employeeId, made.employees));
    await db
      .delete(schema.inductionHolds)
      .where(inArray(schema.inductionHolds.employeeId, made.employees));
  }
  if (made.docs.length)
    await db
      .delete(schema.rosterDocuments)
      .where(inArray(schema.rosterDocuments.id, made.docs));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
  if (made.employees.length)
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, made.employees));
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
});

describe("correcting a day", () => {
  test("N corrected to D is in force at once, and the engine sees him", async () => {
    const person = await addEmployee(deptA);
    await rosterDay(docA, person.id, DAY, "N");

    const pool = () => candidates(DAY, "day", "05:25:00", "05:22:00");
    expect((await pool()).has(person.id)).toBe(false);

    const response = await correct(manager, {
      nik: person.nik,
      date: DAY,
      code: "D",
    });
    expect(response.status).toBe(200);
    const row = (await response.json()) as Correction;
    expect(row.fromCode).toBe("N");
    expect(row.toCode).toBe("D");
    expect(row.createdByName).toBe(`${tag} admin`);
    expect(row.revokedAt).toBeNull();

    expect(await codeOn(docA, person.id, DAY)).toBe("D");
    /* The engine is unchanged: it reads the day, and the day now says D. */
    expect((await pool()).has(person.id)).toBe(true);
    expect(
      (await candidates(DAY, "night", "17:25:00", "17:22:00")).has(person.id)
    ).toBe(false);
  });

  test("a day the source never carried can be corrected too", async () => {
    const person = await addEmployee(deptA);
    const response = await correct(manager, {
      nik: person.nik,
      date: DAY,
      code: "D",
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as Correction).fromCode).toBeNull();
    expect(await codeOn(docA, person.id, DAY)).toBe("D");
  });

  test("the same day cannot be corrected twice while the first stands", async () => {
    const person = await addEmployee(deptA);
    await rosterDay(docA, person.id, DAY, "N");
    expect(
      (await correct(manager, { nik: person.nik, date: DAY, code: "D" })).status
    ).toBe(200);

    const again = await correct(manager, {
      nik: person.nik,
      date: DAY,
      code: "OFF",
    });
    expect(again.status).toBe(422);
    expect(((await again.json()) as Refused).issues).toEqual([
      {
        field: "entries.0.nik",
        message: expect.stringContaining("sudah dikoreksi"),
      },
    ]);
    expect(await codeOn(docA, person.id, DAY)).toBe("D");
  });

  test("a correction to the code already in force is refused", async () => {
    const person = await addEmployee(deptA);
    await rosterDay(docA, person.id, DAY, "D");
    const response = await correct(manager, {
      nik: person.nik,
      date: DAY,
      code: "D",
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as Refused).issues).toEqual([
      { field: "entries.0.code", message: "Roster hari itu sudah D" },
    ]);
  });

  test("a month with no roster in force is refused, and nothing is written", async () => {
    const person = await addEmployee(deptA);
    const response = await correct(manager, {
      nik: person.nik,
      date: BARE_DAY,
      code: "D",
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as Refused).issues[0]?.message).toContain(
      "belum ada"
    );
    const rows = await db
      .select({ id: schema.rosterCorrections.id })
      .from(schema.rosterCorrections)
      .where(eq(schema.rosterCorrections.employeeId, person.id));
    expect(rows).toEqual([]);
  });

  test("an unknown NIK is refused on its entry", async () => {
    const response = await correct(manager, {
      nik: "98ZZ-tidak-ada",
      date: DAY,
      code: "D",
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as Refused).issues).toEqual([
      { field: "entries.0.nik", message: "Karyawan tidak ditemukan" },
    ]);
  });

  test("a reason is required", async () => {
    const person = await addEmployee(deptA);
    const response = await correct(manager, {
      nik: person.nik,
      date: DAY,
      code: "D",
      reason: "",
    });
    expect(response.status).toBe(422);
  });
});

describe("withdrawing a correction", () => {
  test("puts the day back to what it was, and keeps the record", async () => {
    const person = await addEmployee(deptA);
    await rosterDay(docA, person.id, DAY, "N");
    const created = (await (
      await correct(manager, { nik: person.nik, date: DAY, code: "D" })
    ).json()) as Correction;

    const response = await send(
      "POST",
      `/roster-corrections/${created.id}/revoke`,
      manager
    );
    expect(response.status).toBe(200);
    const row = (await response.json()) as Correction;
    expect(row.revokedAt).not.toBeNull();
    expect(row.revokedByName).toBe(`${tag} admin`);
    expect(await codeOn(docA, person.id, DAY)).toBe("N");

    const twice = await send(
      "POST",
      `/roster-corrections/${created.id}/revoke`,
      manager
    );
    expect(twice.status).toBe(409);

    /* Withdrawn, the day can be corrected afresh. */
    expect(
      (await correct(manager, { nik: person.nik, date: DAY, code: "D" })).status
    ).toBe(200);
  });

  test("a day the source never carried is removed again", async () => {
    const person = await addEmployee(deptA);
    const created = (await (
      await correct(manager, { nik: person.nik, date: DAY, code: "D" })
    ).json()) as Correction;
    await send("POST", `/roster-corrections/${created.id}/revoke`, manager);
    expect(await codeOn(docA, person.id, DAY)).toBeNull();
  });
});

describe("who may correct whom", () => {
  test("a dept-scoped admin corrects his own department and not another", async () => {
    const self = await addEmployee(deptA);
    const own = await addEmployee(deptA);
    const other = await addEmployee(deptB);
    await rosterDay(docA, own.id, DAY, "N");
    await rosterDay(docB, other.id, DAY, "N");
    const admin = await makeUser(
      [{ menu: "roster-correction", mode: "manage" }],
      "dept",
      self.nik
    );

    expect(
      (await correct(admin, { nik: own.nik, date: DAY, code: "D" })).status
    ).toBe(200);
    /* Out of scope reads as not found, as on the register. */
    expect(
      (await correct(admin, { nik: other.nik, date: DAY, code: "D" })).status
    ).toBe(422);
    expect(await codeOn(docB, other.id, DAY)).toBe("N");

    /* Nor withdraw one made in another department. */
    const elsewhere = (await (
      await correct(manager, { nik: other.nik, date: DAY, code: "D" })
    ).json()) as Correction;
    expect(
      (await send("POST", `/roster-corrections/${elsewhere.id}/revoke`, admin))
        .status
    ).toBe(404);

    const listed = (await (
      await send(
        "GET",
        "/roster-corrections?from=1998-03-01&to=1998-03-31",
        admin
      )
    ).json()) as Correction[];
    expect(listed.some((c) => c.nik === own.nik)).toBe(true);
    expect(listed.some((c) => c.nik === other.nik)).toBe(false);
  });

  test("view may list but not correct; no grant may do neither", async () => {
    const person = await addEmployee(deptA);
    const viewer = await makeUser([
      { menu: "roster-correction", mode: "view" },
    ]);
    const stranger = await makeUser([{ menu: "roster-data", mode: "manage" }]);

    expect((await send("GET", "/roster-corrections", viewer)).status).toBe(200);
    expect(
      (await correct(viewer, { nik: person.nik, date: DAY, code: "D" })).status
    ).toBe(403);
    expect((await send("GET", "/roster-corrections", stranger)).status).toBe(
      403
    );
    expect(
      (await correct(stranger, { nik: person.nik, date: DAY, code: "D" }))
        .status
    ).toBe(403);
    expect((await send("GET", "/roster-corrections")).status).toBe(401);
  });
});

describe("the roster grid", () => {
  test("marks a corrected day on the document in force", async () => {
    const person = await addEmployee(deptA);
    await rosterDay(docA, person.id, DAY, "N");
    await correct(manager, {
      nik: person.nik,
      date: DAY,
      code: "D",
      reason: "tukar shift darurat",
    });

    const response = await send(
      "GET",
      `/roster/${docA}/days?q=${person.nik}`,
      manager
    );
    expect(response.status).toBe(200);
    const grid = (await response.json()) as {
      days: string[];
      rows: {
        nik: string;
        codes: (string | null)[];
        corrections: {
          date: string;
          fromCode: string;
          toCode: string;
          reason: string;
        }[];
      }[];
    };
    const row = grid.rows.find((r) => r.nik === person.nik)!;
    expect(row.codes[grid.days.indexOf(DAY)]).toBe("D");
    expect(row.corrections).toEqual([
      expect.objectContaining({
        date: DAY,
        fromCode: "N",
        toCode: "D",
        reason: "tukar shift darurat",
      }),
    ]);
  });
});

describe("finding the person to correct", () => {
  test("names the code in force on the date, within the caller's scope", async () => {
    const self = await addEmployee(deptA);
    const own = await addEmployee(deptA);
    const other = await addEmployee(deptB);
    await rosterDay(docA, own.id, DAY, "N");
    await rosterDay(docB, other.id, DAY, "N");

    type Person = { nik: string; code: string | null };
    const find = async (cookie: string, nik: string, date = DAY) =>
      (await (
        await send(
          "GET",
          `/roster-corrections/people?q=${nik}&date=${date}`,
          cookie
        )
      ).json()) as Person[];

    expect(await find(manager, own.nik)).toEqual([
      expect.objectContaining({ nik: own.nik, code: "N" }),
    ]);
    /* A day with nothing rostered reads as no code, not as a missing person. */
    expect(await find(manager, own.nik, "1998-03-20")).toEqual([
      expect.objectContaining({ nik: own.nik, code: null }),
    ]);

    const admin = await makeUser(
      [{ menu: "roster-correction", mode: "view" }],
      "dept",
      self.nik
    );
    expect(await find(admin, own.nik)).toHaveLength(1);
    expect(await find(admin, other.nik)).toEqual([]);
  });
});

describe("several people on one date", () => {
  test("every entry is written, in the order given", async () => {
    const a = await addEmployee(deptA);
    const b = await addEmployee(deptA);
    const c = await addEmployee(deptB);
    await rosterDay(docA, a.id, DAY, "N");
    await rosterDay(docA, b.id, DAY, "OFF");
    await rosterDay(docB, c.id, DAY, "D");

    const response = await submit(manager, DAY, [
      { nik: a.nik, code: "D" },
      { nik: b.nik, code: "D", reason: "tukar dengan rekan" },
      { nik: c.nik, code: "N" },
    ]);
    expect(response.status).toBe(200);
    const rows = (await response.json()) as Correction[];
    expect(rows.map((r) => [r.nik, r.fromCode, r.toCode, r.reason])).toEqual([
      [a.nik, "N", "D", "dipanggil masuk pagi"],
      [b.nik, "OFF", "D", "tukar dengan rekan"],
      [c.nik, "D", "N", "dipanggil masuk pagi"],
    ]);
    expect(await codeOn(docA, a.id, DAY)).toBe("D");
    expect(await codeOn(docA, b.id, DAY)).toBe("D");
    expect(await codeOn(docB, c.id, DAY)).toBe("N");
  });

  test("one refused entry writes none of them, and names itself", async () => {
    const good = await addEmployee(deptA);
    const same = await addEmployee(deptA);
    await rosterDay(docA, good.id, DAY, "N");
    await rosterDay(docA, same.id, DAY, "D");

    const response = await submit(manager, DAY, [
      { nik: good.nik, code: "D" },
      { nik: same.nik, code: "D" },
    ]);
    expect(response.status).toBe(422);
    const body = (await response.json()) as Refused;
    expect(body.code).toBe("invalid_entries");
    expect(body.issues).toEqual([
      { field: "entries.1.code", message: "Roster hari itu sudah D" },
    ]);
    /* The good entry rolled back with it. */
    expect(await codeOn(docA, good.id, DAY)).toBe("N");
    const written = await db
      .select({ id: schema.rosterCorrections.id })
      .from(schema.rosterCorrections)
      .where(eq(schema.rosterCorrections.employeeId, good.id));
    expect(written).toEqual([]);
  });

  test("the same person twice in one submission is refused", async () => {
    const person = await addEmployee(deptA);
    await rosterDay(docA, person.id, DAY, "N");
    const response = await submit(manager, DAY, [
      { nik: person.nik, code: "D" },
      { nik: person.nik, code: "OFF" },
    ]);
    expect(response.status).toBe(422);
    expect(((await response.json()) as Refused).issues).toEqual([
      {
        field: "entries.1.nik",
        message: expect.stringContaining("entri ke-1"),
      },
    ]);
    expect(await codeOn(docA, person.id, DAY)).toBe("N");
  });

  test("an empty submission is refused", async () => {
    expect((await submit(manager, DAY, [])).status).toBe(422);
  });
});
