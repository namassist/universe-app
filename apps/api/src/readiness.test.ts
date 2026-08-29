/**
 * The pass rule — the one question everything downstream asks: may this person
 * take a unit on this shift?
 *
 * Most of what is pinned here is a refusal. The rule's value is not that it
 * passes 90% of readings; it is that it refuses the 234 rows in seven days of
 * live data where savera's own two verdicts disagree — `FTW aman` sitting
 * beside a sleep category that forbids work. Reading `ftw_decision` alone, the
 * obvious implementation, puts all 234 on a machine.
 *
 * `judge` is pure. The database appears only in the deadline lookup, which has
 * its own suite at the bottom.
 *
 *   bun --env-file=.env test src/readiness.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { inArray } from "drizzle-orm";

import { db, schema } from "./db";
import { fingerInDeadline, judge } from "./readiness";

/** A reading that passes, so each test can spoil exactly one thing. */
const ok = {
  ftw: { ftwDecision: "FTW aman", sleepCategory: "Dapat Bekerja" },
  finger: { firstInAt: "2026-08-29 05:01:00" },
  requiresFtw: true,
  deadline: "05:15:00",
};

describe("fingerprint", () => {
  test("a tap before the deadline passes", () => {
    expect(judge(ok).finger).toBe("pass");
    expect(judge(ok).passed).toBe(true);
  });

  test("a tap after the deadline is late, not absent", () => {
    const v = judge({ ...ok, finger: { firstInAt: "2026-08-29 05:16:00" } });
    expect(v.finger).toBe("late");
    expect(v.passed).toBe(false);
  });

  test("a tap exactly on the deadline is late — the deadline is a bound", () => {
    expect(
      judge({ ...ok, finger: { firstInAt: "2026-08-29 05:15:00" } }).finger
    ).toBe("late");
  });

  test("no reading at all is missing", () => {
    expect(judge({ ...ok, finger: null }).finger).toBe("missing");
  });

  test("a row with only an OUT tap is missing, not late", () => {
    // 991 rows in seven days look like this — night workers whose day begins
    // with the tap that ends the previous shift. They did not fail to arrive
    // on time; this reading says nothing about their arrival at all.
    expect(judge({ ...ok, finger: { firstInAt: null } }).finger).toBe(
      "missing"
    );
  });

  test("reports the tap time — this is what FCFS orders by", () => {
    expect(judge(ok).tappedAt).toBe("05:01:00");
    expect(judge({ ...ok, finger: null }).tappedAt).toBeNull();
  });

  test("the night deadline judges a night tap", () => {
    const night = {
      ...ok,
      finger: { firstInAt: "2026-08-29 17:02:00" },
      deadline: "17:15:00",
    };
    expect(judge(night).passed).toBe(true);
    // The same tap against the morning deadline is the bug this prevents:
    // one global deadline would fail every night operator, every day.
    expect(judge({ ...night, deadline: "05:15:00" }).finger).toBe("late");
  });
});

describe("FTW", () => {
  test("passes only when both verdicts agree", () => {
    expect(judge(ok).ftw).toBe("pass");
  });

  test("refuses a safe decision whose sleep verdict forbids work", () => {
    // 105 rows in seven days. The single most important assertion in the file.
    const v = judge({
      ...ok,
      ftw: { ftwDecision: "FTW aman", sleepCategory: "Tidak Boleh Bekerja" },
    });
    expect(v.ftw).toBe("fail");
    expect(v.passed).toBe(false);
  });

  test("refuses the two rest categories — no conditional pass", () => {
    for (const category of [
      "Istirahat Minimal 1 Jam",
      "Istirahat Minimal 2 Jam",
    ]) {
      expect(
        judge({
          ...ok,
          ftw: { ftwDecision: "FTW aman", sleepCategory: category },
        }).ftw
      ).toBe("fail");
    }
  });

  test("refuses a good sleep verdict when the form was not filled", () => {
    expect(
      judge({
        ...ok,
        ftw: {
          ftwDecision: "Belum mengisi FTW",
          sleepCategory: "Dapat Bekerja",
        },
      }).ftw
    ).toBe("fail");
  });

  test("no FTW row is a failure, not an exemption", () => {
    const v = judge({ ...ok, ftw: null });
    expect(v.ftw).toBe("missing");
    expect(v.passed).toBe(false);
  });

  test("ignores casing and stray whitespace", () => {
    expect(
      judge({
        ...ok,
        ftw: { ftwDecision: "  ftw aman ", sleepCategory: "DAPAT BEKERJA" },
      }).ftw
    ).toBe("pass");
  });

  test("a value savera has reworded is unreadable, and never a pass", () => {
    // The reason these are text and not an enum: savera's rules are
    // operator-configurable. A reworded verdict must surface as something we
    // cannot read, not as a quiet failure that empties the board with no clue.
    for (const bad of [
      { ftwDecision: "Aman", sleepCategory: "Dapat Bekerja" },
      { ftwDecision: "FTW aman", sleepCategory: "Boleh Kerja" },
      { ftwDecision: null, sleepCategory: "Dapat Bekerja" },
    ]) {
      const v = judge({ ...ok, ftw: bad });
      expect(v.ftw).toBe("unreadable");
      expect(v.passed).toBe(false);
    }
  });
});

describe("a unit that does not require FTW", () => {
  test("passes on the tap alone", () => {
    const v = judge({ ...ok, ftw: null, requiresFtw: false });
    expect(v.ftw).toBe("not-required");
    expect(v.passed).toBe(true);
  });

  test("still needs the tap", () => {
    expect(
      judge({ ...ok, ftw: null, finger: null, requiresFtw: false }).passed
    ).toBe(false);
  });

  test("is not failed by an FTW verdict it never needed", () => {
    const v = judge({
      ...ok,
      ftw: {
        ftwDecision: "Belum mengisi FTW",
        sleepCategory: "Tidak Boleh Bekerja",
      },
      requiresFtw: false,
    });
    expect(v.ftw).toBe("not-required");
    expect(v.passed).toBe(true);
  });
});

/* ------------------------------------------------- the deadline lookup */

const made: string[] = [];

beforeAll(async () => {
  const rows = await db
    .insert(schema.timelineStages)
    .values([
      {
        name: `ZZ uji finger ${crypto.randomUUID().slice(0, 8)}`,
        at: "09:09:00",
        action: "finger-in",
        shift: "day",
        active: false,
      },
    ])
    .returning({ id: schema.timelineStages.id });
  made.push(...rows.map((r) => r.id));
});

afterAll(async () => {
  if (made.length)
    await db
      .delete(schema.timelineStages)
      .where(inArray(schema.timelineStages.id, made));
});

describe("the deadline comes from the master timeline", () => {
  test("reads the seeded day and night deadlines", async () => {
    expect(await fingerInDeadline("day")).toBe("05:15:00");
    expect(await fingerInDeadline("night")).toBe("17:15:00");
  });

  test("ignores a deactivated stage", async () => {
    // The inactive 09:09 row above must not win over the real 05:15 one.
    expect(await fingerInDeadline("day")).toBe("05:15:00");
  });
});
