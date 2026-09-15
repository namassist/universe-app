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
import { deriveDate, deriveSoon, reduceTaps } from "./derive";

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
      .delete(schema.deviceLiveEvents)
      .where(eq(schema.deviceLiveEvents.ip, ip));
    await db
      .delete(schema.fingerReadings)
      .where(eq(schema.fingerReadings.nik, nik));
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
        .from(schema.fingerReadings)
        .where(eq(schema.fingerReadings.nik, nik))
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

/**
 * Both ears, and which one wins where they disagree.
 *
 * The pull carries a direction the machine recorded; the live protocol carries
 * none. Until 2026-09-14 only the pull reached `deriveDate`, so a morning where
 * the pull was down printed tickets, filled the live log, and produced a board
 * that seated nobody — the failure a whole-muster simulation walked into.
 */
describe("a tap only the live session heard", () => {
  const ip = "10.99.99.2";
  const nik = "999000222";
  const date = "1999-03-04";

  const wipe = async () => {
    await db.delete(schema.deviceTaps).where(eq(schema.deviceTaps.ip, ip));
    await db
      .delete(schema.deviceLiveEvents)
      .where(eq(schema.deviceLiveEvents.ip, ip));
    await db
      .delete(schema.fingerReadings)
      .where(eq(schema.fingerReadings.nik, nik));
  };

  const pull = (at: string, direction: "in" | "out") =>
    db
      .insert(schema.deviceTaps)
      .values({ ip, nik, at, direction, verified: 1 })
      .onConflictDoNothing();
  const heard = (at: string) =>
    db
      .insert(schema.deviceLiveEvents)
      .values({ ip, nik, at })
      .onConflictDoNothing();
  const readingOf = async () =>
    (
      await db
        .select()
        .from(schema.fingerReadings)
        .where(eq(schema.fingerReadings.nik, nik))
    )[0];

  beforeEach(wipe);
  afterAll(wipe);

  /* The whole point: attendance and the board survive a dead pull. */
  test("still becomes an arrival", async () => {
    await heard(`${date} 04:41:00`);
    expect(await deriveDate(date)).toBe(1);
    expect((await readingOf())!.firstInAt).toBe(`${date} 04:41:00`);
  });

  test("does not double-count the tap the pull also has", async () => {
    await heard(`${date} 04:41:00`);
    await pull(`${date} 04:41:00`, "in");
    await deriveDate(date);
    expect((await readingOf())!.firstInAt).toBe(`${date} 04:41:00`);
  });

  /*
   * Something known beats something assumed. The live session would have
   * called this an arrival; the machine says he was leaving, and the machine
   * is the one that knows.
   */
  test("yields to the pull's direction on the same tap", async () => {
    await heard(`${date} 17:55:00`);
    await pull(`${date} 17:55:00`, "out");
    await deriveDate(date);

    const reading = (await readingOf())!;
    expect(reading.firstOutAt).toBe(`${date} 17:55:00`);
    expect(reading.firstInPmAt).toBeNull();
  });

  /*
   * And where the guess is wrong with no pull to correct it, the reduction
   * absorbs it: he arrived before he left, and the earliest tap keeps the
   * column.
   */
  test("a leaving tap guessed as an arrival cannot displace the real one", async () => {
    await heard(`${date} 16:45:00`);
    await heard(`${date} 17:55:00`);
    await deriveDate(date);
    expect((await readingOf())!.firstInPmAt).toBe(`${date} 16:45:00`);
  });

  test("an earlier live tap takes the column from a later pulled one", async () => {
    await pull(`${date} 04:50:00`, "in");
    await deriveDate(date);
    expect((await readingOf())!.firstInAt).toBe(`${date} 04:50:00`);

    await heard(`${date} 04:33:00`);
    await deriveDate(date);
    expect((await readingOf())!.firstInAt).toBe(`${date} 04:33:00`);
  });
});

/*
 * A live tap reaching the reading without waiting for a pull (2026-09-15).
 * Until then only a pull that stored something rebuilt the readings, so the
 * board could be built blind to taps already on people's slips.
 */
describe("rebuilding soon after a live tap", () => {
  const nik = `91${Math.floor(Math.random() * 1e7)
    .toString()
    .padStart(7, "0")}`;
  const day = "2026-01-23";

  afterAll(async () => {
    await db
      .delete(schema.deviceLiveEvents)
      .where(eq(schema.deviceLiveEvents.nik, nik));
    await db
      .delete(schema.fingerReadings)
      .where(eq(schema.fingerReadings.nik, nik));
  });

  test("a tap heard live reaches the reading, one rebuild for a burst", async () => {
    await db
      .insert(schema.deviceLiveEvents)
      .values({ ip: "203.0.113.181", nik, at: `${day} 04:55:00` });

    const burst = [deriveSoon(day, 10), deriveSoon(day, 10)];
    expect(burst[0]).toBe(burst[1]);
    await Promise.all(burst);

    const [row] = await db
      .select({ firstInAt: schema.fingerReadings.firstInAt })
      .from(schema.fingerReadings)
      .where(eq(schema.fingerReadings.nik, nik));
    expect(row?.firstInAt).toBe(`${day} 04:55:00`);
  });
});
