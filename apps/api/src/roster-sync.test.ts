/**
 * The roster mirror, against a fake unggul_att.
 *
 * The fetcher is injected because the real one reaches a machine on the site
 * network: what is under test here is what the mirror *does* with a response,
 * and that must be provable on a laptop with no route to 192.168.150.7.
 *
 * Dates are 1999 for the same reason as everywhere else in this suite — no
 * real roster will ever cover them, so the fixtures can be wiped by date.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { and, eq, inArray } from "drizzle-orm";

import { db, schema } from "./db";
import { settleCorrectionsMadeDuring, syncRoster } from "./roster-sync";
import type { RosterSourceRow } from "./sources/unggul";

const tag = "ZZ Roster Sync";
const FROM = "1999-05-01";
const TO = "1999-05-31";
const RANGE = { from: FROM, to: TO };

let deptA: string,
  deptB: string,
  posA: string,
  companyId: string,
  userId: string;
const employees: string[] = [];
const niks: string[] = [];

const uid = () => Math.random().toString(36).slice(2, 8);

async function addEmployee(nik: string, departmentId: string) {
  const [row] = await db
    .insert(schema.employees)
    .values({
      nik,
      name: `${tag} ${nik}`,
      companyId,
      departmentId,
      positionId: posA,
      status: "aktif",
    })
    .returning({ id: schema.employees.id });
  employees.push(row!.id);
  niks.push(nik);
  return row!.id;
}

beforeAll(async () => {
  const [company] = await db
    .insert(schema.companies)
    .values({ name: `${tag} PT`, code: `ZR${uid()}` })
    .returning({ id: schema.companies.id });
  companyId = company!.id;

  const depts = await db
    .insert(schema.departments)
    .values([
      { name: `${tag} Dept A`, companyId },
      { name: `${tag} Dept B`, companyId },
    ])
    .returning({ id: schema.departments.id });
  [deptA, deptB] = depts.map((d) => d.id) as [string, string];

  const [position] = await db
    .insert(schema.positions)
    .values({
      name: `${tag} Operator`,
      departmentId: deptA,
      fleetAllocation: true,
    })
    .returning({ id: schema.positions.id });
  posA = position!.id;

  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-roster-${uid()}@uji.local`,
      name: tag,
      passwordHash: "x",
      roleId: (
        await db.select({ id: schema.roles.id }).from(schema.roles).limit(1)
      )[0]!.id,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  userId = user!.id;
});

/** Documents of the fixture departments, and everything hanging off them. */
async function wipeDocuments() {
  const docs = await db
    .select({ id: schema.rosterDocuments.id })
    .from(schema.rosterDocuments)
    .where(inArray(schema.rosterDocuments.departmentId, [deptA, deptB]));
  const ids = docs.map((d) => d.id);
  if (!ids.length) return;
  await db
    .delete(schema.rosterDays)
    .where(inArray(schema.rosterDays.documentId, ids));
  await db
    .delete(schema.rosterDocuments)
    .where(inArray(schema.rosterDocuments.id, ids));
}

beforeEach(wipeDocuments);

afterAll(async () => {
  await wipeDocuments();
  /* Before the employees and the user: a correction holds both. */
  if (employees.length)
    await db
      .delete(schema.rosterCorrections)
      .where(inArray(schema.rosterCorrections.employeeId, employees));
  if (employees.length)
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, employees));
  await db.delete(schema.users).where(eq(schema.users.id, userId));
  await db.delete(schema.positions).where(eq(schema.positions.id, posA));
  await db
    .delete(schema.departments)
    .where(inArray(schema.departments.id, [deptA, deptB]));
  await db.delete(schema.companies).where(eq(schema.companies.id, companyId));
});

const from = (rows: RosterSourceRow[]) => async () => rows;

