/**
 * Telling one person their seat, never before the slip would
 * (docs/prd.md, Mobile app → Notifications on the phone).
 *
 *   bun --env-file=.env test src/person-notify.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";

import { db, schema } from "./db";
import {
  announceBoard,
  announcePlacement,
  deliverDue,
  myNotifications,
  pushText,
  type PushSender,
} from "./person-notify";

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji Notif ${uid()}`;
const DATE = "1998-05-04";
const SECOND_FINGER = "05:28:00";

/** Local instants on the muster's date. */
const at = (clock: string) => new Date(`${DATE}T${clock}`);
const BOARD_BUILT = at("05:26:00");
const BEFORE_SECOND = at("05:27:00");
const AFTER_SECOND = at("05:28:30");

/** NIKs in a range no real register uses. */
const HOLDER = "99100001";
const SPARE = "99100002";
const NO_ACCOUNT = "99100003";
const LATE = "99100004";

const made = {
  company: "",
  department: "",
  position: "",
  employees: new Map<string, string>(),
  masters: [] as {
    table: "unitClasses" | "unitTypes" | "unitModels" | "unitBrands";
    id: string;
  }[],
  units: [] as { id: string; code: string }[],
  users: [] as string[],
  doc: "",
};
const unit = (i: number) => made.units[i]!;
const idOf = (nik: string) => made.employees.get(nik)!;

beforeAll(async () => {
  const [company] = await db
    .insert(schema.companies)
    .values({ name: `${tag} PT`, code: `ZN${uid().slice(0, 4)}` })
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
      [HOLDER, SPARE, NO_ACCOUNT, LATE].map((nik) => ({
        nik,
        name: `${tag} ${nik}`,
        companyId: made.company,
        departmentId: made.department,
        positionId: made.position,
        status: "aktif" as const,
      }))
    )
    .returning({ id: schema.employees.id, nik: schema.employees.nik });
  for (const e of employees) made.employees.set(e.nik, e.id);

  const [role] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.slug, "user"))
    .limit(1);
  const users = await db
    .insert(schema.users)
    .values(
      [HOLDER, SPARE, LATE].map((nik) => ({
        nik,
        name: `${tag} ${nik}`,
        passwordHash: "x",
        roleId: role!.id,
        mustChangePassword: false,
      }))
    )
    .returning({ id: schema.users.id });
  made.users.push(...users.map((u) => u.id));

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
  const kinds = {
    classId: await master("unitClasses"),
    typeId: await master("unitTypes"),
    modelId: await master("unitModels"),
    brandId: await master("unitBrands"),
  };
  for (const suffix of ["A", "B", "C"]) {
    const [row] = await db
      .insert(schema.units)
      .values({ code: `ZZN-${suffix}-${uid()}`, ...kinds })
      .returning({ id: schema.units.id, code: schema.units.code });
    made.units.push(row!);
  }

  const [doc] = await db
    .insert(schema.fleetActualDocuments)
    .values({ date: DATE, shift: "day" })
    .returning({ id: schema.fleetActualDocuments.id });
  made.doc = doc!.id;
  await db.insert(schema.fleetActualSlots).values([
    {
      documentId: made.doc,
      unitId: unit(0).id,
      employeeId: idOf(HOLDER),
      source: "plan",
      workArea: "PIT 1",
      transportCode: "BUS 1",
    },
    {
      documentId: made.doc,
      unitId: unit(1).id,
      employeeId: idOf(SPARE),
      source: "spare",
      workArea: "PIT 2",
    },
    {
      documentId: made.doc,
      unitId: unit(2).id,
      employeeId: idOf(NO_ACCOUNT),
      source: "plan",
    },
  ]);
});

afterAll(async () => {
  if (made.doc)
    await db
      .delete(schema.fleetActualDocuments)
      .where(eq(schema.fleetActualDocuments.id, made.doc));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.employees.size)
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, [...made.employees.values()]));
  if (made.units.length)
    await db.delete(schema.units).where(
      inArray(
        schema.units.id,
        made.units.map((u) => u.id)
      )
    );
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

const rowsOf = (nik: string) =>
  db
    .select()
    .from(schema.personNotifications)
    .where(eq(schema.personNotifications.employeeId, idOf(nik)));

/** A sender that records what it was asked to send. */
function fakeSender(unregistered: string[] = []) {
  const sent: { token: string; title: string; body: string }[] = [];
  const sender: PushSender = {
    async send(token, message) {
      sent.push({ token, title: message.title, body: message.body });
      return unregistered.includes(token) ? "unregistered" : "sent";
    },
  };
  return { sender, sent };
}

