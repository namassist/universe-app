/**
 * The dashboard's two gates.
 *
 * What is worth pinning is not the arithmetic — every count here is a `count(*)`
 * somebody can read — but that a section the caller has no grant for never
 * reaches the wire, and that a `self` account's figures are about themselves.
 * Both are the kind of rule that fails silently: the screen would simply not
 * render a card it was sent, and nobody would know it had arrived.
 *
 *   bun --env-file=.env test src/routes/dashboard.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { and, asc, eq, inArray, not, notInArray, sql } from "drizzle-orm";
import type { MenuSlug, Scope } from "@universe/contracts";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { deskShift } from "../current-shift";
import { ftwObliged, ftwObligedWhere } from "../ftw-obliged";
import { dashboardRoutes } from "./dashboard";

const app = new Elysia().use(dashboardRoutes);
const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Dash ${uid()}`;

const made = {
  users: [] as string[],
  roles: [] as string[],
  rosterDocs: [] as string[],
  ftwNiks: [] as string[],
  boards: [] as string[],
};

/**
 * The shift the dashboard is counting as this suite runs, and its roster code.
 *
 * Read from the same helper the route reads, never written out as `"D"`. The
 * fixtures used to file everybody on `D`, which made the whole file pass in
 * the morning and report zeros after lunch — a suite that is only true before
 * noon is worse than no suite, because it is green when nobody is looking.
 */
const NOW = deskShift(new Date());
/** Employee ids this file has already given a roster row; see below. */
const rostered = new Set<string>();
const CODE = NOW.shift === "night" ? ("N" as const) : ("D" as const);
const OTHER = NOW.shift === "night" ? ("D" as const) : ("N" as const);

/**
 * Employees this file may hand an account, with a roster row for this shift.
 *
 * Both halves matter and neither can be borrowed from the site. `users.nik` is
 * unique, so an employee the seed already gave an account to cannot be given a
 * second one — and the figures these tests compare count *this shift's*
 * roster, which a freshly seeded database has none of. Reading whatever the
 * site happened to hold is why these two passed on a database with a roster
 * loaded and failed on a clean one.
 */
async function rosteredWithoutAccount(
  count: number,
  code: "D" | "N" = CODE,
  /* `false` asks for somebody the FTW rule does not oblige — a payroll clerk
     rather than an operator. The seeded master holds both; picking by the rule
     rather than by a hardcoded NIK keeps the fixture honest if the seed moves
     underneath it. The default is `true` because most of this file compares
     FTW figures, and those now count only the obliged. */
  obliged = true
) {
  const rows = await db
    .select({ id: schema.employees.id, nik: schema.employees.nik })
    .from(schema.employees)
    .where(
      and(
        eq(schema.employees.status, "aktif"),
        obliged ? ftwObligedWhere : not(ftwObligedWhere),
        sql`not exists (select 1 from users u where u.nik = ${schema.employees.nik})`,
        /* Nobody this file has already rostered. Without it the helper hands
           out the same first employees every call, and the second call files
           them a second row for the same date — which is exactly the double
           count `rosterDayInForce` exists to prevent, arriving from the
           fixtures instead of from the data. */
        rostered.size
          ? notInArray(schema.employees.id, [...rostered])
          : undefined
      )
    )
    .orderBy(asc(schema.employees.nik))
    .limit(count);
  if (rows.length < count)
    throw new Error("fixture: not enough employees without an account");
  for (const row of rows) rostered.add(row.id);
  await ensureRosterDoc();

  await db.insert(schema.rosterDays).values(
    rows.map((r) => ({
      documentId: rosterDocId!,
      employeeId: r.id,
      date: NOW.date,
      code,
    }))
  );
  return rows;
}

/**
 * One document for the whole file.
 *
 * `roster_documents` is unique on (department, month) while active, so a helper
 * that filed its own each time collided with itself the second time it ran.
 */