/** The days one department's active document holds, as `date=code`. */
async function held(departmentId: string, month = "1999-05-01") {
  const rows = await db
    .select({
      date: schema.rosterDays.date,
      code: schema.rosterDays.code,
      nik: schema.employees.nik,
    })
    .from(schema.rosterDays)
    .innerJoin(
      schema.rosterDocuments,
      eq(schema.rosterDocuments.id, schema.rosterDays.documentId)
    )
    .innerJoin(
      schema.employees,
      eq(schema.employees.id, schema.rosterDays.employeeId)
    )
    .where(
      and(
        eq(schema.rosterDocuments.departmentId, departmentId),
        eq(schema.rosterDocuments.month, month),
        eq(schema.rosterDocuments.status, "aktif")
      )
    );
  return rows.map((r) => `${r.nik} ${r.date}=${r.code}`).sort();
}

describe("syncRoster", () => {
  test("files each person's days under their own department's document", async () => {
    const a = `9911${uid().slice(0, 4)}`;
    const b = `9912${uid().slice(0, 4)}`;
    await addEmployee(a, deptA);
    await addEmployee(b, deptB);

    const result = await syncRoster(
      RANGE,
      from([
        { nik: a, date: "1999-05-01", code: "D" },
        { nik: b, date: "1999-05-01", code: "N" },
      ])
    );

    expect(result.documents).toBe(2);
    expect(result.upserted).toBe(2);
    expect(result.inserted).toBe(2);
    expect(await held(deptA)).toEqual([`${a} 1999-05-01=D`]);
    expect(await held(deptB)).toEqual([`${b} 1999-05-01=N`]);
  });

  test("a document it creates has no uploader and says where it came from", async () => {
    const nik = `9913${uid().slice(0, 4)}`;
    await addEmployee(nik, deptA);
    await syncRoster(RANGE, from([{ nik, date: "1999-05-02", code: "D" }]));

    const [doc] = await db
      .select({
        source: schema.rosterDocuments.source,
        uploadedBy: schema.rosterDocuments.uploadedBy,
      })
      .from(schema.rosterDocuments)
      .where(eq(schema.rosterDocuments.departmentId, deptA));

    expect(doc?.source).toBe("unggul");
    expect(doc?.uploadedBy).toBeNull();
  });

  test("a changed code amends the day rather than duplicating it", async () => {
    const nik = `9914${uid().slice(0, 4)}`;
    await addEmployee(nik, deptA);
    await syncRoster(RANGE, from([{ nik, date: "1999-05-03", code: "D" }]));

    const second = await syncRoster(
      RANGE,
      from([{ nik, date: "1999-05-03", code: "N" }])
    );

    expect(second.inserted).toBe(0);
    expect(second.upserted).toBe(1);
    expect(await held(deptA)).toEqual([`${nik} 1999-05-03=N`]);
  });

  /*
   * The reason this module reconciles instead of only upserting. A roster is a
   * plan, and a cancelled plan that lingers is an operator standing in the
   * morning's candidate pool for a shift nobody rostered them to.
   */
  test("a day withdrawn upstream is withdrawn here", async () => {
    const nik = `9915${uid().slice(0, 4)}`;
    await addEmployee(nik, deptA);
    await syncRoster(
      RANGE,
      from([
        { nik, date: "1999-05-04", code: "D" },
        { nik, date: "1999-05-05", code: "D" },
      ])
    );

    const second = await syncRoster(
      RANGE,
      from([{ nik, date: "1999-05-04", code: "D" }])
    );

    expect(second.deleted).toBe(1);
    expect(await held(deptA)).toEqual([`${nik} 1999-05-04=D`]);
  });

  test("it withdraws nothing outside the range it pulled", async () => {
    const nik = `9916${uid().slice(0, 4)}`;
    await addEmployee(nik, deptA);
    await syncRoster(RANGE, from([{ nik, date: "1999-05-06", code: "D" }]));

    // A later, narrower pull: May 6th is outside it, so the mirror knows
    // nothing about that day and must leave it alone.
    const narrow = await syncRoster(
      { from: "1999-05-10", to: "1999-05-20" },
      from([{ nik, date: "1999-05-10", code: "N" }])
    );

    expect(narrow.deleted).toBe(0);
    expect(await held(deptA)).toEqual([
      `${nik} 1999-05-06=D`,
      `${nik} 1999-05-10=N`,
    ]);
  });

  test("a NIK this system does not hold is counted, not invented", async () => {
    const result = await syncRoster(
      RANGE,
      from([{ nik: "99999999901", date: "1999-05-07", code: "D" }])
    );

    expect(result.skippedUnknownNik).toBe(1);
    expect(result.documents).toBe(0);
    expect(await held(deptA)).toEqual([]);
  });

  /* Six of these arrived in a real September pull, every one on an operator's
     row. A code nobody classified must be visible, because its symptom — a
     person who is simply never picked — looks like nothing at all. */
  test("a code outside the legend is reported by name", async () => {
    const nik = `9917${uid().slice(0, 4)}`;
    await addEmployee(nik, deptA);

    const result = await syncRoster(
      RANGE,
      from([
        { nik, date: "1999-05-08", code: "DS1" },
        { nik, date: "1999-05-09", code: "DS1" },
        { nik, date: "1999-05-10", code: "D" },
      ])
    );

    expect(result.unknownCodes).toEqual({ DS1: 2 });
    expect(await held(deptA)).toEqual([`${nik} 1999-05-10=D`]);
  });

  test("it takes over a month a spreadsheet held, archiving rather than erasing", async () => {
    const nik = `9918${uid().slice(0, 4)}`;
    const employeeId = await addEmployee(nik, deptA);
    const [uploaded] = await db
      .insert(schema.rosterDocuments)
      .values({
        departmentId: deptA,
        month: "1999-05-01",
        fileName: `${tag}.xlsx`,
        uploadedBy: userId,
      })
      .returning({ id: schema.rosterDocuments.id });
    await db.insert(schema.rosterDays).values({
      documentId: uploaded!.id,
      employeeId,
      date: "1999-05-11",
      code: "OFF",
    });

    await syncRoster(RANGE, from([{ nik, date: "1999-05-11", code: "D" }]));

    const [old] = await db
      .select({ status: schema.rosterDocuments.status })
      .from(schema.rosterDocuments)
      .where(eq(schema.rosterDocuments.id, uploaded!.id));
    expect(old?.status).toBe("arsip");
    // The archived document keeps every row it held — it is still readable.
    const kept = await db
      .select({ code: schema.rosterDays.code })
      .from(schema.rosterDays)
      .where(eq(schema.rosterDays.documentId, uploaded!.id));
    expect(kept.map((k) => k.code)).toEqual(["OFF"]);
    expect(await held(deptA)).toEqual([`${nik} 1999-05-11=D`]);
  });

  /*
   * The rule that keeps a takeover from losing a month. Archiving a
   * spreadsheet the pull only partly covers would leave the uncovered days
   * belonging to no active document — a roster that vanishes from every screen
   * while the sync reports success.
   */
  test("it leaves a spreadsheet month alone when the pull does not cover it", async () => {
    const nik = `9919${uid().slice(0, 4)}`;
    const employeeId = await addEmployee(nik, deptA);
    const [uploaded] = await db
      .insert(schema.rosterDocuments)
      .values({
        departmentId: deptA,
        month: "1999-05-01",
        fileName: `${tag}.xlsx`,
        uploadedBy: userId,
      })
      .returning({ id: schema.rosterDocuments.id });
    await db.insert(schema.rosterDays).values({
      documentId: uploaded!.id,
      employeeId,
      date: "1999-05-20",
      code: "OFF",
    });

    const result = await syncRoster(
      { from: "1999-05-15", to: "1999-05-25" },
      from([{ nik, date: "1999-05-20", code: "D" }])
    );

    expect(result.deferred).toEqual([`${deptA}|1999-05-01`]);
    expect(result.documents).toBe(0);
    const [old] = await db
      .select({ status: schema.rosterDocuments.status })
      .from(schema.rosterDocuments)
      .where(eq(schema.rosterDocuments.id, uploaded!.id));
    expect(old?.status).toBe("aktif");
  });

  test("one pull spanning a month boundary writes one document per month", async () => {
    const nik = `9920${uid().slice(0, 4)}`;
    await addEmployee(nik, deptA);

    const result = await syncRoster(
      { from: "1999-05-01", to: "1999-06-30" },
      from([
        { nik, date: "1999-05-31", code: "D" },
        { nik, date: "1999-06-01", code: "N" },
      ])
    );

    expect(result.documents).toBe(2);
    expect(await held(deptA, "1999-05-01")).toEqual([`${nik} 1999-05-31=D`]);
    expect(await held(deptA, "1999-06-01")).toEqual([`${nik} 1999-06-01=N`]);
  });
});