async function phone(nik: string, token: string) {
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.nik, nik))
    .limit(1);
  await db
    .insert(schema.pushDevices)
    .values({ userId: user!.id, token, platform: "android", sessionHash: "t" });
}

describe("when the board is built", () => {
  test("everybody seated who has an account gets one row, nobody else", async () => {
    await announceBoard(DATE, "day", BOARD_BUILT, SECOND_FINGER);
    expect(await rowsOf(HOLDER)).toHaveLength(1);
    expect(await rowsOf(SPARE)).toHaveLength(1);
    expect(await rowsOf(NO_ACCOUNT)).toHaveLength(0);
  });

  test("a holder's seat is available at once, a spare's at the second finger", async () => {
    const [holder] = await rowsOf(HOLDER);
    const [spare] = await rowsOf(SPARE);
    expect(holder!.availableAt.getTime()).toBe(BOARD_BUILT.getTime());
    expect(spare!.availableAt.getTime()).toBe(at(SECOND_FINGER).getTime());
    expect(holder!.params).toMatchObject({
      unit: unit(0).code,
      area: "PIT 1",
      bus: "BUS 1",
    });
  });

  test("a board long past, regenerated today, announces nothing", async () => {
    // A seat on a board from years ago is not news; a push about it would be
    // a phone buzzing for nothing.
    await db
      .delete(schema.personNotifications)
      .where(eq(schema.personNotifications.employeeId, idOf(HOLDER)));
    expect(await announceBoard(DATE, "day", new Date(), SECOND_FINGER)).toBe(0);
    expect(await rowsOf(HOLDER)).toHaveLength(0);
    // Put it back, announced at the muster, for the tests that follow.
    await announceBoard(DATE, "day", BOARD_BUILT, SECOND_FINGER);
  });

  test("announcing the same board again writes nothing new", async () => {
    await announceBoard(DATE, "day", BOARD_BUILT, SECOND_FINGER);
    expect(await rowsOf(HOLDER)).toHaveLength(1);
    expect(await rowsOf(SPARE)).toHaveLength(1);
  });

  test("with no second-finger stage, a spare's seat is never announced", async () => {
    await db
      .delete(schema.personNotifications)
      .where(eq(schema.personNotifications.employeeId, idOf(SPARE)));
    await announceBoard(DATE, "day", BOARD_BUILT, null);
    expect(await rowsOf(SPARE)).toHaveLength(0);
    // Put it back for the tests that follow.
    await announceBoard(DATE, "day", BOARD_BUILT, SECOND_FINGER);
    expect(await rowsOf(SPARE)).toHaveLength(1);
  });
});

describe("what the person sees", () => {
  test("a spare's row is not listed before the second finger", async () => {
    expect((await myNotifications(SPARE, BEFORE_SECOND)).items).toHaveLength(0);
    const after = await myNotifications(SPARE, AFTER_SECOND);
    expect(after.items).toHaveLength(1);
    expect(after.unread).toBe(1);
  });

  test("a holder's is listed as soon as the board exists", async () => {
    const mine = await myNotifications(HOLDER, BEFORE_SECOND);
    expect(mine.items[0]).toMatchObject({
      kind: "seat-assigned",
      date: DATE,
      shift: "day",
      params: { unit: unit(0).code },
      readAt: null,
    });
  });
});

describe("pushing", () => {
  test("only what is due, once, to the person's own phones", async () => {
    await phone(HOLDER, `tok-holder-${uid()}`);
    await phone(SPARE, `tok-spare-${uid()}`);
    const first = fakeSender();
    await deliverDue(BEFORE_SECOND, first.sender);
    expect(first.sent).toHaveLength(1);
    expect(first.sent[0]!.title).toContain(unit(0).code);

    const second = fakeSender();
    await deliverDue(AFTER_SECOND, second.sender);
    expect(second.sent).toHaveLength(1);
    expect(second.sent[0]!.title).toContain(unit(1).code);

    const third = fakeSender();
    await deliverDue(AFTER_SECOND, third.sender);
    expect(third.sent).toHaveLength(0);
  });

  test("with no sender configured nothing is marked, so it can still go out", async () => {
    await announcePlacement({
      date: DATE,
      shift: "day",
      unitId: unit(2).id,
      placed: idOf(LATE),
      displaced: null,
      now: AFTER_SECOND,
      secondFingerAt: SECOND_FINGER,
    });
    await deliverDue(AFTER_SECOND, null);
    const [row] = await rowsOf(LATE);
    expect(row!.pushedAt).toBeNull();
  });

  test("a token the push service no longer knows is dropped", async () => {
    const token = `tok-late-${uid()}`;
    await phone(LATE, token);
    const gone = fakeSender([token]);
    await deliverDue(AFTER_SECOND, gone.sender);
    expect(gone.sent.map((s) => s.token)).toEqual([token]);
    expect(
      await db
        .select()
        .from(schema.pushDevices)
        .where(eq(schema.pushDevices.token, token))
    ).toHaveLength(0);
  });
});

