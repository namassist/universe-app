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
import { runIngestWindow, syncFingerReadings, syncFtwReadings } from "./ingest";
import type { FtwFetcher, FtwSourceRow } from "./sources/savera";
import type { SleepRule } from "./ftw-rules";
import type { FingerSourceRow } from "./sources/nakula";

/** Dates no real source will ever emit again — safe to own and wipe. */
const D1 = "1999-01-01";
const D2 = "1999-01-02";
const TEST_DATES = [D1, D2];

/*
 * The people the FTW rows describe, in the register.
 *
 * The FTW pull keeps only NIKs the register knows (2026-09-17), so every NIK a
 * test expects to land has to exist first. Its own company, department and
 * position, so nothing here leans on the seeded master.
 */
const KNOWN_NIKS = ["50121018", "50121099"];
const tag = `ZZ Uji Ingest ${crypto.randomUUID().slice(0, 8)}`;
const made = {
  employees: [] as string[],
  chain: [] as (() => Promise<unknown>)[],
};

beforeAll(async () => {
  const [company] = await db
    .insert(schema.companies)
    .values({ name: tag, code: `ZZ${crypto.randomUUID().slice(0, 6)}` })
    .returning({ id: schema.companies.id });
  const [dept] = await db
    .insert(schema.departments)
    .values({ name: tag, companyId: company!.id })
    .returning({ id: schema.departments.id });
  const [position] = await db
    .insert(schema.positions)
    .values({ name: tag, departmentId: dept!.id })
    .returning({ id: schema.positions.id });
  const people = await db
    .insert(schema.employees)
    .values(
      KNOWN_NIKS.map((nik) => ({
        nik,
        name: `${tag} ${nik}`,
        companyId: company!.id,
        departmentId: dept!.id,
        positionId: position!.id,
      }))
    )
    .returning({ id: schema.employees.id });
  made.employees = people.map((p) => p.id);
  made.chain = [
    () =>
      db.delete(schema.positions).where(eq(schema.positions.id, position!.id)),
    () =>
      db.delete(schema.departments).where(eq(schema.departments.id, dept!.id)),
    () =>
      db.delete(schema.companies).where(eq(schema.companies.id, company!.id)),
  ];
});

afterAll(async () => {
  if (made.employees.length)
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, made.employees));
  for (const drop of made.chain) await drop();
});

async function wipe() {
  await db
    .delete(schema.ftwReadings)
    .where(inArray(schema.ftwReadings.date, TEST_DATES));
  await db
    .delete(schema.fingerReadings)
    .where(inArray(schema.fingerReadings.date, TEST_DATES));
}

beforeEach(wipe);
afterAll(wipe);

const ftwRow = (over: Partial<FtwSourceRow> = {}): FtwSourceRow => ({
  nik: "050121018",
  name: "SOWAN SAPUTRA",
  company: "PT UNGGUL DINAMIKA UTAMA",
  department: "MINING OPERATION",
  position: "FOREMAN COAL",
  mess: "MESS 31",
  shift: "Shift 1",
  sleep_minutes: 426,
  sleep_category: "Dapat Bekerja",
  ftw_decision: "FTW aman",
  sent_at: `${D1} 04:12:00`,
  date: D1,
  ...over,
});

const fingerRow = (over: Partial<FingerSourceRow> = {}): FingerSourceRow => ({
  nik: "050121018",
  date: D1,
  first_in_at: `${D1} 05:15:51`,
  first_in_ip: "192.168.179.235",
  first_in_pm_at: null,
  first_in_pm_ip: null,
  first_out_at: null,
  first_out_ip: null,
  ...over,
});

/** savera's active default sleep rules, 2026-09-21 — see `ftw-rules.test.ts`. */
const rule = (over: Partial<SleepRule>): SleepRule => ({
  code: "X",
  metricKey: "effective_sleep_minutes",
  minMinutes: null,
  minInclusive: true,
  maxMinutes: null,
  maxInclusive: false,
  decisionLabel: "X",
  priority: 99,
  shiftId: null,
  sleepType: "all",
  effectiveFrom: null,
  effectiveTo: null,
  ...over,
});
const SAVERA_RULES: SleepRule[] = [
  rule({ maxMinutes: 270, decisionLabel: "Tidak Boleh Bekerja", priority: 1 }),
  rule({
    minMinutes: 270,
    maxMinutes: 300,
    decisionLabel: "Istirahat Minimal 2 Jam",
    priority: 2,
  }),
  rule({
    minMinutes: 300,
    maxMinutes: 330,
    decisionLabel: "Istirahat Minimal 1 Jam",
    priority: 3,
  }),
  rule({ minMinutes: 330, decisionLabel: "Dapat Bekerja", priority: 4 }),
];

