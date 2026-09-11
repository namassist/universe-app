/**
 * Turning taps into the one reading a shift is judged by.
 *
 * The rule is not new — `finger_readings` has carried it since the ingest was
 * written, and `shiftIn` resolves it against the roster. What is new is where
 * it happens: on taps we hold, rather than inside a source adapter, so it can
 * be run again when the rule is refined or found wrong.
 *
 * The cases that matter are the ones a yard actually produces: somebody
 * tapping twice, somebody tapping at two machines, and a night operator who
 * forgets to switch the machine to OUT before going home.
 *
 * Pure — no database.
 *   bun --env-file=.env test src/derive.test.ts
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db, schema } from "./db";
import { deriveDate, reduceTaps } from "./derive";

const tap = (at: string, direction: "in" | "out" = "in", ip = "10.0.0.1") => ({
  nik: "123",
  at,
  direction,
  ip,
});

describe("the arrival", () => {
  test("the first IN of the morning wins", () => {
    const r = reduceTaps([
      tap("2026-09-11 04:40:00"),
      tap("2026-09-11 04:12:00"),
      tap("2026-09-11 05:01:00"),
    ]);

    expect(r.firstInAt).toBe("2026-09-11 04:12:00");
  });

  /* Two machines, one person, one morning. Whichever they reached first is
     the arrival, and which machine it was is worth keeping — it is how we
     found out operators use 33 machines rather than 16. */
  test("across two machines the earlier one wins, and its machine is kept", () => {
    const r = reduceTaps([
      tap("2026-09-11 04:20:00", "in", "10.0.0.2"),
      tap("2026-09-11 04:15:00", "in", "10.0.0.9"),
    ]);

    expect(r.firstInAt).toBe("2026-09-11 04:15:00");
    expect(r.firstInIp).toBe("10.0.0.9");
  });

  /* The noon split, which exists because one day holds two shift-starts. */
  test("an afternoon arrival is a different column from a morning one", () => {
    const r = reduceTaps([
      tap("2026-09-11 04:12:00"),
      tap("2026-09-11 16:40:00"),
    ]);

    expect(r.firstInAt).toBe("2026-09-11 04:12:00");
    expect(r.firstInPmAt).toBe("2026-09-11 16:40:00");
  });

  test("noon itself belongs to the afternoon", () => {
    const r = reduceTaps([tap("2026-09-11 12:00:00")]);

    expect(r.firstInAt).toBeNull();
    expect(r.firstInPmAt).toBe("2026-09-11 12:00:00");
  });
});

describe("what an OUT tap is and is not", () => {
  test("it is not an arrival", () => {
    const r = reduceTaps([tap("2026-09-11 04:12:00", "out")]);

    expect(r.firstInAt).toBeNull();
    expect(r.firstOutAt).toBe("2026-09-11 04:12:00");
  });

  /*
   * The case the owner raised: a night operator finishes at six, should press
   * OUT, and leaves the machine on IN. That tap lands in the morning column of
   * the *next* calendar day.
   *
   * It is not this function's job to see through that — the noon split plus
   * the roster is, and `shiftIn` does it: a night shift reads the afternoon
   * column, so a six o'clock tap can never be read as a night arrival. What is
   * pinned here is that the reduction hands both columns over honestly and
   * invents nothing.
   */
  test("a morning tap left on IN is reported as a morning IN, not hidden", () => {
    const r = reduceTaps([tap("2026-09-11 06:02:00", "in")]);

    expect(r.firstInAt).toBe("2026-09-11 06:02:00");
    expect(r.firstOutAt).toBeNull();
  });

  test("the first OUT wins too", () => {
    const r = reduceTaps([
      tap("2026-09-11 17:30:00", "out"),
      tap("2026-09-11 16:05:00", "out"),
    ]);

    expect(r.firstOutAt).toBe("2026-09-11 16:05:00");
  });
});

describe("nothing to say", () => {
  test("no taps is every column empty, not a missing row", () => {
    const r = reduceTaps([]);

    expect(r.firstInAt).toBeNull();
    expect(r.firstInPmAt).toBeNull();
    expect(r.firstOutAt).toBeNull();
  });
});

/* --------------------------------------------------- against the database */

/**
 * The half that cannot be tested pure: that a rebuild really is a rebuild.
 *
 * The rows are a view of the taps, so running it twice, or running it after
 * more taps arrive, has to leave the view correct rather than merged from two
 * partial answers.
 */
describe("rebuilding a date", () => {
  const ip = "10.99.99.1";
  const nik = "999000111";
  const date = "1999-03-03";

  const wipe = async () => {
    await db.delete(schema.deviceTaps).where(eq(schema.deviceTaps.ip, ip));
    await db
      .delete(schema.derivedReadings)
      .where(eq(schema.derivedReadings.nik, nik));
  };

  const addTap = (at: string, direction: "in" | "out" = "in") =>
    db
      .insert(schema.deviceTaps)
      .values({ ip, nik, at, direction, verified: 1 })
      .onConflictDoNothing();

  const readingOf = async () =>
    (
      await db
        .select()
        .from(schema.derivedReadings)
        .where(eq(schema.derivedReadings.nik, nik))
    )[0];

  beforeEach(wipe);
  afterAll(wipe);

  test("a later tap does not displace the first one", async () => {
    await addTap(`${date} 04:30:00`);
    await deriveDate(date);
    await addTap(`${date} 04:45:00`);
    await deriveDate(date);

    expect((await readingOf())!.firstInAt).toBe(`${date} 04:30:00`);
  });

  /* The case that makes rebuilding worth it: a tap that arrives *earlier* than
     one already reduced — a machine pulled late, or recovered by a manual
     sync. Amending a row could not fix this; rebuilding does. */
  test("a tap that arrives late but happened earlier takes the column", async () => {
    await addTap(`${date} 04:45:00`);
    await deriveDate(date);
    expect((await readingOf())!.firstInAt).toBe(`${date} 04:45:00`);

    await addTap(`${date} 04:20:00`);
    await deriveDate(date);

    expect((await readingOf())!.firstInAt).toBe(`${date} 04:20:00`);
  });

  test("running it twice changes nothing", async () => {
    await addTap(`${date} 04:30:00`);
    await deriveDate(date);
    const once = await readingOf();
    await deriveDate(date);

    expect((await readingOf())!.firstInAt).toBe(once!.firstInAt);
  });
});