let rosterDocId: string | null = null;
async function ensureRosterDoc(): Promise<void> {
  if (rosterDocId) return;
  const [department] = await db
    .select({ id: schema.departments.id })
    .from(schema.departments)
    .limit(1);
  const [doc] = await db
    .insert(schema.rosterDocuments)
    .values({
      departmentId: department!.id,
      month: `${NOW.date.slice(0, 7)}-01`,
      fileName: `${tag}.xlsx`,
      uploadedBy: made.users[0]!,
    })
    .returning({ id: schema.rosterDocuments.id });
  rosterDocId = doc!.id;
  made.rosterDocs.push(doc!.id);
}

/** An account with exactly these grants and this scope, and nothing else. */
async function account(
  scope: Scope,
  grants: MenuSlug[],
  nik?: string
): Promise<string> {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-dash-${uid()}`, name: tag, scope })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db.insert(schema.rolePermissions).values(
    grants.map((menuSlug) => ({
      roleId: role!.id,
      menuSlug,
      mode: "view" as const,
    }))
  );
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-${uid()}@uji.local`,
      name: tag,
      passwordHash: "x",
      roleId: role!.id,
      ...(nik ? { nik } : {}),
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(user!.id);
  const session = await createSession("user", user!.id, "cookie");
  return `${SESSION_COOKIE}=${session.id}`;
}

const read = async (cookie: string) => {
  const response = await app.handle(
    new Request("http://localhost/dashboard", { headers: { cookie } })
  );
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
};

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();
});

afterAll(async () => {
  if (made.boards.length)
    await db
      .delete(schema.fleetActualDocuments)
      .where(inArray(schema.fleetActualDocuments.id, made.boards));
  // Readings key on NIK alone, so they belong to nobody's cascade and have to
  // be swept by hand — before the roster, which is what selected them.
  if (made.ftwNiks.length)
    await db
      .delete(schema.ftwReadings)
      .where(
        and(
          inArray(schema.ftwReadings.nik, made.ftwNiks),
          eq(schema.ftwReadings.date, NOW.date)
        )
      );
  // Roster days cascade with their document; the document references the
  // uploader, so it goes before the accounts.
  if (made.rosterDocs.length)
    await db
      .delete(schema.rosterDocuments)
      .where(inArray(schema.rosterDocuments.id, made.rosterDocs));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
});

describe("what a grant lets through", () => {
  test("a section the caller cannot see is absent, not zero", async () => {
    /* The distinction the whole payload rests on: null means "no grant", and a
       number means the number. Sending zeros for withheld sections would be
       indistinguishable from a quiet day — and would have sent the data. */
    const body = await read(await account("all", ["dashboard"]));
    for (const section of ["attendance", "ftw", "units", "allocation"])
      expect(body[section]).toBeNull();
  });

  test("a grant opens exactly its own section", async () => {
    const body = await read(await account("all", ["dashboard", "unit-status"]));
    expect(body.units).not.toBeNull();
    // …and nothing else came with it.
    expect(body.attendance).toBeNull();
    expect(body.ftw).toBeNull();
    expect(body.allocation).toBeNull();
  });

  test("the charts need all three of the grants they are made of", async () => {
    /* A bar labelled "tidak lolos FTW" is a fit-to-work figure whatever panel
       it is drawn on, so `fleet-allocation` alone must not open them — that
       would hand FTW numbers to somebody the FTW section is withheld from,
       which is the distinction this whole endpoint rests on. */
    for (const grants of [
      ["fleet-allocation"],
      ["fleet-allocation", "attendance"],
      ["attendance", "fit-to-work"],
    ] as const) {
      const body = await read(await account("all", ["dashboard", ...grants]));
      expect(body.analytics).toBeNull();
    }
    const all = await read(
      await account("all", [
        "dashboard",
        "fleet-allocation",
        "attendance",
        "fit-to-work",
      ])
    );
    expect(all.analytics).not.toBeNull();
  });

  test("the charts share one categorisation and one shift", async () => {
    /* The spare tile and the rest tile are subsets of the ratio chart, so a
       category on either must be one the ratio chart also knows. Two
       categorisations is how a bar and a tile reading "DOZER" come to be
       about different dozers. */
    const body = await read(
      await account("all", [
        "dashboard",
        "fleet-allocation",
        "attendance",
        "fit-to-work",
      ])
    );
    const a = body.analytics as {
      operators: {
        category: string;
        ready: number;
        noFinger: number;
        noFtw: number;
      }[];
      spares: { category: string; operators: number }[];
      resting: { category: string; operators: number }[];
    };
    const known = new Set(a.operators.map((r) => r.category));
    for (const row of [...a.spares, ...a.resting])
      expect(known.has(row.category)).toBe(true);

    // …and a spare is never more numerous than its own category's operators.
    for (const spare of a.spares) {
      const all = a.operators.find((r) => r.category === spare.category)!;
      expect(spare.operators).toBeLessThanOrEqual(
        all.ready + all.noFinger + all.noFtw
      );
    }
  });
});

