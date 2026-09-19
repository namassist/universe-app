/**
 * The two readiness walls: what they show, in what order, and who may read.
 *
 * The board builders are tested directly rather than through the route,
 * because what is worth being wrong about is the ordering, the cut and the
 * verdicts — none of which should need the clock to be at a particular hour or
 * the dev roster to hold a particular shift. The route tests cover the part
 * that only a request can answer: the session and the device kind.
 *
 * Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/routes/readiness-display.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { and, inArray, isNotNull, ne } from "drizzle-orm";

import { createSession, DEVICE_COOKIE, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { ftwObliged } from "../ftw-obliged";
import { localDate } from "../scheduler";
import { deletePhoto, writePhoto } from "../storage";
import {
  attendanceBoard,
  attendanceDisplayRoutes,
  fitWorkBoard,
  fitWorkDisplayRoutes,
} from "./readiness-display";
import { attendanceScanRoutes } from "./attendance-scans";

const app = new Elysia()
  .use(attendanceDisplayRoutes)
  .use(attendanceScanRoutes)
  .use(fitWorkDisplayRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji Wall ${uid()}`;
const made = {
  users: [] as string[],
  roles: [] as string[],
  devices: [] as string[],
};

/* Times either side of the gates the fixtures use. */
const GATE = "05:30:00";
const D = "1998-03-01";
const at = (time: string) => `${D} ${time}`;

const person = (nik: string, name: string) => ({
  nik,
  name,
  position: "OPERATOR",
  department: "MINING",
  company: "PT UNGGUL DINAMIKA UTAMA",
});

const tap = (nik: string, firstInAt: string | null) => ({
  nik,
  firstInAt,
  firstInPmAt: null,
});

const filing = (
  nik: string,
  decision: string,
  category: string,
  sent: string
) => ({
  nik,
  ftwDecision: decision,
  sleepCategory: category,
  sleepMinutes: 445,
  sentAt: at(sent),
});

/* ------------------------------------------------------------- attendance */

describe("the attendance wall", () => {
  test("nobody tapped comes first, then the late, then the newest arrival", () => {
    const board = attendanceBoard(
      [
        person("1", "ZAENAL"),
        person("2", "AGUS"),
        person("3", "BUDI"),
        person("4", "CITRA"),
        person("5", "DEWI"),
      ],
      [
        tap("3", at("05:29:00")),
        tap("4", at("05:35:00")),
        tap("5", at("05:20:00")),
      ],
      "day",
      GATE
    );

    expect(board.total).toBe(5);
    expect(board.absent).toBe(2);
    expect(board.late).toBe(1);
    expect(board.present).toBe(2);
    expect(board.rows.map((r) => r.name)).toEqual([
      // Absent, alphabetically — they are why the screen exists.
      "AGUS",
      "ZAENAL",
      // Then the late.
      "CITRA",
      // Then the present, newest tap first.
      "BUDI",
      "DEWI",
    ]);
  });

  test("a night shift is not passed by a morning tap", () => {
    const morningOnly = [
      { nik: "1", firstInAt: at("06:20:00"), firstInPmAt: null },
    ];
    const board = attendanceBoard(
      [person("1", "SATU")],
      morningOnly,
      "night",
      "17:25:00"
    );
    // The 06:20 tap belongs to a shift that ended, not to the one starting.
    expect(board.rows[0]!.verdict).toBe("missing");
    expect(board.rows[0]!.tappedAt).toBeNull();
  });

  test("the list is cut but the counts are not", () => {
    const roster = Array.from({ length: 60 }, (_, i) =>
      person(String(i), `ORANG ${String(i).padStart(2, "0")}`)
    );
    const board = attendanceBoard(roster, [], "day", GATE);
    expect(board.total).toBe(60);
    expect(board.absent).toBe(60);
    expect(board.rows).toHaveLength(40);
  });
});

/* ------------------------------------------------------------- fit to work */

