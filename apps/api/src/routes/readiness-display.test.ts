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

import { afterAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { inArray } from "drizzle-orm";

import { createSession, DEVICE_COOKIE, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import {
  attendanceBoard,
  attendanceDisplayRoutes,
  fitWorkBoard,
  fitWorkDisplayRoutes,
} from "./readiness-display";

const app = new Elysia().use(attendanceDisplayRoutes).use(fitWorkDisplayRoutes);

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
  test("orders by what a supervisor would walk over for", () => {
    const board = fitWorkBoard(
      [
        person("1", "LOLOS"),
        person("2", "BELUM"),
        person("3", "TOLAK"),
        person("4", "TELAT"),
        person("5", "ANEH"),
      ],
      [
        filing("1", "FTW aman", "Dapat Bekerja", "04:50:00"),
        filing("3", "FTW Perlu Tindak Lanjut", "Dapat Bekerja", "04:50:00"),
        filing("4", "FTW aman", "Dapat Bekerja", "05:31:00"),
        filing("5", "Entah apa", "Dapat Bekerja", "04:50:00"),
      ],
      GATE
    );

    expect(board.rows.map((r) => r.verdict)).toEqual([
      "missing",
      "fail",
      "unreadable",
      "late",
      "pass",
    ]);
    expect(board.total).toBe(5);
    expect(board.filed).toBe(4);
    expect(board.passed).toBe(1);
    // Refused, late and unreadable are one number: all three mean "see to
    // this person", and a wall has no room to split an instruction three ways.
    expect(board.refused).toBe(3);
    expect(board.missing).toBe(1);
  });

  test("a verdict that passes beside a sleep category that forbids work fails", () => {
    const board = fitWorkBoard(
      [person("1", "SATU")],
      [filing("1", "FTW aman", "Tidak Boleh Bekerja", "04:50:00")],
      GATE
    );
    expect(board.rows[0]!.verdict).toBe("fail");
  });

  test("what was filed is carried through for the screen to render", () => {
    const board = fitWorkBoard(
      [person("1", "SATU")],
      [filing("1", "FTW aman", "Dapat Bekerja", "04:50:00")],
      GATE
    );
    expect(board.rows[0]).toMatchObject({
      sleepMinutes: 445,
      sleepCategory: "Dapat Bekerja",
      sentAt: "04:50:00",
    });
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