describe("how far scope reaches", () => {
  test("a self account counts only itself", async () => {
    /* The reason this endpoint applies scope at all: without it an operator's
       dashboard would report the whole site's attendance — a number that is
       both useless to them and none of their business. */
    const [employee] = await rosteredWithoutAccount(1);
    const body = await read(
      await account("self", ["dashboard", "attendance"], employee!.nik)
    );
    const attendance = body.attendance as { scheduled: number };
    expect(attendance.scheduled).toBe(1);
  });

  test("an account with no NIK reports on nobody, rather than everybody", async () => {
    // Fails closed: `scopeWhere` yields an empty set for a `self` caller it
    // cannot identify, so the figures are 0 — never the unfiltered site.
    const body = await read(await account("self", ["dashboard", "attendance"]));
    expect((body.attendance as { scheduled: number }).scheduled).toBe(0);
    expect(body.me).toBeNull();
  });

  test("an all-scope account sees more than a self one", async () => {
    // Two of its own, rostered today: one for the `self` account to be, and a
    // second so the site-wide figure has something more to count.
    const employees = await rosteredWithoutAccount(2);
    const wide = await read(await account("all", ["dashboard", "attendance"]));
    const narrow = await read(
      await account("self", ["dashboard", "attendance"], employees[1]!.nik)
    );
    expect(
      (wide.attendance as { scheduled: number }).scheduled
    ).toBeGreaterThan((narrow.attendance as { scheduled: number }).scheduled);
  });
});

describe("which shift the numbers are about", () => {
  test("the payload names the shift, and the clock picks it", async () => {
    /* Sent rather than left for the browser to work out. The screen labels
       every card with this, and a laptop an hour out would print the wrong
       label over the right numbers — the one failure nobody would question. */
    const body = await read(await account("all", ["dashboard", "attendance"]));
    expect(body.shift).toBe(NOW.shift);
    expect(body.shift).toBe(new Date().getHours() < 12 ? "day" : "night");
    expect(body.date).toBe(NOW.date);
  });

  test("the other shift's roster is not counted", async () => {
    /* The bug this rule closes. Both codes used to land in one denominator,
       so at 07:00 the whole night roster was reported as not clocked in and
       not filed — 324 people on 2026-09-18, hours before their shift began.
       One person on each code, and only ours may move the figure. */
    const before = await read(
      await account("all", ["dashboard", "attendance"])
    );
    await rosteredWithoutAccount(1, OTHER);
    const after = await read(await account("all", ["dashboard", "attendance"]));
    expect((after.attendance as { scheduled: number }).scheduled).toBe(
      (before.attendance as { scheduled: number }).scheduled
    );

    await rosteredWithoutAccount(1, CODE);
    const mine = await read(await account("all", ["dashboard", "attendance"]));
    expect((mine.attendance as { scheduled: number }).scheduled).toBe(
      (before.attendance as { scheduled: number }).scheduled + 1
    );
  });

  test("the ratio chart counts this shift's operators and not the other's", async () => {
    /* What the absentee test used to prove on the attention panel, now that
       the charts have replaced it: a person whose shift has not started is
       nobody's shortfall. */
    const total = (b: Record<string, unknown>) =>
      (
        b.analytics as {
          operators: { ready: number; noFinger: number; noFtw: number }[];
        }
      ).operators.reduce((n, r) => n + r.ready + r.noFinger + r.noFtw, 0);
    const grants = [
      "dashboard",
      "fleet-allocation",
      "attendance",
      "fit-to-work",
    ] as const;

    const before = await read(await account("all", [...grants]));
    await rosteredWithoutAccount(1, OTHER);
    expect(total(await read(await account("all", [...grants])))).toBe(
      total(before)
    );
    await rosteredWithoutAccount(1, CODE);
    expect(total(await read(await account("all", [...grants])))).toBe(
      total(before) + 1
    );
  });
});