/** One FTW pass over the test dates, with savera's rules readable. */
const syncFtw = (fetch: FtwFetcher) =>
  syncFtwReadings(TEST_DATES, fetch, async () => SAVERA_RULES);

describe("syncFtwReadings", () => {
  test("snapshots a source row with the NIK normalized", async () => {
    const result = await syncFtw(async () => [ftwRow()]);

    expect(result).toEqual({
      fetched: 1,
      upserted: 1,
      inserted: 1,
      skipped: 0,
    });
    const rows = await db
      .select()
      .from(schema.ftwReadings)
      .where(eq(schema.ftwReadings.date, D1));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nik).toBe("50121018"); // leading zero stripped
    expect(rows[0]!.sleepMinutes).toBe(426);
    expect(rows[0]!.sleepCategory).toBe("Dapat Bekerja");
    expect(rows[0]!.sentAt).toBe(`${D1} 04:12:00`);
  });

  test("re-syncing the same rows amends in place, never duplicates", async () => {
    await syncFtw(async () => [ftwRow()]);
    const [before] = await db
      .select()
      .from(schema.ftwReadings)
      .where(eq(schema.ftwReadings.date, D1));

    // The operator re-uploads inside the window; the verdict changes.
    await syncFtw(async () => [
      ftwRow({ sleep_minutes: 240, sleep_category: "Tidak Boleh Bekerja" }),
    ]);

    const rows = await db
      .select()
      .from(schema.ftwReadings)
      .where(eq(schema.ftwReadings.date, D1));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(before!.id); // same row, amended
    expect(rows[0]!.sleepMinutes).toBe(240);
    expect(rows[0]!.sleepCategory).toBe("Tidak Boleh Bekerja");
  });

  test("a row with no usable NIK is skipped and counted, not dropped silently", async () => {
    const result = await syncFtw(async () => [
      ftwRow(),
      ftwRow({ nik: null }),
      ftwRow({ nik: "N/A" }),
    ]);
    expect(result).toEqual({
      fetched: 3,
      upserted: 1,
      inserted: 1,
      skipped: 2,
    });
  });

  /* savera reports FTW for every driver on site; a quarter of a morning's
     rows belong to nobody in the register (2026-09-16: 187 of 714). They are
     read by no screen that matters and were listed raw by Monitoring FTW. */
  test("a NIK the employee register does not know is skipped and counted", async () => {
    const result = await syncFtw(async () => [
      ftwRow(),
      ftwRow({ nik: "50821361", name: "IDRUS YUNUS" }),
    ]);
    expect(result).toEqual({
      fetched: 2,
      upserted: 1,
      inserted: 1,
      skipped: 1,
    });
    const rows = await db
      .select({ nik: schema.ftwReadings.nik })
      .from(schema.ftwReadings)
      .where(eq(schema.ftwReadings.date, D1));
    expect(rows.map((r) => r.nik)).toEqual(["50121018"]);
  });

  test("two raw NIKs that normalize to the same key collapse to one row, not an error", async () => {
    // "050121018" and "50121018" are the same person seen through two source
    // formattings; landing both in one statement must not blow the pass up
    // with ON CONFLICT's cannot-affect-row-twice.
    const result = await syncFtw(async () => [
      /* Told apart by minutes: the category is worked out from them now,
         so two rows differing only in savera's label would compute alike
         and the test could not see which one won. */
      ftwRow({ nik: "050121018", sleep_minutes: 426 }),
      ftwRow({ nik: "50121018", sleep_minutes: 240 }),
    ]);
    expect(result).toEqual({
      fetched: 2,
      upserted: 1,
      inserted: 1,
      skipped: 1,
    });

    const rows = await db
      .select()
      .from(schema.ftwReadings)
      .where(eq(schema.ftwReadings.date, D1));
    expect(rows).toHaveLength(1);
    // Last one wins — the later row is the later-fetched fact.
    expect(rows[0]!.sleepCategory).toBe("Tidak Boleh Bekerja");
  });

  test("counts a re-pull as amended, not as new", async () => {
    // The number a person pressing Sync is reading. Every pass upserts the
    // whole window, so without this a sync that found thirty late uploads
    // looks exactly like one that found nothing.
    const first = await syncFtw(async () => [ftwRow()]);
    expect(first.inserted).toBe(1);

    const again = await syncFtw(async () => [ftwRow()]);
    expect(again.upserted).toBe(1);
    expect(again.inserted).toBe(0);

    const withNew = await syncFtw(async () => [
      ftwRow(),
      ftwRow({ nik: "50121099" }),
    ]);
    expect(withNew.upserted).toBe(2);
    expect(withNew.inserted).toBe(1);
  });

  test("the same person on two dates is two snapshot rows", async () => {
    await syncFtw(async () => [
      ftwRow(),
      ftwRow({ date: D2, sent_at: `${D2} 04:30:00` }),
    ]);
    const rows = await db
      .select()
      .from(schema.ftwReadings)
      .where(inArray(schema.ftwReadings.date, TEST_DATES));
    expect(rows).toHaveLength(2);
  });

  /* The morning this was written (2026-09-21): 8h30 of sleep, and savera's own
     row still said "Tidak Boleh Bekerja" at our last pass before the board.
     savera corrected itself 82 seconds later; the board had used the stale
     word, and five operators lost a unit. */
  test("the category comes from savera's rules, not from savera's lagging row", async () => {
    await syncFtw(async () => [
      ftwRow({ sleep_minutes: 510, sleep_category: "Tidak Boleh Bekerja" }),
    ]);
    const [row] = await db
      .select()
      .from(schema.ftwReadings)
      .where(eq(schema.ftwReadings.date, D1));
    expect(row!.sleepCategory).toBe("Dapat Bekerja");
    // savera's word is kept beside ours, not overwritten.
    expect(row!.saveraCategory).toBe("Tidak Boleh Bekerja");
  });

  test("the rules' own edges decide, as savera's table draws them", async () => {
    await syncFtw(async () => [ftwRow({ sleep_minutes: 329 })]);
    const [row] = await db
      .select()
      .from(schema.ftwReadings)
      .where(eq(schema.ftwReadings.date, D1));
    expect(row!.sleepCategory).toBe("Istirahat Minimal 1 Jam");
  });

  /* Nothing here may be worse than before this change: with the rules out of
     reach the pass keeps savera's own category, exactly as it used to. */
  test("rules that cannot be read fall back to savera's category", async () => {
    await syncFtwReadings(
      TEST_DATES,
      async () => [
        ftwRow({ sleep_minutes: 510, sleep_category: "Tidak Boleh Bekerja" }),
      ],
      async () => {
        throw new Error("savera unreachable");
      }
    );
    const [row] = await db
      .select()
      .from(schema.ftwReadings)
      .where(eq(schema.ftwReadings.date, D1));
    expect(row!.sleepCategory).toBe("Tidak Boleh Bekerja");
    expect(row!.saveraCategory).toBe("Tidak Boleh Bekerja");
  });

  /* The review's catch (2026-09-21): a gap in the rules used to leave the
     category empty, and every screen reads an empty category as "never
     uploaded" — for somebody who plainly did. savera's own word is the
     honest answer when ours has none. */
  test("minutes no rule covers keep savera's category, never an empty one", async () => {
    await syncFtwReadings(
      TEST_DATES,
      async () => [
        ftwRow({ sleep_minutes: 500, sleep_category: "Dapat Bekerja" }),
      ],
      async () => [
        rule({
          minMinutes: 0,
          maxMinutes: 100,
          decisionLabel: "Tidak Boleh Bekerja",
          priority: 1,
        }),
      ]
    );
    const [row] = await db
      .select()
      .from(schema.ftwReadings)
      .where(eq(schema.ftwReadings.date, D1));
    expect(row!.sleepCategory).toBe("Dapat Bekerja");
  });

  test("rules the engine cannot honour fall back to savera's category too", async () => {
    await syncFtwReadings(
      TEST_DATES,
      async () => [
        ftwRow({ sleep_minutes: 510, sleep_category: "Tidak Boleh Bekerja" }),
      ],
      async () => [...SAVERA_RULES, rule({ shiftId: 3, minMinutes: 0 })]
    );
    const [row] = await db
      .select()
      .from(schema.ftwReadings)
      .where(eq(schema.ftwReadings.date, D1));
    expect(row!.sleepCategory).toBe("Tidak Boleh Bekerja");
  });
});

