/**
 * Every row of the points table in `docs/prd.md` (Peringkat Operator), one
 * test each, plus the edges that decide whether the scheme is fair.
 *
 * The fairness rule is the one under test throughout: the same behaviour
 * scores the same whether the operator holds a PLAN unit or is a spare, so
 * nothing here takes a role at all.
 *
 * Needs nothing:
 *   bun --env-file=.env test src/points-rules.test.ts
 */

import { describe, expect, test } from "bun:test";

import { scoreShift, type ScoreInput } from "./points-rules";

const score = (over: Partial<ScoreInput>) =>
  scoreShift({
    seated: true,
    finger: "pass",
    ftw: "pass",
    sleepMinutes: 420,
    previousStreak: 0,
    ...over,
  });

describe("operated: seated, tapped, FTW passed", () => {
  test("first shift of a run: base, on time, sleep, no streak bonus yet", () => {
    expect(score({})).toEqual({
      outcome: "operated",
      base: 10,
      onTime: 2,
      sleep: 3,
      streakBonus: 0,
      total: 15,
      streak: 1,
    });
  });

  test("the streak bonus grows by 2 a shift", () => {
    expect(score({ previousStreak: 1 })).toMatchObject({
      streakBonus: 2,
      total: 17,
      streak: 2,
    });
    expect(score({ previousStreak: 4 })).toMatchObject({
      streakBonus: 8,
      streak: 5,
    });
  });

  test("the streak bonus stops at +10, so a shift tops out at 25", () => {
    expect(score({ previousStreak: 5 })).toMatchObject({
      streakBonus: 10,
      total: 25,
      streak: 6,
    });
    expect(score({ previousStreak: 40 })).toMatchObject({
      streakBonus: 10,
      total: 25,
      streak: 41,
    });
  });

  test("a late tap still counts as attendance, without the on-time 2", () => {
    /* Only a supervisor's manual placement seats a late tap. */
    expect(score({ finger: "late" })).toMatchObject({
      outcome: "operated",
      onTime: 0,
      total: 13,
    });
  });

  test("sleep under six hours passes FTW but earns no sleep bonus", () => {
    expect(score({ sleepMinutes: 359 })).toMatchObject({ sleep: 0 });
    expect(score({ sleepMinutes: 360 })).toMatchObject({ sleep: 3 });
  });

  test("no sleep reading earns no sleep bonus", () => {
    expect(score({ sleepMinutes: null })).toMatchObject({
      outcome: "operated",
      sleep: 0,
    });
  });

  test("a unit that asks for no FTW counts as passed", () => {
    expect(score({ ftw: "not-required" })).toMatchObject({
      outcome: "operated",
      base: 10,
    });
  });
});

describe("stood down: ready, and no seat to take", () => {
  test("scores exactly what operating would, and the streak grows", () => {
    const seated = score({ previousStreak: 3 });
    const stood = score({ seated: false, previousStreak: 3 });
    expect(stood).toEqual({ ...seated, outcome: "stood-down" });
    expect(stood.streak).toBe(4);
  });

  test("tops out at 25 like a seat", () => {
    expect(score({ seated: false, previousStreak: 9 }).total).toBe(25);
  });
});

describe("not counted: seated, but a condition failed", () => {
  test("placed over an FTW that did not pass: nothing, and the streak breaks", () => {
    for (const ftw of ["fail", "late", "missing"] as const)
      expect(score({ ftw, previousStreak: 5 })).toEqual({
        outcome: "not-counted",
        base: 0,
        onTime: 0,
        sleep: 0,
        streakBonus: 0,
        total: 0,
        streak: 0,
      });
  });

  test("seated with no tap at all: attendance was never recorded", () => {
    expect(score({ finger: "missing", previousStreak: 5 })).toMatchObject({
      outcome: "not-counted",
      total: 0,
      streak: 0,
    });
  });
});

describe("not ready: rostered, not seated, and the tap or FTW failed", () => {
  test("-15 and the streak breaks, for any failure of either", () => {
    const failures: Partial<ScoreInput>[] = [
      { finger: "missing" },
      { finger: "late" },
      { ftw: "fail" },
      { ftw: "late" },
      { ftw: "missing" },
      { finger: "missing", ftw: "missing" },
    ];
    for (const failure of failures)
      expect(score({ seated: false, previousStreak: 5, ...failure })).toEqual({
        outcome: "not-ready",
        base: -15,
        onTime: 0,
        sleep: 0,
        streakBonus: 0,
        total: -15,
        streak: 0,
      });
  });
});

describe("unreadable FTW: our fault, never the operator's", () => {
  test("not seated, on time: nothing gained or lost, the streak holds", () => {
    expect(
      score({ seated: false, ftw: "unreadable", previousStreak: 4 })
    ).toEqual({
      outcome: "unreadable",
      base: 0,
      onTime: 0,
      sleep: 0,
      streakBonus: 0,
      total: 0,
      streak: 4,
    });
  });

  test("seated with a tap: the same", () => {
    expect(score({ ftw: "unreadable", previousStreak: 4 })).toMatchObject({
      outcome: "unreadable",
      total: 0,
      streak: 4,
    });
  });

  test("a failed tap still fails, whatever the FTW said", () => {
    expect(
      score({ seated: false, ftw: "unreadable", finger: "missing" })
    ).toMatchObject({ outcome: "not-ready", total: -15 });
  });
});