describe("what counts as a filing that passed", () => {
  /** A reading for this person today, in savera's own words. */
  const file = async (nik: string, decision: string, category: string) => {
    made.ftwNiks.push(nik);
    await db.insert(schema.ftwReadings).values({
      nik,
      name: tag,
      date: NOW.date,
      ftwDecision: decision,
      sleepCategory: category,
    });
  };

  /**
   * The section, plus the figure the payload no longer carries.
   *
   * The "Fit" card was taken off the grid (owner, 2026-09-18) and `fit` went
   * with it, but "did this filing count as a pass" is still the question
   * these tests ask — so it is derived the way the section defines it:
   * everybody who owed one, less those who failed and those who sent none.
   */
  const ftwOf = async () => {
    const body = await read(await account("all", ["dashboard", "fit-to-work"]));
    const ftw = body.ftw as {
      scheduled: number;
      followUp: number;
      missing: number;
    };
    return { ...ftw, passed: ftw.scheduled - ftw.followUp - ftw.missing };
  };

  test('"FTW aman" is not enough on its own', async () => {
    /* The bug this closes. savera sends two independent verdicts and a filing
       has to clear both; reading the decision alone reported 2 people worth
       looking at on 2026-09-18 where the Fit To Work menu showed 7, because
       six "FTW aman" rows carried a category that stops the person working. */
    const [person] = await rosteredWithoutAccount(1);
    const before = await ftwOf();
    await file(person!.nik, "FTW aman", "Tidak Boleh Bekerja");
    const after = await ftwOf();

    expect(after.passed).toBe(before.passed);
    expect(after.followUp).toBe(before.followUp + 1);
    expect(after.missing).toBe(before.missing - 1);
  });

  test("a failing decision counts even when the category is clear", async () => {
    // The other half, and the one the Fit To Work menu's colours miss: its
    // rows are tinted by category, so this person reads green there.
    const [person] = await rosteredWithoutAccount(1);
    const before = await ftwOf();
    await file(person!.nik, "FTW Perlu Tindak Lanjut", "Dapat Bekerja");
    const after = await ftwOf();

    expect(after.passed).toBe(before.passed);
    expect(after.followUp).toBe(before.followUp + 1);
  });

  test("both verdicts clear, and only then does it pass", async () => {
    const [person] = await rosteredWithoutAccount(1);
    const before = await ftwOf();
    await file(person!.nik, "FTW aman", "Dapat Bekerja");
    const after = await ftwOf();

    expect(after.passed).toBe(before.passed + 1);
    expect(after.followUp).toBe(before.followUp);
  });
});