describe("a hand placement", () => {
  test("the person put there is told, at the second finger if it is not yet past", async () => {
    await db
      .delete(schema.personNotifications)
      .where(eq(schema.personNotifications.employeeId, idOf(LATE)));
    await announcePlacement({
      date: DATE,
      shift: "day",
      unitId: unit(2).id,
      placed: idOf(LATE),
      displaced: null,
      now: BOARD_BUILT,
      secondFingerAt: SECOND_FINGER,
    });
    const [row] = await rowsOf(LATE);
    expect(row!.availableAt.getTime()).toBe(at(SECOND_FINGER).getTime());
  });

  test("a displaced person who had already been told is told it no longer holds", async () => {
    await announcePlacement({
      date: DATE,
      shift: "day",
      unitId: unit(0).id,
      placed: null,
      displaced: idOf(HOLDER),
      now: BEFORE_SECOND,
      secondFingerAt: SECOND_FINGER,
    });
    const removed = (await rowsOf(HOLDER)).filter(
      (r) => r.kind === "seat-removed"
    );
    expect(removed).toHaveLength(1);
    expect(removed[0]!.params).toMatchObject({ unit: unit(0).code });
  });

  test("a displaced person not yet told is simply never told", async () => {
    // LATE's seat on unit C waits for the second finger; moving them off it
    // before then takes the waiting row back rather than announcing a loss.
    await announcePlacement({
      date: DATE,
      shift: "day",
      unitId: unit(2).id,
      placed: null,
      displaced: idOf(LATE),
      now: BOARD_BUILT,
      secondFingerAt: SECOND_FINGER,
    });
    expect(await rowsOf(LATE)).toHaveLength(0);
  });
});

describe("the push text", () => {
  test("a seat names the unit, area and bus, in Indonesian", () => {
    expect(
      pushText({
        kind: "seat-assigned",
        date: "2026-10-18",
        shift: "day",
        params: { unit: "DT101", area: "PIT A", bus: "BUS 3", fleet: "EX01" },
      })
    ).toEqual({
      title: "Unit kamu: DT101",
      body: "Shift siang 18 Okt · Area PIT A · Bus BUS 3",
    });
  });

  test("missing details are left out, not printed as null", () => {
    expect(
      pushText({
        kind: "seat-assigned",
        date: "2026-10-18",
        shift: "night",
        params: { unit: "DT101", area: null, bus: null, fleet: null },
      }).body
    ).toBe("Shift malam 18 Okt");
  });

  test("a removed seat says so", () => {
    expect(
      pushText({
        kind: "seat-removed",
        date: "2026-10-18",
        shift: "day",
        params: { unit: "DT101" },
      })
    ).toEqual({
      title: "Penempatan berubah",
      body: "Kamu tidak lagi di DT101 untuk shift siang 18 Okt. Buka aplikasi untuk detail.",
    });
  });
});

test("nothing is ever written for somebody without an account", async () => {
  const stray = await db
    .select()
    .from(schema.personNotifications)
    .where(
      and(
        eq(schema.personNotifications.employeeId, idOf(NO_ACCOUNT)),
        eq(schema.personNotifications.date, DATE)
      )
    );
  expect(stray).toHaveLength(0);
});

