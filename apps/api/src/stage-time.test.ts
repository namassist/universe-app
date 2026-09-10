/**
 * Which stage says a shift has taken the walls.
 *
 * The fallback is the part worth pinning. `shift-start` was carved out of
 * `ftw-ingest`, so every installation that has not yet added it must keep the
 * changeover it already had — a release that blanked the yard walls until
 * somebody noticed and added two rows would be a bad trade for a knob.
 *
 * Needs the dev Postgres, the same as `db:seed`:
 *   bun --env-file=.env test src/stage-time.test.ts
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { eq, inArray } from "drizzle-orm";
import type { ShiftKind, TimelineAction } from "@universe/contracts";

import { db, schema } from "./db";
import { pullClosesAt, shiftGates, stageGates } from "./stage-time";

/** Rows this file created, removed after each test whatever it asserted. */
let created: string[] = [];

async function addStage(
  action: TimelineAction,
  shift: ShiftKind,
  at: string,
  active = true
): Promise<void> {
  const [row] = await db
    .insert(schema.timelineStages)
    .values({ name: `ZZ ${action} ${shift} ${at}`, at, action, shift, active })
    .returning({ id: schema.timelineStages.id });
  created.push(row!.id);
}

/**
 * The site's own stages are suspended for the duration: `stageTimeOf` takes the
 * first row matching an action and a shift with no ordering, so a seeded
 * `ftw-ingest` beside this file's would make the answer a coin toss.
 */
let suspended: string[] = [];

beforeAll(async () => {
  const rows = await db
    .select({ id: schema.timelineStages.id })
    .from(schema.timelineStages)
    .where(eq(schema.timelineStages.active, true));
  suspended = rows.map((r) => r.id);
  if (suspended.length)
    await db
      .update(schema.timelineStages)
      .set({ active: false })
      .where(inArray(schema.timelineStages.id, suspended));
});

afterEach(async () => {
  if (created.length)
    await db
      .delete(schema.timelineStages)
      .where(inArray(schema.timelineStages.id, created));
  created = [];
});

afterAll(async () => {
  if (suspended.length)
    await db
      .update(schema.timelineStages)
      .set({ active: true })
      .where(inArray(schema.timelineStages.id, suspended));
});

describe("shiftGates", () => {
  test("falls back to ftw-ingest when no changeover is named", async () => {
    await addStage("ftw-ingest", "day", "04:45:00");
    await addStage("ftw-ingest", "night", "16:45:00");

    expect(await shiftGates()).toEqual({
      day: "04:45:00",
      night: "16:45:00",
    });
  });

  test("prefers shift-start once the timeline names it", async () => {
    await addStage("ftw-ingest", "day", "04:45:00");
    await addStage("ftw-ingest", "night", "17:15:00");
    await addStage("shift-start", "day", "04:00:00");
    await addStage("shift-start", "night", "16:00:00");

    // The whole point of the split: the walls turn over at 16:00 while the FTW
    // pull stays at 17:15, where the upload deadline needs it.
    expect(await shiftGates()).toEqual({
      day: "04:00:00",
      night: "16:00:00",
    });
    expect(await stageGates("ftw-ingest")).toEqual({
      day: "04:45:00",
      night: "17:15:00",
    });
  });

  test("half a changeover is no changeover", async () => {
    await addStage("ftw-ingest", "day", "04:45:00");
    await addStage("ftw-ingest", "night", "16:45:00");
    // Night named, morning forgotten. Pairing 16:00 with the morning's FTW
    // pull would be a boundary assembled from two different intentions.
    await addStage("shift-start", "night", "16:00:00");

    expect(await shiftGates()).toEqual({
      day: "04:45:00",
      night: "16:45:00",
    });
  });

  test("a switched-off changeover does not count", async () => {
    await addStage("ftw-ingest", "day", "04:45:00");
    await addStage("ftw-ingest", "night", "16:45:00");
    await addStage("shift-start", "day", "04:00:00", false);
    await addStage("shift-start", "night", "16:00:00", false);

    expect(await shiftGates()).toEqual({
      day: "04:45:00",
      night: "16:45:00",
    });
  });

  test("refuses nothing on its own — an unconfigured timeline yields nulls", async () => {
    expect(await shiftGates()).toEqual({ day: null, night: null });
  });
});

describe("pullClosesAt", () => {
  /** A fixed afternoon, so a suite running at 23:59 cannot roll the date. */
  const NOON = new Date("2026-09-10T12:00:00");

  test("an FTW pull runs until the upload deadline", async () => {
    await addStage("ftw-deadline", "day", "05:22:00");

    const end = await pullClosesAt("ftw-ingest", "day", NOON);

    expect(end).not.toBeNull();
    expect(end!.getHours()).toBe(5);
    expect(end!.getMinutes()).toBe(22);
    expect(end!.getDate()).toBe(NOON.getDate());
  });

  test("a finger pull runs until the tap deadline", async () => {
    await addStage("finger-in", "night", "17:25:00");

    const end = await pullClosesAt("finger-ingest", "night", NOON);

    expect(end!.getHours()).toBe(17);
    expect(end!.getMinutes()).toBe(25);
  });

  /* The two below are what makes the caller fall back rather than pull
     nothing. A window that refused here would take the day's board with it. */

  test("no deadline stage — no answer to give", async () => {
    expect(await pullClosesAt("ftw-ingest", "day", NOON)).toBeNull();
  });

  test("a switched-off deadline does not count", async () => {
    await addStage("ftw-deadline", "day", "05:22:00", false);

    expect(await pullClosesAt("ftw-ingest", "day", NOON)).toBeNull();
  });

  test("a stage carrying no shift cannot say which deadline is its own", async () => {
    await addStage("ftw-deadline", "day", "05:22:00");
    await addStage("ftw-deadline", "night", "17:22:00");

    expect(await pullClosesAt("ftw-ingest", null, NOON)).toBeNull();
  });

  test("an action that closes no pull window has no deadline", async () => {
    await addStage("finger-in", "day", "05:25:00");

    expect(await pullClosesAt("roster-ingest", "day", NOON)).toBeNull();
  });
});