describe("who the FTW figures are about", () => {
  test("the denominator is who owes a filing, not who is on shift", async () => {
    /* An excavator operator files; a payroll clerk on the same roster never
       does. Counting the clerk put 84 on the "belum lapor" card on 2026-09-18
       where 10 was the answer — 74 people who had failed at nothing. The wall
       has always narrowed this way; the dashboard now narrows with it. */
    await rosteredWithoutAccount(1, CODE, false);
    const body = await read(
      await account("all", ["dashboard", "attendance", "fit-to-work"])
    );
    const onShift = await db
      .select({ nik: schema.employees.nik })
      .from(schema.employees)
      .innerJoin(
        schema.rosterDays,
        eq(schema.rosterDays.employeeId, schema.employees.id)
      )
      .where(
        and(
          eq(schema.employees.status, "aktif"),
          eq(schema.rosterDays.date, NOW.date),
          eq(schema.rosterDays.code, CODE),
          sql`exists (select 1 from roster_documents d
                      where d.id = ${schema.rosterDays.documentId}
                        and d.status = 'aktif')`
        )
      );
    const obliged = await ftwObliged(onShift.map((r) => r.nik));

    /* Assert the narrowing is real before asserting the figure matches it:
       if the two sets happened to be equal the comparison below would pass
       against the old, unnarrowed query and prove nothing. */
    expect(obliged.size).toBeLessThan(onShift.length);
    expect((body.ftw as { scheduled: number }).scheduled).toBe(obliged.size);
    // …and that really is a narrowing, not the same set under another name.
    expect((body.attendance as { scheduled: number }).scheduled).toBe(
      onShift.length
    );
  });

  test("somebody the rule never asks is not counted as having filed nothing", async () => {
    const ftwOf = (b: Record<string, unknown>) =>
      b.ftw as { scheduled: number; missing: number };
    const before = await read(
      await account("all", ["dashboard", "fit-to-work"])
    );
    await rosteredWithoutAccount(1, CODE, false);
    const after = await read(
      await account("all", ["dashboard", "fit-to-work"])
    );

    expect(ftwOf(after).scheduled).toBe(ftwOf(before).scheduled);
    expect(ftwOf(after).missing).toBe(ftwOf(before).missing);
  });

  test("attendance still counts the whole shift", async () => {
    /* The narrowing is the FTW section's alone. Everybody rostered is expected
       at the gate, clerk or operator, so a tap card that borrowed the FTW
       denominator would stop counting most of the site. */
    const scheduled = (b: Record<string, unknown>) =>
      (b.attendance as { scheduled: number }).scheduled;
    const before = await read(
      await account("all", ["dashboard", "attendance"])
    );
    await rosteredWithoutAccount(1, CODE, false);
    const after = await read(await account("all", ["dashboard", "attendance"]));
    expect(scheduled(after)).toBe(scheduled(before) + 1);
  });
});

describe("the board line the ACTUAL card reads", () => {
  test("generatedAt is an instant the screen can turn into a clock", async () => {
    /* The card prints this as a clock on the wall at site, so the string has
       to be something `new Date()` reads without guessing. It used to be a
       `::text` cast of a `timestamptz` — "2026-09-18 07:04:43.9+00", whose
       space separator and bare `+00` offset no browser is obliged to parse.
       A card that silently renders "—" all morning is the failure this
       forecloses; `toISOString` is what the screen's helper expects. */
    const [board] = await db
      .insert(schema.fleetActualDocuments)
      .values({ date: NOW.date, shift: NOW.shift })
      .returning({ id: schema.fleetActualDocuments.id });
    made.boards.push(board!.id);

    const body = await read(
      await account("all", ["dashboard", "fleet-allocation"])
    );
    const line = (
      body.allocation as { shift: string; generatedAt: string }[]
    ).find((b) => b.shift === body.shift);

    expect(line).toBeDefined();
    expect(line!.generatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
    expect(Number.isNaN(Date.parse(line!.generatedAt))).toBe(false);
  });
});

describe("the ratio chart adds up", () => {
  test("every operator is counted once, in exactly one bucket", async () => {
    /* The subtle failure this forecloses. A spare is categorised by the best
       unit their licences reach, and over half of them are licensed across
       two or three categories — a join written one `limit 1` short would put
       the same person on three bars, and the chart would be a proportion of
       a population that does not exist. The buckets are exclusive for the
       same reason: somebody who never tapped has not also failed a
       fit-to-work, and counting them twice makes a bar sum past its own
       total.

       Checked against the attendance denominator rather than a fixture, so
       it holds on any master — the seed's is not production's. Attendance
       counts everybody rostered; this counts the operators among them, so it
       can be smaller, never larger, and never double. */
    const body = await read(
      await account("all", [
        "dashboard",
        "fleet-allocation",
        "attendance",
        "fit-to-work",
      ])
    );
    const rows = (
      body.analytics as {
        operators: {
          category: string;
          ready: number;
          noFinger: number;
          noFtw: number;
        }[];
      }
    ).operators;

    expect(new Set(rows.map((r) => r.category)).size).toBe(rows.length);
    const counted = rows.reduce(
      (n, r) => n + r.ready + r.noFinger + r.noFtw,
      0
    );
    const rostered = (body.attendance as { scheduled: number }).scheduled;
    expect(counted).toBeGreaterThan(0);
    expect(counted).toBeLessThanOrEqual(rostered);
  });
});
