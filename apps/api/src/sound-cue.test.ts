/**
 * Which sound a screen is told to play next, and when.
 *
 * Pure — no database, no clock of its own:
 *   bun test src/sound-cue.test.ts
 */

import { describe, expect, test } from "bun:test";

import { DEFAULT_SOUND_OFFSET } from "@universe/contracts";

import { nextSoundCue, type CueStage } from "./sound-cue";

const stage = (extra: Partial<CueStage> = {}): CueStage => ({
  id: "stage-ftw",
  name: "Batas upload FTW",
  at: "05:21",
  soundId: "sound-a",
  soundOffsetMinutes: DEFAULT_SOUND_OFFSET,
  active: true,
  ...extra,
});

/** A local wall-clock instant, as the site reads it. */
const at = (clock: string) => new Date(`2026-09-23T${clock}:00`);

describe("the next sound a screen is told to play", () => {
  test("is the stage's own time, two minutes earlier", () => {
    const cue = nextSoundCue([stage()], at("05:10"));
    expect(cue).toMatchObject({
      soundId: "sound-a",
      stageName: "Batas upload FTW",
    });
    expect(cue?.playAt).toEqual(at("05:19"));
    // The default every stage had before the offset could be chosen.
    expect(DEFAULT_SOUND_OFFSET).toBe(-2);
  });

  test("the cue is identified by stage and date, so a screen plays it once", () => {
    const first = nextSoundCue([stage()], at("05:10"));
    const again = nextSoundCue([stage()], at("05:18"));
    expect(first?.id).toBe(again!.id);
    expect(first?.id).toContain("2026-09-23");

    // Tomorrow is a different cue, though the stage and the clock are the same.
    const tomorrow = nextSoundCue([stage()], new Date("2026-09-24T05:10:00"));
    expect(tomorrow?.id).not.toBe(first?.id);
  });

  test("the soonest one wins when several are coming", () => {
    const cue = nextSoundCue(
      [
        stage({ id: "late", at: "05:21", soundId: "sound-late" }),
        stage({ id: "soon", at: "05:15", soundId: "sound-soon" }),
      ],
      at("05:05")
    );
    expect(cue?.soundId).toBe("sound-soon");
  });

  test("one too far ahead waits — the screen is told again in time", () => {
    /* A cue is carried only inside the horizon; the poll is a minute wide, so
       anything nearer than that is offered several times before it matters. */
    expect(nextSoundCue([stage()], at("04:30"))).toBeNull();
    expect(nextSoundCue([stage()], at("05:10"))).not.toBeNull();
  });

  test("a stage with no sound, or switched off, is not a cue", () => {
    expect(nextSoundCue([stage({ soundId: null })], at("05:10"))).toBeNull();
    expect(nextSoundCue([stage({ active: false })], at("05:10"))).toBeNull();
  });

  test("one already past is not replayed, and the next day's is not early", () => {
    /* A screen that opens at 05:20 has missed the 05:19 cue; blurting it out
       on load would announce a deadline that is already here. And the cue for
       tomorrow morning is not worth carrying at noon — the screen will be
       told again long before it matters. */
    expect(nextSoundCue([stage()], at("05:20"))).toBeNull();
    expect(nextSoundCue([stage()], at("12:00"))).toBeNull();
  });

  test("a stage just after midnight is seen from the evening before", () => {
    /* The horizon exists so a missed poll cannot silently skip an
       announcement, and it must not evaporate at midnight: at 23:50 the cue
       for a 00:05 stage is thirteen minutes away, not a day behind. */
    const night = [stage({ id: "midnight", at: "00:05" })];
    const cue = nextSoundCue(night, new Date("2026-09-23T23:50:00"));
    expect(cue?.playAt).toEqual(new Date("2026-09-24T00:03:00"));
  });

  test("that cue keeps one identity across midnight, so it sounds once", () => {
    /* Named for the day it fires on, not the day it was first offered —
       otherwise the poll before midnight and the poll after it describe the
       same announcement with two names, and the screen plays it twice. */
    const night = [stage({ id: "midnight", at: "00:05" })];
    const before = nextSoundCue(night, new Date("2026-09-23T23:50:00"));
    const after = nextSoundCue(night, new Date("2026-09-24T00:01:00"));
    expect(before?.id).toBe(after!.id);
    expect(before?.id).toContain("2026-09-24");
  });

  test("a cue just seconds away still counts", () => {
    // The poll is a minute wide, so the moment often lands mid-interval.
    const cue = nextSoundCue([stage()], new Date("2026-09-23T05:18:59"));
    expect(cue?.playAt).toEqual(at("05:19"));
  });
});

describe("each stage's own offset (owner, 2026-10-10)", () => {
  test("five minutes before", () => {
    const cue = nextSoundCue([stage({ soundOffsetMinutes: -5 })], at("05:10"));
    expect(cue?.playAt).toEqual(at("05:16"));
  });

  test("zero is on the stage's minute", () => {
    const cue = nextSoundCue([stage({ soundOffsetMinutes: 0 })], at("05:10"));
    expect(cue?.playAt).toEqual(at("05:21"));
  });

  test("a positive offset plays after the stage — and still plays", () => {
    // The stage itself has passed at 05:22; its sound at 05:24 has not.
    const cue = nextSoundCue([stage({ soundOffsetMinutes: 3 })], at("05:22"));
    expect(cue?.playAt).toEqual(at("05:24"));
  });

  test("a sound already played is not offered again, whatever the offset", () => {
    expect(
      nextSoundCue([stage({ soundOffsetMinutes: 3 })], at("05:25"))
    ).toBeNull();
  });

  test("two stages on one minute with different offsets both get their turn", () => {
    const stages = [
      stage({
        id: "ftw",
        at: "05:21",
        soundId: "s-ftw",
        soundOffsetMinutes: -3,
      }),
      stage({
        id: "tap",
        at: "05:21",
        soundId: "s-tap",
        soundOffsetMinutes: 0,
      }),
    ];
    expect(nextSoundCue(stages, at("05:10"))?.soundId).toBe("s-ftw");
    expect(nextSoundCue(stages, at("05:19"))?.soundId).toBe("s-tap");
  });

  test("an offset after a late stage crosses midnight into the next day", () => {
    const late = stage({ id: "late", at: "23:58", soundOffsetMinutes: 5 });
    // At 00:01 the 00:03 sound belongs to yesterday's 23:58 stage.
    const cue = nextSoundCue([late], new Date("2026-09-24T00:01:00"));
    expect(cue?.playAt).toEqual(new Date("2026-09-24T00:03:00"));
    expect(cue?.id).toBe("late:2026-09-24");
  });

  test("an offset before an early stage crosses midnight into the day before", () => {
    const early = stage({ id: "early", at: "00:02", soundOffsetMinutes: -5 });
    const cue = nextSoundCue([early], new Date("2026-09-23T23:50:00"));
    expect(cue?.playAt).toEqual(new Date("2026-09-23T23:57:00"));
    expect(cue?.id).toBe("early:2026-09-23");
  });
});