describe("syncFingerReadings", () => {
  test("snapshots first-in with device, out still open", async () => {
    const result = await syncFingerReadings(TEST_DATES, async () => [
      fingerRow(),
    ]);
    expect(result).toEqual({
      fetched: 1,
      upserted: 1,
      inserted: 1,
      skipped: 0,
    });

    const rows = await db
      .select()
      .from(schema.fingerReadings)
      .where(eq(schema.fingerReadings.date, D1));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nik).toBe("50121018");
    expect(rows[0]!.firstInAt).toBe(`${D1} 05:15:51`);
    expect(rows[0]!.firstOutAt).toBeNull();
  });

  test("a late first-out amends the existing row", async () => {
    await syncFingerReadings(TEST_DATES, async () => [fingerRow()]);
    const [before] = await db
      .select()
      .from(schema.fingerReadings)
      .where(
        and(
          eq(schema.fingerReadings.nik, "50121018"),
          eq(schema.fingerReadings.date, D1)
        )
      );

    await syncFingerReadings(TEST_DATES, async () => [
      fingerRow({
        first_out_at: `${D1} 18:20:13`,
        first_out_ip: "192.168.179.201",
      }),
    ]);

    const rows = await db
      .select()
      .from(schema.fingerReadings)
      .where(eq(schema.fingerReadings.date, D1));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(before!.id);
    expect(rows[0]!.firstInAt).toBe(`${D1} 05:15:51`);
    expect(rows[0]!.firstOutAt).toBe(`${D1} 18:20:13`);
    expect(rows[0]!.firstOutIp).toBe("192.168.179.201");
  });
});