describe("the fit-to-work wall", () => {
  /*
   * Ordered by what savera decided about the person, not by which of our
   * verdicts applies. `late` and `unreadable` are our own bookkeeping; a man
   * told not to work outranks both, because the wall is read by a supervisor
   * and only one of those rows is his to act on.
   */
  test("orders by what savera decided, worst first", () => {
    const board = fitWorkBoard(
      [
        person("1", "LOLOS"),
        person("2", "BELUM"),
        person("3", "TOLAK"),
        person("4", "ISTIRAHAT"),
        person("5", "ANEH"),
      ],
      [
        filing("1", "FTW aman", "Dapat Bekerja", "04:50:00"),
        filing("3", "FTW aman", "Tidak Boleh Bekerja", "04:50:00"),
        filing("4", "FTW aman", "Istirahat Minimal 1 Jam", "04:50:00"),
        filing("5", "FTW aman", "Entah apa", "04:50:00"),
      ],
      GATE
    );

    /* LOLOS is counted and not shown: the cleared are most of a good morning,
       and they would spend the whole cut saying nothing needs doing. */
    expect(board.rows.map((r) => r.name)).toEqual([
      "BELUM",
      /* The clinic's refusal outranks ours: TOLAK is a medical answer, ANEH
         a verdict we could not read. */
      "TOLAK",
      "ANEH",
      "ISTIRAHAT",
    ]);
    expect(board.total).toBe(5);
    expect(board.filed).toBe(4);
    expect(board.passed).toBe(1);
    expect(board.rest).toBe(1);
    /* TOLAK is the clinic's refusal; ANEH is a verdict we could not read,
       which is ours. Two tiles, because they are two people's jobs. */
    /* TOLAK is the clinic's answer, ANEH a verdict we could not read. Both
       are a filing that did not get through, and one figure counts them. */
    expect(board.ftwFailed).toBe(2);
    /* Everyone who cannot be given a unit — the whole wall. */
    expect(board.allocFailed).toBe(4);
    expect(board.missing).toBe(1);
    /* The three parts divide it exactly. */
    expect(board.missing + board.rest + board.ftwFailed).toBe(
      board.allocFailed
    );
    expect(board.passed + board.allocFailed).toBe(board.total);
  });

  /*
   * A filing that reads "Dapat Bekerja" but was refused for another reason —
   * uploaded late, or a decision savera would not sign — is not a clearance.
   * Keying the group off the category would have dropped it from a wall that
   * now shows only the exceptions, and it is one of them.
   */
  test("a fit category that did not pass stays on the wall", () => {
    const board = fitWorkBoard(
      [person("1", "TELAT FIT"), person("2", "TOLAK KEPUTUSAN")],
      [
        filing("1", "FTW aman", "Dapat Bekerja", "05:31:00"),
        filing("2", "FTW Perlu Tindak Lanjut", "Dapat Bekerja", "04:50:00"),
      ],
      GATE
    );
    /* One refused by us for landing late, one refused by the clinic — and
       the clinic's refusal leads. */
    expect(board.rows.map((r) => [r.name, r.group])).toEqual([
      ["TOLAK KEPUTUSAN", "ftwFail"],
      ["TELAT FIT", "allocFail"],
    ]);
    expect(board.passed).toBe(0);
    expect(board.ftwFailed).toBe(2);
    expect(board.allocFailed).toBe(2);
  });

  /*
   * savera contradicts itself on this shape — "FTW aman" over a category that
   * forbids work, 177 rows in one sample. The owner's call (2026-09-14): what
   * forbids a man to work is a medical statement, whatever the line above it
   * says, so the clinic owns the refusal.
   */
  test("a forbidding category beats a decision that says aman", () => {
    const board = fitWorkBoard(
      [person("1", "SATU")],
      [filing("1", "FTW aman", "Tidak Boleh Bekerja", "04:50:00")],
      GATE
    );
    expect(board.rows[0]!.group).toBe("ftwFail");
    expect(board.ftwFailed).toBe(1);
    expect(board.allocFailed).toBe(1);
  });

  /*
   * Cleared by the clinic on both lines and refused by our deadline alone.
   * The owner counts him with the refusals (2026-09-14): his FTW did not
   * arrive in time to be one. The group still says which it was, and the card
   * prints the reason under the badge.
   */
  test("a late upload savera cleared is still counted as a refusal", () => {
    const board = fitWorkBoard(
      [person("1", "SATU")],
      [filing("1", "FTW aman", "Dapat Bekerja", "05:31:00")],
      GATE
    );
    expect(board.rows[0]!.group).toBe("allocFail");
    expect(board.ftwFailed).toBe(1);
    expect(board.allocFailed).toBe(1);
  });

  /* He is not cleared for a unit either, so he belongs in the same figure —
     while keeping the group that makes his row yellow rather than red. */
  test("somebody told to rest counts as an allocation refusal", () => {
    const board = fitWorkBoard(
      [person("1", "SATU")],
      [filing("1", "FTW aman", "Istirahat Minimal 1 Jam", "04:50:00")],
      GATE
    );
    expect(board.rows[0]!.group).toBe("rest");
    expect(board.rest).toBe(1);
    expect(board.allocFailed).toBe(1);
    expect(board.ftwFailed).toBe(0);
  });

  /* Nobody has filed, so nobody can be seated — the tile counts him too. */
  test("somebody who has not filed is an allocation refusal as well", () => {
    const board = fitWorkBoard([person("1", "SATU")], [], GATE);
    expect(board.missing).toBe(1);
    expect(board.allocFailed).toBe(1);
    expect(board.ftwFailed).toBe(0);
  });

  /* A late upload still says something about the person, and that is what
     places it. The Status badge beside it is what says it came in late. */
  test("a late filing sorts by its category, not by its lateness", () => {
    const board = fitWorkBoard(
      [person("1", "TELAT ISTIRAHAT"), person("2", "TEPAT TOLAK")],
      [
        filing("1", "FTW aman", "Istirahat Minimal 2 Jam", "05:31:00"),
        filing("2", "FTW aman", "Tidak Boleh Bekerja", "04:50:00"),
      ],
      GATE
    );
    expect(board.rows.map((r) => r.name)).toEqual([
      "TEPAT TOLAK",
      "TELAT ISTIRAHAT",
    ]);
    expect(board.rows[1]!.verdict).toBe("late");
  });

  /* Somebody who filed but whose row carries no category has still been to
     the clinic — but there is nothing to place him by, so he leads with the
     people who have not filed at all. */
  test("a filing with no category at all leads with the unfiled", () => {
    const board = fitWorkBoard(
      [person("1", "KOSONG"), person("2", "ISTIRAHAT")],
      [
        { ...filing("1", "FTW aman", "x", "04:50:00"), sleepCategory: null },
        filing("2", "FTW aman", "Istirahat Minimal 1 Jam", "04:50:00"),
      ],
      GATE
    );
    expect(board.rows.map((r) => r.name)).toEqual(["KOSONG", "ISTIRAHAT"]);
  });

  test("a verdict that passes beside a sleep category that forbids work fails", () => {
    const board = fitWorkBoard(
      [person("1", "SATU")],
      [filing("1", "FTW aman", "Tidak Boleh Bekerja", "04:50:00")],
      GATE
    );
    expect(board.rows[0]!.verdict).toBe("fail");
  });

  /* On a row the wall still shows — a clearance is counted, never rendered. */
  test("what was filed is carried through for the screen to render", () => {
    const board = fitWorkBoard(
      [person("1", "SATU")],
      [filing("1", "FTW aman", "Istirahat Minimal 1 Jam", "04:50:00")],
      GATE
    );
    expect(board.rows[0]).toMatchObject({
      sleepMinutes: 445,
      sleepCategory: "Istirahat Minimal 1 Jam",
      sentAt: "04:50:00",
    });
  });

  /* The wall would otherwise spend its forty rows on people who are fine. */
  test("a cleared filing is counted and never rendered", () => {
    const board = fitWorkBoard(
      [person("1", "SATU")],
      [filing("1", "FTW aman", "Dapat Bekerja", "04:50:00")],
      GATE
    );
    expect(board.rows).toEqual([]);
    expect(board.passed).toBe(1);
    expect(board.filed).toBe(1);
  });
});