/*
 * An admin's correction outranks the source (owner, 2026-10-05).
 *
 * The case it exists for: rostered N, called in for the morning, and the
 * source learns of it only at noon — so the 03:00 pull, and any pull before
 * noon, still says N. The correction must survive every one of them.
 */
describe("syncRoster with a correction", () => {
  /* Each test's corrections are its own: one left live would be laid over the
     next test's pull too. */
  beforeEach(async () => {
    if (employees.length)
      await db
        .delete(schema.rosterCorrections)
        .where(inArray(schema.rosterCorrections.employeeId, employees));
  });

  const correct = async (
    employeeId: string,
    date: string,
    toCode: "D" | "N",
    revoked = false
  ) => {
    await db.insert(schema.rosterCorrections).values({
      employeeId,
      date,
      fromCode: toCode === "D" ? "N" : "D",
      toCode,
      reason: `${tag} dipanggil masuk pagi`,
      createdBy: userId,
      ...(revoked ? { revokedAt: new Date(), revokedBy: userId } : {}),
    });
  };

  test("a pull still saying N writes the corrected D", async () => {
    const nik = `9921${uid().slice(0, 4)}`;
    const id = await addEmployee(nik, deptA);
    await syncRoster(RANGE, from([{ nik, date: "1999-05-06", code: "N" }]));
    await correct(id, "1999-05-06", "D");

    await syncRoster(RANGE, from([{ nik, date: "1999-05-06", code: "N" }]));

    expect(await held(deptA)).toEqual([`${nik} 1999-05-06=D`]);
  });

  test("a corrected day the source does not carry is not withdrawn", async () => {
    const nik = `9922${uid().slice(0, 4)}`;
    const id = await addEmployee(nik, deptA);
    await correct(id, "1999-05-07", "D");

    await syncRoster(RANGE, from([{ nik, date: "1999-05-08", code: "N" }]));

    expect(await held(deptA)).toEqual([
      `${nik} 1999-05-07=D`,
      `${nik} 1999-05-08=N`,
    ]);
  });

  test("a withdrawn correction gives the day back to the source", async () => {
    const nik = `9923${uid().slice(0, 4)}`;
    const id = await addEmployee(nik, deptA);
    await correct(id, "1999-05-09", "D", true);

    await syncRoster(RANGE, from([{ nik, date: "1999-05-09", code: "N" }]));

    expect(await held(deptA)).toEqual([`${nik} 1999-05-09=N`]);
  });

  test("a correction outside the window is left alone", async () => {
    const nik = `9924${uid().slice(0, 4)}`;
    const id = await addEmployee(nik, deptA);
    await correct(id, "1999-06-10", "D");

    const result = await syncRoster(
      RANGE,
      from([{ nik, date: "1999-05-10", code: "N" }])
    );

    expect(result.documents).toBe(1);
    expect(await held(deptA, "1999-06-01")).toEqual([]);
  });

  /* The other days of the same pull are the source's, untouched. */
  test("only the corrected person-day differs from the source", async () => {
    const nik = `9925${uid().slice(0, 4)}`;
    const other = `9926${uid().slice(0, 4)}`;
    const id = await addEmployee(nik, deptA);
    await addEmployee(other, deptA);
    await correct(id, "1999-05-11", "D");

    const result = await syncRoster(
      RANGE,
      from([
        { nik, date: "1999-05-11", code: "N" },
        { nik, date: "1999-05-12", code: "N" },
        { nik: other, date: "1999-05-11", code: "N" },
      ])
    );

    expect(result.fetched).toBe(3);
    expect(result.upserted).toBe(3);
    expect(await held(deptA)).toEqual(
      [
        `${nik} 1999-05-11=D`,
        `${nik} 1999-05-12=N`,
        `${other} 1999-05-11=N`,
      ].sort()
    );
  });

  /*
   * A correction for a month the pull does not carry must not make the mirror
   * take that month over: the upload in force would be stood down and the
   * department's month replaced by a single corrected day.
   */
  test("a correction in a month only an upload carries leaves the upload alone", async () => {
    const mirrored = `9927${uid().slice(0, 4)}`;
    const uploaded = `9928${uid().slice(0, 4)}`;
    await addEmployee(mirrored, deptA);
    const uploadedId = await addEmployee(uploaded, deptB);
    const [upload] = await db
      .insert(schema.rosterDocuments)
      .values({
        departmentId: deptB,
        month: "1999-05-01",
        fileName: `${tag}-upload.xlsx`,
        source: "upload",
        uploadedBy: userId,
      })
      .returning({ id: schema.rosterDocuments.id });
    await db.insert(schema.rosterDays).values([
      {
        documentId: upload!.id,
        employeeId: uploadedId,
        date: "1999-05-13",
        code: "D",
      },
      {
        documentId: upload!.id,
        employeeId: uploadedId,
        date: "1999-05-14",
        code: "N",
      },
    ]);
    await correct(uploadedId, "1999-05-14", "D");
    await db
      .update(schema.rosterDays)
      .set({ code: "D" })
      .where(
        and(
          eq(schema.rosterDays.documentId, upload!.id),
          eq(schema.rosterDays.date, "1999-05-14")
        )
      );

    await syncRoster(
      RANGE,
      from([{ nik: mirrored, date: "1999-05-13", code: "D" }])
    );

    const docs = await db
      .select({
        source: schema.rosterDocuments.source,
        status: schema.rosterDocuments.status,
      })
      .from(schema.rosterDocuments)
      .where(eq(schema.rosterDocuments.departmentId, deptB));
    expect(docs).toEqual([{ source: "upload", status: "aktif" }]);
    expect(await held(deptB)).toEqual([
      `${uploaded} 1999-05-13=D`,
      `${uploaded} 1999-05-14=D`,
    ]);
  });

  /*
   * The race the settling exists for: an admin corrects a day while the pull
   * is still writing, after it read the corrections. Simulated by running the
   * pull first and correcting after — the pull wrote the source's N over a day
   * it did not know was corrected — then settling from when it began.
   */
  test("a correction made while the pull ran is put back after it", async () => {
    const nik = `9929${uid().slice(0, 4)}`;
    const id = await addEmployee(nik, deptA);
    const rows = [{ nik, date: "1999-05-15", code: "N" }];
    const started = new Date();
    await syncRoster(RANGE, from(rows));
    await correct(id, "1999-05-15", "D");
    expect(await held(deptA)).toEqual([`${nik} 1999-05-15=N`]);

    const wanted = new Map([
      [
        `${deptA}|1999-05-01`,
        new Map([[`${id} 1999-05-15`, { code: "N" as const }]]),
      ],
    ]);
    await settleCorrectionsMadeDuring(started, RANGE, wanted, [], new Map());

    expect(await held(deptA)).toEqual([`${nik} 1999-05-15=D`]);
  });

  test("a correction withdrawn while the pull ran gives the day back to the source", async () => {
    const nik = `9930${uid().slice(0, 4)}`;
    const id = await addEmployee(nik, deptA);
    await correct(id, "1999-05-16", "D");
    const started = new Date();
    /* The pull laid the live correction over the source's N and wrote D. */
    await syncRoster(RANGE, from([{ nik, date: "1999-05-16", code: "N" }]));
    expect(await held(deptA)).toEqual([`${nik} 1999-05-16=D`]);
    /* Withdrawn mid-run: the route put N back, the pull's D landed after. */
    await db
      .update(schema.rosterCorrections)
      .set({ revokedAt: new Date(), revokedBy: userId })
      .where(eq(schema.rosterCorrections.employeeId, id));

    const cell = `${id} 1999-05-16`;
    await settleCorrectionsMadeDuring(
      started,
      RANGE,
      new Map([
        [`${deptA}|1999-05-01`, new Map([[cell, { code: "D" as const }]])],
      ]),
      [],
      new Map([[cell, "N" as const]])
    );

    expect(await held(deptA)).toEqual([`${nik} 1999-05-16=N`]);
  });
});
