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
import { fingerInDeadline, ftwDeadline, judge } from "./readiness";

/** Uploaded before the 04:45 gate, so lateness never confuses another test. */
const PUNCTUAL = "2026-08-29 04:20:00";

/** A reading that passes, so each test can spoil exactly one thing. */
const ok = {
  ftw: {
    ftwDecision: "FTW aman",
    sleepCategory: "Dapat Bekerja",
    sentAt: PUNCTUAL,
  },
  finger: { firstInAt: "2026-08-29 05:01:00" },
  requiresFtw: true,
  deadline: "05:15:00",
  ftwDeadline: "04:45:00",
};

describe("a late upload", () => {
  test("is refused even when savera says the person is fit", () => {
    // The whole point of the value: `FTW aman` + `Dapat Bekerja` is a pass on
    // every axis savera measures, and it still must not place anyone, because
    // nobody judged them before the shift was decided.
    const v = judge({
      ...ok,
      ftw: { ...ok.ftw, sentAt: "2026-08-29 05:19:00" },
    });
    expect(v.ftw).toBe("late");
    expect(v.passed).toBe(false);
  });

  test("is its own verdict, not folded into fail", () => {
    // `fail` is a medical answer and `late` an administrative one. A screen
    // that showed both as "gagal" would send a supervisor looking for a sick
    // operator who is standing in front of them, fit and holding a phone.
    const late = judge({
      ...ok,
      ftw: { ...ok.ftw, sentAt: "2026-08-29 05:19:00" },
    });
    const unfit = judge({
      ...ok,
      ftw: { ...ok.ftw, sleepCategory: "Tidak Boleh Bekerja" },
    });
    expect(late.ftw).toBe("late");
    expect(unfit.ftw).toBe("fail");
  });

  test("is decided by the timeline, not by a fixed hour", () => {
    const at0500 = { ...ok.ftw, sentAt: "2026-08-29 05:00:00" };
    expect(judge({ ...ok, ftw: at0500 }).ftw).toBe("late");
    // Move the gate and the same upload becomes punctual.
    expect(judge({ ...ok, ftw: at0500, ftwDeadline: "05:15:00" }).ftw).toBe(
      "pass"
    );
  });

  test("closes at the deadline, which is not the last moment through it", () => {
    expect(
      judge({ ...ok, ftw: { ...ok.ftw, sentAt: "2026-08-29 04:44:59" } }).ftw
    ).toBe("pass");
    expect(
      judge({ ...ok, ftw: { ...ok.ftw, sentAt: "2026-08-29 04:45:00" } }).ftw
    ).toBe("late");
  });

  test("does not apply to a unit that asks for no FTW", () => {
    const v = judge({
      ...ok,
      requiresFtw: false,
      ftw: { ...ok.ftw, sentAt: "2026-08-29 05:19:00" },
    });
    expect(v.ftw).toBe("not-required");
    expect(v.passed).toBe(true);
  });

  test("a reading with no upload time is judged on its verdict alone", () => {
    // savera has always sent one. Inventing lateness from a null would fail
    // people for a gap in our own record rather than for anything they did.
    const v = judge({ ...ok, ftw: { ...ok.ftw, sentAt: null } });
    expect(v.ftw).toBe("pass");
    expect(v.sentAt).toBeNull();
  });

  test("reports the upload time, so a screen can say how late", () => {
    const v = judge({
      ...ok,
      ftw: { ...ok.ftw, sentAt: "2026-08-29 05:19:42" },
    });
    expect(v.sentAt).toBe("05:19:42");
  });
});

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
      ftw: {
        ftwDecision: "FTW aman",
        sleepCategory: "Tidak Boleh Bekerja",
        sentAt: PUNCTUAL,
      },
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
          ftw: {
            ftwDecision: "FTW aman",
            sleepCategory: category,
            sentAt: PUNCTUAL,
          },
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
          sentAt: PUNCTUAL,
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
        ftw: {
          ftwDecision: "  ftw aman ",
          sleepCategory: "DAPAT BEKERJA",
          sentAt: PUNCTUAL,
        },
      }).ftw
    ).toBe("pass");
  });

  test("a value savera has reworded is unreadable, and never a pass", () => {
    // The reason these are text and not an enum: savera's rules are
    // operator-configurable. A reworded verdict must surface as something we
    // cannot read, not as a quiet failure that empties the board with no clue.
    for (const bad of [
      { ftwDecision: "Aman", sleepCategory: "Dapat Bekerja", sentAt: PUNCTUAL },
      {
        ftwDecision: "FTW aman",
        sleepCategory: "Boleh Kerja",
        sentAt: PUNCTUAL,
      },
      { ftwDecision: null, sleepCategory: "Dapat Bekerja", sentAt: PUNCTUAL },
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
        sentAt: PUNCTUAL,
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

  test("reads the upload deadline from its own stage", async () => {
    // `ftw-deadline` was a no-op marker until it became the rule for `late`.
    // It is a different stage from `finger-in` and must be read as one.
    expect(await ftwDeadline("day")).toBe("04:45:00");
    expect(await ftwDeadline("night")).toBe("16:45:00");
  });
});
