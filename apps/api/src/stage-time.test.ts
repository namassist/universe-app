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
import { shiftGates, stageGates } from "./stage-time";

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
