import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";

import { db, schema } from "./db";
import { runIngestWindow, syncFingerReadings, syncFtwReadings } from "./ingest";
import type { FtwSourceRow } from "./sources/savera";
import type { FingerSourceRow } from "./sources/nakula";

/** Dates no real source will ever emit again — safe to own and wipe. */
const D1 = "1999-01-01";
const D2 = "1999-01-02";
const TEST_DATES = [D1, D2];

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

describe("syncFtwReadings", () => {
  test("snapshots a source row with the NIK normalized", async () => {
    const result = await syncFtwReadings(TEST_DATES, async () => [ftwRow()]);

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
    await syncFtwReadings(TEST_DATES, async () => [ftwRow()]);
    const [before] = await db
      .select()
      .from(schema.ftwReadings)
      .where(eq(schema.ftwReadings.date, D1));

    // The operator re-uploads inside the window; the verdict changes.
    await syncFtwReadings(TEST_DATES, async () => [
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
    const result = await syncFtwReadings(TEST_DATES, async () => [
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

  test("two raw NIKs that normalize to the same key collapse to one row, not an error", async () => {
    // "050121018" and "50121018" are the same person seen through two source
    // formattings; landing both in one statement must not blow the pass up
    // with ON CONFLICT's cannot-affect-row-twice.
    const result = await syncFtwReadings(TEST_DATES, async () => [
      ftwRow({ nik: "050121018", sleep_category: "Dapat Bekerja" }),
      ftwRow({ nik: "50121018", sleep_category: "Tidak Boleh Bekerja" }),
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
    const first = await syncFtwReadings(TEST_DATES, async () => [ftwRow()]);
    expect(first.inserted).toBe(1);

    const again = await syncFtwReadings(TEST_DATES, async () => [ftwRow()]);
    expect(again.upserted).toBe(1);
    expect(again.inserted).toBe(0);

    const withNew = await syncFtwReadings(TEST_DATES, async () => [
      ftwRow(),
      ftwRow({ nik: "50121099" }),
    ]);
    expect(withNew.upserted).toBe(2);
    expect(withNew.inserted).toBe(1);
  });

  test("the same person on two dates is two snapshot rows", async () => {
    await syncFtwReadings(TEST_DATES, async () => [
      ftwRow(),
      ftwRow({ date: D2, sent_at: `${D2} 04:30:00` }),
    ]);
    const rows = await db
      .select()
      .from(schema.ftwReadings)
      .where(inArray(schema.ftwReadings.date, TEST_DATES));
    expect(rows).toHaveLength(2);
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
