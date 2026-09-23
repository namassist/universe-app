/**
 * When the schedule may be edited, and when the muster has moved past it.
 *
 * Pure — no database, no clock of its own:
 *   bun test src/timeline-edit.test.ts
 */

import { describe, expect, test } from "bun:test";

import { editRefused } from "./timeline-edit";

/** The day muster starts 05:00; the night one 17:00. */
const day = { shift: "day" as const, startsAt: "05:00" };
const night = { shift: "night" as const, startsAt: "17:00" };

const at = (clock: string) => new Date(`2026-09-23T${clock}:00`);

describe("editing a stage the muster has already passed", () => {
  test("is refused while its own muster is running", () => {
    // 05:21 has gone by at 05:30, and the shift is still on.
    expect(
      editRefused({
        stageAt: "05:21",
        stageShift: "day",
        running: day,
        now: at("05:30"),
      })
    ).toBe(true);
  });

  test("is allowed before the stage's time, which is the whole rule", () => {
    expect(
      editRefused({
        stageAt: "05:21",
        stageShift: "day",
        running: day,
        now: at("05:10"),
      })
    ).toBe(false);
  });

  test("leaves the other shift's schedule alone", () => {
    /* At 05:30 the day muster is running; the night stages belong to a muster
       that has not begun, and editing tonight's 17:05 is ordinary work. */
    expect(
      editRefused({
        stageAt: "17:05",
        stageShift: "night",
        running: day,
        now: at("05:30"),
      })
    ).toBe(false);
  });

  test("tomorrow's schedule is editable in the evening", () => {
    /* The naive reading — "its time today has passed" — would refuse an admin
       preparing tomorrow's day shift at 20:00, which is when that work is
       actually done. No day muster is running then. */
    expect(
      editRefused({
        stageAt: "05:21",
        stageShift: "day",
        running: night,
        now: at("20:00"),
      })
    ).toBe(false);
    expect(
      editRefused({
        stageAt: "05:21",
        stageShift: "day",
        running: null,
        now: at("20:00"),
      })
    ).toBe(false);
  });

  test("a night stage stays refused after midnight, while its muster runs", () => {
    /* The night muster began at 17:00 yesterday and is still on at 00:30, so
       its 17:05 stage is long past — even though 00:30 reads as "before"
       against the clock alone. */
    expect(
      editRefused({
        stageAt: "17:05",
        stageShift: "night",
        running: night,
        now: new Date("2026-09-24T00:30:00"),
      })
    ).toBe(true);
  });

  test("a night stage after midnight is still editable before it arrives", () => {
    // 00:45 belongs to the running night muster and has not arrived at 00:30.
    expect(
      editRefused({
        stageAt: "00:45",
        stageShift: "night",
        running: night,
        now: new Date("2026-09-24T00:30:00"),
      })
    ).toBe(false);
  });

  test("a stage governing neither shift is never refused", () => {
    // The `other` markers fire for nobody's muster in particular.
    expect(
      editRefused({
        stageAt: "05:00",
        stageShift: null,
        running: day,
        now: at("06:00"),
      })
    ).toBe(false);
  });
});
