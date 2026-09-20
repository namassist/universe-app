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
import { eq, inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { attendanceSyncRoutes, fitToWorkSyncRoutes } from "./ingest-sync";

const app = new Elysia().use(fitToWorkSyncRoutes).use(attendanceSyncRoutes);

/** Snapshot fixtures live on dates no source will emit again. */
const D1 = "1998-01-01";
const D2 = "1998-01-02";

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
  return { id: user!.id, cookie: `${SESSION_COOKIE}=${session.id}` };
}

const send = (method: string, path: string, cookie?: string) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: cookie ? { cookie } : {},
    })
  );

afterAll(async () => {
  await db
    .delete(schema.ftwReadings)
    .where(inArray(schema.ftwReadings.date, [D1, D2]));
  await db
    .delete(schema.fingerReadings)
    .where(inArray(schema.fingerReadings.date, [D1, D2]));
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

describe("the FTW list", () => {
  test("returns the range's snapshots newest-first with the sync stamp", async () => {
    const viewer = await makeUser("fit-to-work", "view");
    await db.insert(schema.ftwReadings).values([
      {
        nik: "90000001",
        date: D1,
        name: "UJI SATU",
        company: "PT UJI",
        department: "MINING",
        position: "OPERATOR",
        mess: "MESS 1",
        shift: "Shift 1",
        sleepMinutes: 426,
        sleepCategory: "Dapat Bekerja",
        ftwDecision: "FTW aman",
        sentAt: `${D1} 04:12:00`,
      },
      {
        nik: "90000002",
        date: D2,
        name: "UJI DUA",
        sleepMinutes: 240,
        sleepCategory: "Tidak Boleh Bekerja",
        ftwDecision: "Belum mengisi FTW",
        sentAt: `${D2} 04:30:00`,
      },
    ]);

    const res = await send(
      "GET",
      `/fit-to-work/?from=${D1}&to=${D2}`,
      viewer.cookie
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{ nik: string; date: string; sleepCategory: string | null }>;
      lastSyncedAt: string | null;
    };
    const mine = body.rows.filter((r) => r.nik.startsWith("9000000"));
    expect(mine.map((r) => r.nik)).toEqual(["90000002", "90000001"]); // newest date first
    expect(mine[1]!.sleepCategory).toBe("Dapat Bekerja");
    expect(body.lastSyncedAt).not.toBeNull();
  });

  test("a backwards or oversized range is refused, not truncated", async () => {
    const viewer = await makeUser("fit-to-work", "view");
    expect(
      (await send("GET", `/fit-to-work/?from=${D2}&to=${D1}`, viewer.cookie))
        .status
    ).toBe(422);
    expect(
      (
        await send(
          "GET",
          `/fit-to-work/?from=1998-01-01&to=1998-06-01`,
          viewer.cookie
        )
      ).status
    ).toBe(422);
  });
});

/*
 * "Belum lapor" (owner, 2026-09-17): savera reports only what was sent, so the
 * list builds the unsent from the roster, with the fit-to-work wall's rules.
 */
describe("the FTW list names who owed an upload and sent none", () => {
  const D3 = "1998-03-02";
  const cleanup: (() => Promise<unknown>)[] = [];

  /* In the order registered: each step removes what the next one's rows
     still point at. */
  afterAll(async () => {
    for (const drop of cleanup) await drop();
  });

  test("rostered, obliged and unfiled — once per person per day", async () => {
    const viewer = await makeUser("fit-to-work", "view");

    const [company] = await db
      .insert(schema.companies)
      .values({ name: `${tag} FTW`, code: `ZZ${uid()}` })
      .returning({ id: schema.companies.id });
    const [dept] = await db
      .insert(schema.departments)
      .values({ name: `${tag} FTW`, companyId: company!.id })
      .returning({ id: schema.departments.id });
    const [operator] = await db
      .insert(schema.positions)
      .values({
        name: `${tag} OP`,
        departmentId: dept!.id,
        fleetAllocation: true,
      })
      .returning({ id: schema.positions.id });
    const [code] = await db
      .insert(schema.simperCodes)
      .values({ name: `${tag} FTWCODE` })
      .returning({ id: schema.simperCodes.id });
    const [cls] = await db
      .insert(schema.unitClasses)
      .values({ name: `${tag} C` })
      .returning({ id: schema.unitClasses.id });
    const [typ] = await db
      .insert(schema.unitTypes)
      .values({ name: `${tag} T` })
      .returning({ id: schema.unitTypes.id });
    const [mdl] = await db
      .insert(schema.unitModels)
      .values({ name: `${tag} M` })
      .returning({ id: schema.unitModels.id });
    const [brd] = await db
      .insert(schema.unitBrands)
      .values({ name: `${tag} B` })
      .returning({ id: schema.unitBrands.id });
    /* The machine that makes the licence an obligation. */
    const [unit] = await db
      .insert(schema.units)
      .values({
        code: `ZZFTW${uid()}`,
        classId: cls!.id,
        typeId: typ!.id,
        modelId: mdl!.id,
        brandId: brd!.id,
        simperCodeId: code!.id,
        ftw: true,
      })
      .returning({ id: schema.units.id });

    const people: string[] = [];
    const person = async (
      nik: string,
      opts: { skilled?: boolean; status?: "aktif" | "standby" } = {}
    ) => {
      const [row] = await db
        .insert(schema.employees)
        .values({
          nik,
          name: `${tag} ${nik}`,
          companyId: company!.id,
          departmentId: dept!.id,
          positionId: operator!.id,
          status: opts.status ?? "aktif",
        })
        .returning({ id: schema.employees.id });
      people.push(row!.id);
      if (opts.skilled !== false)
        await db
          .insert(schema.employeeSkills)
          .values({ employeeId: row!.id, simperCodeId: code!.id });
      return row!.id;
    };
    const owesDay = await person("90000031");
    const owesNight = await person("90000032");
    const filed = await person("90000033");
    const unlicensed = await person("90000034", { skilled: false });
    const offDuty = await person("90000035");
    const standby = await person("90000036", { status: "standby" });

    const [doc] = await db
      .insert(schema.rosterDocuments)
      .values({
        departmentId: dept!.id,
        month: "1998-03-01",
        fileName: `${tag}.xlsx`,
        uploadedBy: viewer.id,
      })
      .returning({ id: schema.rosterDocuments.id });
    await db.insert(schema.rosterDays).values([
      { documentId: doc!.id, employeeId: owesDay, date: D3, code: "D" },
      { documentId: doc!.id, employeeId: owesNight, date: D3, code: "N" },
      { documentId: doc!.id, employeeId: filed, date: D3, code: "D" },
      { documentId: doc!.id, employeeId: unlicensed, date: D3, code: "D" },
      { documentId: doc!.id, employeeId: offDuty, date: D3, code: "OFF" },
      { documentId: doc!.id, employeeId: standby, date: D3, code: "D" },
    ]);
    /* Sent late, and still an upload: lateness is not "belum lapor". */
    await db.insert(schema.ftwReadings).values({
      nik: "90000033",
      date: D3,
      name: `${tag} 90000033`,
      sleepMinutes: 400,
      sleepCategory: "Dapat Bekerja",
      ftwDecision: "FTW aman",
      sentAt: `${D3} 07:40:00`,
    });

    cleanup.push(
      () =>
        db.delete(schema.ftwReadings).where(eq(schema.ftwReadings.date, D3)),
      () =>
        db
          .delete(schema.rosterDocuments)
          .where(eq(schema.rosterDocuments.id, doc!.id)),
      () =>
        db
          .delete(schema.employeeSkills)
          .where(inArray(schema.employeeSkills.employeeId, people)),
      () =>
        db.delete(schema.employees).where(inArray(schema.employees.id, people)),
      () => db.delete(schema.units).where(eq(schema.units.id, unit!.id)),
      () =>
        db.delete(schema.unitClasses).where(eq(schema.unitClasses.id, cls!.id)),
      () => db.delete(schema.unitTypes).where(eq(schema.unitTypes.id, typ!.id)),
      () =>
        db.delete(schema.unitModels).where(eq(schema.unitModels.id, mdl!.id)),
      () =>
        db.delete(schema.unitBrands).where(eq(schema.unitBrands.id, brd!.id)),
      () =>
        db
          .delete(schema.simperCodes)
          .where(eq(schema.simperCodes.id, code!.id)),
      () =>
        db
          .delete(schema.positions)
          .where(eq(schema.positions.id, operator!.id)),
      () =>
        db
          .delete(schema.departments)
          .where(eq(schema.departments.id, dept!.id)),
      () =>
        db.delete(schema.companies).where(eq(schema.companies.id, company!.id))
    );

    const res = await send(
      "GET",
      `/fit-to-work/?from=${D3}&to=${D3}`,
      viewer.cookie
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: {
        nik: string;
        sleepCategory: string | null;
        sentAt: string | null;
        late: boolean;
        rosterShift: "day" | "night" | null;
        rosterCode: string | null;
        department: string | null;
      }[];
    };
    const mine = body.rows.filter((r) => r.nik.startsWith("900000"));

    const unfiled = mine.filter((r) => !r.sentAt);
    expect(unfiled.map((r) => [r.nik, r.rosterShift]).sort()).toEqual([
      ["90000031", "day"],
      ["90000032", "night"],
    ]);
    expect(unfiled.every((r) => r.sleepCategory === null)).toBe(true);
    expect(unfiled[0]!.department).toBe(`${tag} FTW`);

    // The late upload is itself, once, and flagged — not a second, unfiled row.
    const sent = mine.filter((r) => r.nik === "90000033");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.rosterShift).toBeNull();
    expect(sent[0]!.late).toBe(true);

    /* An upload carries the roster's own code for its day (owner,
       2026-09-20). Without it the screen cannot tell a day operator's 04:26
       filing from a night operator filing early for tonight, which is what
       put two rows in its top nine that the dashboard did not count. The
       unfiled rows carry theirs too, and it agrees with their shift. */
    expect(sent[0]!.rosterCode).toBe("D");
    expect(unfiled.map((r) => [r.nik, r.rosterCode]).sort()).toEqual([
      ["90000031", "D"],
      ["90000032", "N"],
    ]);
  });
});

describe("the attendance list", () => {
  test("has a row per shift: taps enriched, absentees present, mismatches marked", async () => {
    const viewer = await makeUser("attendance", "view");

    // A minimal local chain for the known person.
    const [company] = await db
      .insert(schema.companies)
      .values({ name: tag, code: `ZZ${uid()}` })
      .returning({ id: schema.companies.id });
    const [dept] = await db
      .insert(schema.departments)
      .values({ name: tag, companyId: company!.id })
      .returning({ id: schema.departments.id });
    const [position] = await db
      .insert(schema.positions)
      .values({ name: tag, departmentId: dept!.id })
      .returning({ id: schema.positions.id });
    const person = async (nik: string, name: string) =>
      (
        await db
          .insert(schema.employees)
          .values({
            nik,
            name,
            companyId: company!.id,
            departmentId: dept!.id,
            positionId: position!.id,
          })
          .returning({ id: schema.employees.id })
      )[0]!;
    const employee = await person("90000011", "UJI DIKENAL");
    /* Rostered for a shift and never seen: the row the tap-driven list could
       not produce at all. */
    const absentee = await person("90000012", "UJI TIDAK TAP");
    /* Tapped on a day the roster says OFF — the highlighted contradiction. */
    const offDuty = await person("90000013", "UJI BEDA ROSTER");
    /* Night shift: the screen must show their evening tap, not the morning
       wrong-button one that sits on the same row. */
    const nightCrew = await person("90000014", "UJI SHIFT MALAM");
    const [uploader] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .limit(1);
    const [doc] = await db
      .insert(schema.rosterDocuments)
      .values({
        departmentId: dept!.id,
        month: "1998-01-01",
        fileName: "uji.xlsx",
        uploadedBy: uploader!.id,
      })
      .returning({ id: schema.rosterDocuments.id });
    await db.insert(schema.rosterDays).values([
      { documentId: doc!.id, employeeId: employee!.id, date: D1, code: "D" },
      { documentId: doc!.id, employeeId: absentee.id, date: D1, code: "D" },
      { documentId: doc!.id, employeeId: offDuty.id, date: D1, code: "OFF" },
      { documentId: doc!.id, employeeId: nightCrew.id, date: D1, code: "N" },
    ]);

    await db.insert(schema.fingerReadings).values([
      {
        nik: "90000011",
        date: D1,
        firstInAt: `${D1} 05:15:51`,
        firstInIp: "10.0.0.1",
      },
      {
        nik: "90000013",
        date: D1,
        firstInAt: `${D1} 05:20:00`,
        firstInIp: "10.0.0.3",
      },
      {
        // Rostered N, and double-tapped on the way home that morning: the
        // afternoon tap is the arrival, the 06:20 one is not.
        nik: "90000014",
        date: D1,
        firstInAt: `${D1} 06:20:29`,
        firstInIp: "10.0.0.4",
        firstInPmAt: `${D1} 17:08:09`,
        firstInPmIp: "10.0.0.5",
      },
      {
        nik: "90000099", // no local record on purpose
        date: D1,
        firstInAt: `${D1} 05:30:00`,
        firstInIp: "10.0.0.2",
      },
      {
        // An OUT with no IN: the tail of a shift whose own row is elsewhere.
        nik: "90000098",
        date: D1,
        firstOutAt: `${D1} 06:26:57`,
        firstOutIp: "10.0.0.2",
      },
    ]);

    try {
      const res = await send(
        "GET",
        `/attendance/?from=${D1}&to=${D1}`,
        viewer.cookie
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        rows: Array<{
          nik: string;
          name: string | null;
          department: string | null;
          rosterCode: string | null;
          firstInAt: string | null;
        }>;
      };
      const row = (nik: string) => body.rows.find((r) => r.nik === nik);

      expect(row("90000011")).toMatchObject({
        name: "UJI DIKENAL",
        department: tag,
        rosterCode: "D",
        firstInAt: `${D1} 05:15:51`,
      });

      // Scheduled and never seen: a row, with the roster's word and no tap.
      expect(row("90000012")).toMatchObject({
        name: "UJI TIDAK TAP",
        rosterCode: "D",
        firstInAt: null,
      });

      // Present but not scheduled — both halves of the contradiction on one row.
      expect(row("90000013")).toMatchObject({
        rosterCode: "OFF",
        firstInAt: `${D1} 05:20:00`,
      });

      // The unknown tap is a fact about the morning, shown bare — not hidden.
      // A null roster is our gap, and must not read as a contradiction.
      expect(row("90000099")).toMatchObject({
        name: null,
        department: null,
        rosterCode: null,
        firstInAt: `${D1} 05:30:00`,
      });

      // The night shift's arrival is the afternoon tap. Showing 06:20 would
      // repeat the bug the noon split closed, one layer up.
      expect(row("90000014")).toMatchObject({
        rosterCode: "N",
        firstInAt: `${D1} 17:08:09`,
      });

      // An OUT with no IN is no longer a row of its own.
      expect(row("90000098")).toBeUndefined();
    } finally {
      await db
        .delete(schema.rosterDocuments)
        .where(eq(schema.rosterDocuments.id, doc!.id));
      await db
        .delete(schema.employees)
        .where(
          inArray(schema.employees.id, [
            employee!.id,
            absentee.id,
            offDuty.id,
            nightCrew.id,
          ])
        );
      await db
        .delete(schema.positions)
        .where(eq(schema.positions.id, position!.id));
      await db
        .delete(schema.departments)
        .where(eq(schema.departments.id, dept!.id));
      await db
        .delete(schema.companies)
        .where(eq(schema.companies.id, company!.id));
    }
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