describe("delivery holds up under real conditions", () => {
  const DAY2 = "1998-05-05";
  const at2 = (clock: string) => new Date(`${DAY2}T${clock}`);
  let doc2 = "";
  let token = "";

  beforeAll(async () => {
    const [doc] = await db
      .insert(schema.fleetActualDocuments)
      .values({ date: DAY2, shift: "day" })
      .returning({ id: schema.fleetActualDocuments.id });
    doc2 = doc!.id;
    await db.insert(schema.fleetActualSlots).values([
      {
        documentId: doc2,
        unitId: unit(0).id,
        employeeId: idOf(HOLDER),
        source: "plan",
      },
      {
        documentId: doc2,
        unitId: unit(1).id,
        employeeId: idOf(SPARE),
        source: "spare",
      },
      // Empty until a test puts somebody there.
      { documentId: doc2, unitId: unit(2).id, employeeId: null },
    ]);
    token = `tok-2-${uid()}`;
    await phone(HOLDER, token);
  });

  afterAll(async () => {
    await db
      .delete(schema.fleetActualDocuments)
      .where(eq(schema.fleetActualDocuments.id, doc2));
  });

  const rows2 = (nik: string) =>
    db
      .select()
      .from(schema.personNotifications)
      .where(
        and(
          eq(schema.personNotifications.employeeId, idOf(nik)),
          eq(schema.personNotifications.date, DAY2)
        )
      );

  test("a push that failed is tried again, not marked sent", async () => {
    await announceBoard(DAY2, "day", at2("05:26:00"), SECOND_FINGER);
    const failing: PushSender = { send: async () => "failed" };
    await deliverDue(at2("05:26:30"), failing);
    expect((await rows2(HOLDER))[0]!.pushedAt).toBeNull();
  });

  test("two deliveries at once send each row once", async () => {
    const { sender, sent } = fakeSender();
    await Promise.all([
      deliverDue(at2("05:27:00"), sender),
      deliverDue(at2("05:27:00"), sender),
    ]);
    expect(sent.filter((s) => s.token === token)).toHaveLength(1);
  });

  test("an iOS token is not handed to FCM", async () => {
    const iosToken = `ios-${uid()}`;
    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.nik, SPARE));
    await db.insert(schema.pushDevices).values({
      userId: user!.id,
      token: iosToken,
      platform: "ios",
      sessionHash: "t",
    });
    const { sender, sent } = fakeSender();
    await deliverDue(at2("05:28:30"), sender);
    expect(sent.some((s) => s.token === iosToken)).toBe(false);
  });

  test("a deactivated account's phone hears nothing", async () => {
    // The row was written while the account was active; it is switched off
    // before the push goes out.
    await db
      .update(schema.fleetActualSlots)
      .set({ employeeId: idOf(LATE), source: "manual" })
      .where(
        and(
          eq(schema.fleetActualSlots.documentId, doc2),
          eq(schema.fleetActualSlots.unitId, unit(2).id)
        )
      );
    expect(await rows2(LATE)).toHaveLength(0);
    await announcePlacement({
      date: DAY2,
      shift: "day",
      unitId: unit(2).id,
      placed: idOf(LATE),
      displaced: null,
      now: at2("06:00:00"),
      secondFingerAt: SECOND_FINGER,
    });
    expect(await rows2(LATE)).toHaveLength(1);
    const lateToken = `tok-late2-${uid()}`;
    await phone(LATE, lateToken);
    await db
      .update(schema.users)
      .set({ active: false })
      .where(eq(schema.users.nik, LATE));
    try {
      const { sender, sent } = fakeSender();
      await deliverDue(at2("06:00:00"), sender);
      expect(sent.filter((s) => s.token === lateToken)).toHaveLength(0);
    } finally {
      await db
        .update(schema.users)
        .set({ active: true })
        .where(eq(schema.users.nik, LATE));
    }
  });

  test("a regenerated board takes back what it no longer says", async () => {
    // The spare's unit changes before the second finger, and the holder,
    // already told, loses theirs.
    await db
      .update(schema.fleetActualSlots)
      .set({ employeeId: null })
      .where(eq(schema.fleetActualSlots.documentId, doc2));
    await db
      .update(schema.fleetActualSlots)
      .set({ employeeId: idOf(SPARE), source: "spare" })
      .where(
        and(
          eq(schema.fleetActualSlots.documentId, doc2),
          eq(schema.fleetActualSlots.unitId, unit(2).id)
        )
      );
    await announceBoard(DAY2, "day", at2("05:27:30"), SECOND_FINGER);

    const spare = await rows2(SPARE);
    expect(spare.map((r) => (r.params as { unit: string }).unit)).toEqual([
      unit(2).code,
    ]);
    const holder = await rows2(HOLDER);
    expect(holder.map((r) => r.kind).sort()).toEqual([
      "seat-assigned",
      "seat-removed",
    ]);
  });
});