/* ---------------------------------------------------------- authorization */

async function makeUser(menu: "display-attendance" | "display-fitwork") {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-wall-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db
    .insert(schema.rolePermissions)
    .values([{ roleId: role!.id, menuSlug: menu, mode: "view" }]);
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
  return `${SESSION_COOKIE}=${session.id}`;
}

const get = (path: string, cookie?: string) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      headers: cookie ? { cookie } : {},
    })
  );

/** A paired screen of one kind, with a session of its own. */
async function makeDevice(kind: "att" | "fitwork") {
  const id = `ZZW${uid().toUpperCase()}`;
  await db.insert(schema.devices).values({ id, name: tag, kind });
  made.devices.push(id);
  // A device presents its own cookie; the user cookie is a different door.
  const session = await createSession("device", id, "cookie");
  return `${DEVICE_COOKIE}=${session.id}`;
}

/**
 * Who the fit-to-work wall is even about.
 *
 * The register decides, and the register is the master unit list: a licence
 * counts when some unit carrying its simper code is marked `ftw`. Everything
 * here is built from scratch rather than read off the dev seed, because the
 * answer must not depend on which machines happen to be in the yard.
 */
describe("who owes a filing", () => {
  const fixture = {
    employees: [] as string[],
    units: [] as string[],
    codes: [] as string[],
    positions: [] as string[],
  };

  afterAll(async () => {
    if (fixture.employees.length)
      await db
        .delete(schema.employees)
        .where(inArray(schema.employees.id, fixture.employees));
    if (fixture.units.length)
      await db
        .delete(schema.units)
        .where(inArray(schema.units.id, fixture.units));
    if (fixture.codes.length)
      await db
        .delete(schema.simperCodes)
        .where(inArray(schema.simperCodes.id, fixture.codes));
    if (fixture.positions.length)
      await db
        .delete(schema.positions)
        .where(inArray(schema.positions.id, fixture.positions));
  });

  /** A simper code, and one unit under it that either demands a filing or not. */
  const code = async (
    name: string,
    ftw: boolean,
    opts: { active?: boolean; withUnit?: boolean } = {}
  ) => {
    const [row] = await db
      .insert(schema.simperCodes)
      .values({ name: `${tag} ${name}` })
      .returning({ id: schema.simperCodes.id });
    fixture.codes.push(row!.id);
    if (opts.withUnit !== false) {
      /* The catalogue keys a unit cannot exist without. Any row will do: what
         is under test is the `ftw` flag, not the machine's pedigree. */
      const [cls] = await db
        .select({ id: schema.unitClasses.id })
        .from(schema.unitClasses)
        .limit(1);
      const [type] = await db
        .select({ id: schema.unitTypes.id })
        .from(schema.unitTypes)
        .limit(1);
      const [model] = await db
        .select({ id: schema.unitModels.id })
        .from(schema.unitModels)
        .limit(1);
      const [brand] = await db
        .select({ id: schema.unitBrands.id })
        .from(schema.unitBrands)
        .limit(1);
      const [unit] = await db
        .insert(schema.units)
        .values({
          code: `${tag} ${name} 01`.slice(0, 40),
          classId: cls!.id,
          typeId: type!.id,
          modelId: model!.id,
          brandId: brand!.id,
          simperCodeId: row!.id,
          ftw,
          active: opts.active ?? true,
        })
        .returning({ id: schema.units.id });
      fixture.units.push(unit!.id);
    }
    return row!.id;
  };

  const operator = async (
    nik: string,
    codes: string[],
    fleetAllocation = true,
    status: "aktif" | "standby" | "nonaktif" = "aktif"
  ) => {
    const [dept] = await db
      .select({
        id: schema.departments.id,
        companyId: schema.departments.companyId,
      })
      .from(schema.departments)
      .limit(1);
    const [pos] = await db
      .insert(schema.positions)
      .values({
        name: `${tag} POS ${nik}`,
        departmentId: dept!.id,
        fleetAllocation,
      })
      .returning({ id: schema.positions.id });
    fixture.positions.push(pos!.id);

    const [emp] = await db
      .insert(schema.employees)
      .values({
        nik,
        name: `${tag} ${nik}`,
        departmentId: dept!.id,
        companyId: dept!.companyId,
        positionId: pos!.id,
        status,
      })
      .returning({ id: schema.employees.id });
    fixture.employees.push(emp!.id);

    if (codes.length)
      await db
        .insert(schema.employeeSkills)
        .values(
          codes.map((simperCodeId) => ({ employeeId: emp!.id, simperCodeId }))
        );
    return nik;
  };

  test("a licence on a unit the master marks ftw obliges its holder", async () => {
    const dt = await code("DT", true);
    const nik = await operator("ZZ90000001", [dt]);
    expect([...(await ftwObliged([nik]))]).toEqual([nik]);
  });

  /* The excavator operator nobody asks. Before this he sat on the wall in red
     for the whole muster, and missing sorts first. */
  test("a licence on a unit the master does not mark ftw does not", async () => {
    const exc = await code("EXC", false);
    const nik = await operator("ZZ90000002", [exc]);
    expect(await ftwObliged([nik])).not.toContain(nik);
  });

  /* Any qualifying licence, not all of them: he can be given either machine. */
  test("holding both kinds obliges", async () => {
    const dt = await code("DT2", true);
    const exc = await code("EXC2", false);
    const nik = await operator("ZZ90000003", [exc, dt]);
    expect([...(await ftwObliged([nik]))]).toEqual([nik]);
  });

  /*
   * `active` is about this morning, `ftw` about the kind of machine. A dozer
   * parked for repair has not stopped being a dozer, and reading availability
   * as if it were the requirement would quietly excuse its operator.
   */
  test("a unit out of service still states what its kind demands", async () => {
    const dt = await code("DT3", true, { active: false });
    const nik = await operator("ZZ90000004", [dt]);
    expect([...(await ftwObliged([nik]))]).toEqual([nik]);
  });

  /* The fleet owns none of these, so nobody can be put on one. */
  test("a code with no unit at all says nothing", async () => {
    const orphan = await code("TR", true, { withUnit: false });
    const nik = await operator("ZZ90000005", [orphan]);
    expect(await ftwObliged([nik])).not.toContain(nik);
  });

  /* A payroll officer on the roster is not somebody the muster waits on. */
  test("a position that is never allocated a unit is left out", async () => {
    const dt = await code("DT4", true);
    const nik = await operator("ZZ90000006", [dt], false);
    expect(await ftwObliged([nik])).not.toContain(nik);
  });

  test("somebody with no licence at all is left out", async () => {
    const nik = await operator("ZZ90000007", []);
    expect(await ftwObliged([nik])).not.toContain(nik);
  });

  /* Standby is given no unit (owner, 2026-09-03), so he owes no filing and
     would otherwise stand on the wall as "Belum upload FTW" all muster. */
  test("an employee on standby is left out", async () => {
    const dt = await code("DT5", true);
    const nik = await operator("ZZ90000008", [dt], true, "standby");
    expect(await ftwObliged([nik])).not.toContain(nik);
  });
});

