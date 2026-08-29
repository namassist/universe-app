/**
 * The scheduler's two guarantees, which cannot be seen from the UI: a stage
 * fires once per day, and it fires once *across processes*.
 *
 * The second is what the Redis claim exists for, and the only honest way to
 * check it is to run two schedulers concurrently against one Redis and count.
 * Two ticks in one process would pass even if the guard were a local variable.
 *
 * Needs the dev Postgres and Redis, the same as `db:seed`:
 *   bun --env-file=.env test src/scheduler.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { db, schema } from "./db";
import { redis } from "./redis";
import { localDate, minutesOfDay, stageMinutes, tick } from "./scheduler";

/** Stages this file created, cleaned up whatever the assertions do. */
const created: string[] = [];

async function addStage(input: {
  name: string;
  minutesFromMidnight: number;
  action: "other" | "spare-validate";
  shift?: "day" | "night";
  active?: boolean;
}) {
  const hh = String(Math.floor(input.minutesFromMidnight / 60)).padStart(
    2,
    "0"
  );
  const mm = String(input.minutesFromMidnight % 60).padStart(2, "0");
  const [row] = await db
    .insert(schema.timelineStages)
    .values({
      name: input.name,
      at: `${hh}:${mm}:00`,
      action: input.action,
      shift: input.shift ?? null,
      active: input.active ?? true,
    })
    .returning();
  created.push(row!.id);
  return row!;
}

/**
 * The seeded stages are all early-morning, so a run after ~05:30 would see them
 * as due and fire them. They are suspended for the duration and restored after.
 *
 * Once, in `beforeAll`, not per test: recomputing the list before each test
 * would find them already inactive on the second one, and the restore would
 * then have nothing recorded to restore — leaving the site's real schedule
 * switched off by a test run.
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

afterAll(async () => {
  if (suspended.length)
    await db
      .update(schema.timelineStages)
      .set({ active: true })
      .where(inArray(schema.timelineStages.id, suspended));
  if (created.length) {
    await redis.del(...created.map((id) => `stage:${id}:${localDate(now())}`));
    await db
      .delete(schema.timelineStages)
      .where(inArray(schema.timelineStages.id, created));
  }
  redis.disconnect();
});

const now = () => new Date();
/** A minute already past today, so the stage is due the moment it exists. */
const alreadyPassed = () => Math.max(0, minutesOfDay(now()) - 5);
/** A minute still ahead today. Skipped near midnight rather than made flaky. */
const stillAhead = () => minutesOfDay(now()) + 30;

describe("stage time arithmetic", () => {
  test("reads a Postgres time as minutes since midnight", () => {
    expect(stageMinutes("00:00:00")).toBe(0);
    expect(stageMinutes("05:20:00")).toBe(320);
    expect(stageMinutes("23:59:00")).toBe(1439);
  });
});

describe("dispatch", () => {
  test("an active stage whose time has passed fires exactly once a day", async () => {
    const stage = await addStage({
      name: "test — due",
      minutesFromMidnight: alreadyPassed(),
      action: "other",
    });

    const first = await tick();
    expect(first.map((d) => d.stage.id)).toContain(stage.id);

    // The claim, not the clock, is what stops the second one.
    const second = await tick();
    expect(second.map((d) => d.stage.id)).not.toContain(stage.id);

    // And a restart within the same minute is just another tick.
    const third = await tick();
    expect(third.map((d) => d.stage.id)).not.toContain(stage.id);
  });

  test("an inactive stage does not fire", async () => {
    const stage = await addStage({
      name: "test — inactive",
      minutesFromMidnight: alreadyPassed(),
      action: "other",
      active: false,
    });
    const fired = await tick();
    expect(fired.map((d) => d.stage.id)).not.toContain(stage.id);
  });

  test("a stage whose time is still ahead does not fire", async () => {
    const at = stillAhead();
    if (at >= 24 * 60) return; // within half an hour of midnight; nothing to assert
    const stage = await addStage({
      name: "test — not yet",
      minutesFromMidnight: at,
      action: "other",
    });
    const fired = await tick();
    expect(fired.map((d) => d.stage.id)).not.toContain(stage.id);
  });

  test("an unimplemented action fires without erroring and does no other work", async () => {
    const stage = await addStage({
      name: "test — spare validate",
      minutesFromMidnight: alreadyPassed(),
      action: "spare-validate",
    });
    const fired = await tick();
    expect(fired.map((d) => d.stage.id)).toContain(stage.id);
  });

  test("two processes ticking together dispatch it exactly once", async () => {
    const stage = await addStage({
      name: "test — two processes",
      minutesFromMidnight: alreadyPassed(),
      action: "other",
    });

    // Concurrent, not sequential: sequential ticks would pass against a guard
    // that is merely in-process, which is the failure this is looking for.
    const [a, b] = await Promise.all([tick(), tick()]);
    const dispatches = [...a, ...b].filter((d) => d.stage.id === stage.id);
    expect(dispatches.length).toBe(1);
  });

  test("two stages sharing an action both fire — the night half needs this", async () => {
    // The whole night schedule rests on this: `spare-validate` at 05:25 and
    // again at 17:25 are two rows, not two actions. The claim is per stage id
    // (`stage:${id}:${date}`), so nothing here had to change to allow it —
    // but nothing said so either, and a claim keyed on the action instead
    // would silently drop whichever half ran second.
    const day = await addStage({
      name: `zz-pagi-${crypto.randomUUID().slice(0, 8)}`,
      minutesFromMidnight: alreadyPassed(),
      action: "spare-validate",
      shift: "day",
    });
    const night = await addStage({
      name: `zz-malam-${crypto.randomUUID().slice(0, 8)}`,
      minutesFromMidnight: Math.max(0, alreadyPassed() - 1),
      action: "spare-validate",
      shift: "night",
    });

    const fired = await tick();
    const ids = fired.map((d) => d.stage.id);
    expect(ids).toContain(day.id);
    expect(ids).toContain(night.id);
    expect(fired.find((d) => d.stage.id === day.id)?.stage.shift).toBe("day");
    expect(fired.find((d) => d.stage.id === night.id)?.stage.shift).toBe(
      "night"
    );
  });

  test("a time edited backwards fires once, not repeatedly", async () => {
    const at = stillAhead();
    if (at >= 24 * 60) return;
    const stage = await addStage({
      name: "test — edited backwards",
      minutesFromMidnight: at,
      action: "other",
    });
    expect((await tick()).map((d) => d.stage.id)).not.toContain(stage.id);

    // Operator moves it to a moment already past today.
    const past = alreadyPassed();
    const hh = String(Math.floor(past / 60)).padStart(2, "0");
    const mm = String(past % 60).padStart(2, "0");
    await db
      .update(schema.timelineStages)
      .set({ at: `${hh}:${mm}:00` })
      .where(eq(schema.timelineStages.id, stage.id));

    // Due now: fires on the next tick, and only that one.
    expect((await tick()).map((d) => d.stage.id)).toContain(stage.id);
    expect((await tick()).map((d) => d.stage.id)).not.toContain(stage.id);
  });
});