describe("runIngestWindow", () => {
  test("keeps pulling until the window closes, idempotently", async () => {
    let calls = 0;
    // Window ≫ delay ≫ a pass's own duration, so a slow moment under full-
    // suite load cannot close the window after a single pass.
    const result = await runIngestWindow("finger", {
      dates: TEST_DATES,
      windowMs: 400,
      passDelayMs: 25,
      fingerFetch: async () => {
        calls += 1;
        return [fingerRow()];
      },
    });

    expect(calls).toBeGreaterThanOrEqual(2); // fired, then re-pulled
    expect(result.passes).toBe(calls);
    const rows = await db
      .select()
      .from(schema.fingerReadings)
      .where(eq(schema.fingerReadings.date, D1));
    expect(rows).toHaveLength(1); // every pass amended the same row
  });

  test("closes at the time it was given, not after a fixed span", async () => {
    let calls = 0;
    const result = await runIngestWindow("finger", {
      dates: TEST_DATES,
      // No `windowMs` at all: the deadline is the only thing ending this.
      endsAt: new Date(Date.now() + 400),
      passDelayMs: 25,
      fingerFetch: async () => {
        calls += 1;
        return [fingerRow()];
      },
    });

    expect(calls).toBeGreaterThanOrEqual(2);
    expect(result.passes).toBe(calls);
  });

  /*
   * A stage that fires after its own deadline — the scheduler ticks by the
   * minute and a restart can land it late — must still pull once. Deciding
   * there is no time left and pulling nothing would lose the whole shift's
   * readings to a rounding error.
   */
  test("a deadline already past still pulls once", async () => {
    let calls = 0;
    const result = await runIngestWindow("ftw", {
      dates: TEST_DATES,
      endsAt: new Date(Date.now() - 60_000),
      passDelayMs: 25,
      ftwFetch: async () => {
        calls += 1;
        return [ftwRow()];
      },
    });

    expect(calls).toBe(1);
    expect(result.passes).toBe(1);
    const rows = await db
      .select()
      .from(schema.ftwReadings)
      .where(eq(schema.ftwReadings.date, D1));
    expect(rows).toHaveLength(1); // the one pass still landed its data
  });

  test("a failing pass logs and the window continues", async () => {
    let calls = 0;
    const result = await runIngestWindow("ftw", {
      dates: TEST_DATES,
      windowMs: 400,
      passDelayMs: 25,
      ftwFetch: async () => {
        calls += 1;
        if (calls === 1) throw new Error("source hiccup");
        return [ftwRow()];
      },
    });

    expect(result.passes).toBeGreaterThanOrEqual(2);
    expect(result.failures).toBe(1);
    const rows = await db
      .select()
      .from(schema.ftwReadings)
      .where(eq(schema.ftwReadings.date, D1));
    expect(rows).toHaveLength(1); // later pass still landed the data
  });
});