describe("who may read a wall", () => {
  test("no session gets 401", async () => {
    expect((await get("/attendance/display")).status).toBe(401);
    expect((await get("/fit-to-work/display")).status).toBe(401);
  });

  test("each wall's grant opens its own screen and not the other", async () => {
    const attendance = await makeUser("display-attendance");
    expect((await get("/attendance/display", attendance)).status).toBe(200);
    expect((await get("/fit-to-work/display", attendance)).status).toBe(403);
  });

  test("a screen may read its own wall and no other", async () => {
    // The whole point of pairing a TV: the attendance screen in the muster
    // room must not be a way to read the yard's FTW list.
    const att = await makeDevice("att");
    expect((await get("/attendance/display", att)).status).toBe(200);
    const refused = await get("/fit-to-work/display", att);
    expect(refused.status).toBe(403);

    const fitwork = await makeDevice("fitwork");
    expect((await get("/fit-to-work/display", fitwork)).status).toBe(200);
    expect((await get("/attendance/display", fitwork)).status).toBe(403);
  });

  test("the envelope is there whatever the shift holds", async () => {
    const cookie = await makeUser("display-fitwork");
    const body = (await (await get("/fit-to-work/display", cookie)).json()) as {
      servedAt: string;
      total: number;
      rows: unknown[];
    };
    // A wall that renders an error renders nothing, so there is always an
    // answer — `date` null only when the timeline cannot say which shift is
    // on, and an empty `rows` at zero `total` means nobody is rostered.
    expect(typeof body.servedAt).toBe("string");
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.rows.length).toBeLessThanOrEqual(body.total);
  });
});

/* ------------------------------------------------------------ scan tickets */

/**
 * The attendance TV's ticket feed and the faces on it.
 *
 * One real scan, stamped now, so the route's own idea of the running shift
 * includes it — which is also why this needs the seeded timeline: with no
 * shift gates there is no running shift and nothing is anybody's to see.
 */
describe("the scan feed and its photos", () => {
  /* Digits only: every source's NIK is normalized to its digits, the photo
     route's lookup included. */
  const nik = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  const photoFile = `zz-wall-${uid()}.jpg`;
  const ip = `10.99.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  let employeeId: string | null = null;

  /** The wall clock the machines write, in the process's own zone. */
  const machineNow = () => {
    const now = new Date();
    const hms = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map((n) => String(n).padStart(2, "0"))
      .join(":");
    return `${localDate(now)} ${hms}`;
  };

  beforeAll(async () => {
    /* Borrowed from the seeded master: the register's foreign keys are not
       what this is about. */
    const [someone] = await db
      .select({
        companyId: schema.employees.companyId,
        positionId: schema.employees.positionId,
        departmentId: schema.employees.departmentId,
      })
      .from(schema.employees)
      .limit(1);
    const [row] = await db
      .insert(schema.employees)
      .values({ ...someone!, nik, name: tag, photoFileName: photoFile })
      .returning({ id: schema.employees.id });
    employeeId = row!.id;
    await writePhoto(photoFile, new Uint8Array([0xff, 0xd8, 0xff]).buffer);
    await db
      .insert(schema.deviceLiveEvents)
      .values({ ip, nik, at: machineNow() });
  });

  afterAll(async () => {
    await db
      .delete(schema.deviceLiveEvents)
      .where(inArray(schema.deviceLiveEvents.nik, [nik]));
    if (employeeId)
      await db
        .delete(schema.employees)
        .where(inArray(schema.employees.id, [employeeId]));
    await deletePhoto(photoFile);
  });

  test("no session gets 401", async () => {
    expect((await get("/attendance/display/scans")).status).toBe(401);
    expect((await get(`/attendance/display/photo/${nik}`)).status).toBe(401);
  });

  test("only the attendance screen may read them", async () => {
    const fitwork = await makeDevice("fitwork");
    expect((await get("/attendance/display/scans", fitwork)).status).toBe(403);
    expect(
      (await get(`/attendance/display/photo/${nik}`, fitwork)).status
    ).toBe(403);
  });

  test("a scan made now is on the feed, with who and where", async () => {
    const att = await makeDevice("att");
    const res = await get("/attendance/display/scans", att);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      servedAt: string;
      shift: string | null;
      scans: {
        key: string;
        nik: string;
        name: string;
        photoFile: string | null;
        status: string;
        scannedAt: string;
        shift: string;
        ftw: string | null;
        unit: string | null;
        area: string | null;
        bus: string | null;
      }[];
    };
    expect(body.shift).not.toBeNull();
    const mine = body.scans.find((s) => s.nik === nik);
    expect(mine).toBeDefined();
    expect(mine!.name).toBe(tag);
    expect(mine!.photoFile).toBe(photoFile);
    // A live tap carries no direction; the slip prints IN, and so does this.
    expect(mine!.status).toBe("IN");
    expect(mine!.scannedAt).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(mine!.shift).toBe(body.shift!);
    // Nothing filed and no slip printed: all four empty, none invented.
    expect(mine!.ftw).toBeNull();
    expect(mine!.unit).toBeNull();
    expect(mine!.area).toBeNull();
    expect(mine!.bus).toBeNull();
  });

  test("the seat is the slip's, and FTW is what savera filed", async () => {
    /* Filed the way the listener files it — the tap's own date and half of
       the day — which is not always the wall's shift date after midnight. */
    const [scan] = await db
      .select({ at: schema.deviceLiveEvents.at })
      .from(schema.deviceLiveEvents)
      .where(inArray(schema.deviceLiveEvents.nik, [nik]));
    const date = scan!.at.slice(0, 10);
    const shift = scan!.at.slice(11, 19) < "12:00:00" ? "day" : "night";
    await db.insert(schema.tickets).values({
      nik,
      date,
      shift,
      ip,
      status: "dry",
      contentHash: `zz-${uid()}`,
      preview: "",
      fields: {
        seat: { unit: "ZZDT9", bus: "ZZ BU 04", fleet: null, area: "ZZ AREA" },
      },
    });

    const shiftDate = (
      (await (
        await get("/attendance/display/scans", await makeDevice("att"))
      ).json()) as { date: string }
    ).date;
    await db.insert(schema.ftwReadings).values({
      nik,
      date: shiftDate,
      name: tag,
      sleepCategory: "Langsung bekerja",
    });

    const att = await makeDevice("att");
    const body = (await (
      await get("/attendance/display/scans", att)
    ).json()) as {
      scans: {
        nik: string;
        ftw: string | null;
        unit: string | null;
        area: string | null;
        bus: string | null;
      }[];
    };
    const mine = body.scans.find((s) => s.nik === nik);
    expect(mine?.unit).toBe("ZZDT9");
    expect(mine?.area).toBe("ZZ AREA");
    expect(mine?.bus).toBe("ZZ BU 04");
    expect(mine?.ftw).toBe("Langsung bekerja");

    await db.delete(schema.tickets).where(inArray(schema.tickets.nik, [nik]));
    await db
      .delete(schema.ftwReadings)
      .where(inArray(schema.ftwReadings.nik, [nik]));
  });

  test("a screen gets the face of somebody who scanned this shift", async () => {
    const att = await makeDevice("att");
    const res = await get(`/attendance/display/photo/${nik}`, att);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/");
  });

  test("and nobody else's: the register is not browsable one NIK at a time", async () => {
    const att = await makeDevice("att");
    const [other] = await db
      .select({ nik: schema.employees.nik })
      .from(schema.employees)
      .where(
        and(
          isNotNull(schema.employees.photoFileName),
          ne(schema.employees.nik, nik)
        )
      )
      .limit(1);
    const res = await get(
      `/attendance/display/photo/${other?.nik ?? "ZZ000000"}`,
      att
    );
    expect(res.status).toBe(404);
  });
});

afterAll(async () => {
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
  if (made.devices.length)
    await db
      .delete(schema.devices)
      .where(inArray(schema.devices.id, made.devices));
  redis.disconnect();
});
