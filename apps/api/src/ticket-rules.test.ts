/**
 * Every row of the ticket table in `docs/prd.md`, one test each.
 *
 * These rules decide what a person holds in their hand while walking to a
 * unit, so they are written as the cases were settled — by the situation, not
 * by the branch. A wrong unit here is somebody boarding the wrong bus.
 *
 * Needs nothing:
 *   bun --env-file=.env test src/ticket-rules.test.ts
 */

import { describe, expect, test } from "bun:test";

import { ticketFor, type Seat, type TicketInput } from "./ticket-rules";
import type { FingerVerdict, FtwVerdict, Readiness } from "./readiness";

const SECOND_FINGER = "05:28:00";

const seat: Seat = {
  unit: "DT-118",
  bus: "BUS 07",
  fleet: "EX-204",
  area: "PIT 3",
};

const readiness = (ftw: FtwVerdict, finger: FingerVerdict): Readiness => ({
  ftw,
  finger,
  /* The board's own rule, mirrored: in time, and FTW passed or never asked. */
  passed: finger === "pass" && (ftw === "pass" || ftw === "not-required"),
  tappedAt: null,
  sentAt: null,
});

const ask = (over: Partial<TicketInput>): ReturnType<typeof ticketFor> =>
  ticketFor({
    role: "standing",
    readiness: readiness("pass", "pass"),
    seat,
    tappedAt: "04:35:00",
    firstTapAt: "04:35:00",
    secondFingerAt: SECOND_FINGER,
    awaitsAllocation: true,
    ...over,
  });

describe("a standing operator", () => {
  test("passed FTW and in time: the full ticket", () => {
    const out = ask({});
    expect(out).toMatchObject({ print: true, reason: "full", at: "04:35:00" });
    expect(out.print && out.seat?.unit).toBe("DT-118");
  });

  /* The FTW window closes at 05:22, long after the first finger opens, so this
     is the ordinary case at 04:35 — not an error. */
  test("FTW not uploaded yet: proof of attendance, no unit", () => {
    const out = ask({ readiness: readiness("missing", "pass") });
    expect(out).toMatchObject({ print: true, reason: "attendance-only" });
    expect(out.print && out.seat).toBeNull();
  });

  test("FTW failed: proof of attendance, no unit", () => {
    expect(ask({ readiness: readiness("fail", "pass") })).toMatchObject({
      print: true,
      reason: "attendance-only",
    });
  });

  /* Uploaded after the deadline is an administrative failure, not a medical
     one, but it costs the unit the same way. */
  test("FTW uploaded late: proof of attendance, no unit", () => {
    expect(ask({ readiness: readiness("late", "pass") })).toMatchObject({
      print: true,
      reason: "attendance-only",
    });
  });

  /* 107 units ask for no FTW verdict at all. Their operators are judged on the
     tap alone, and a failed FTW must not quietly cost them a unit. */
  test("a unit that does not require FTW: the full ticket", () => {
    expect(ask({ readiness: readiness("not-required", "pass") })).toMatchObject(
      {
        print: true,
        reason: "full",
      }
    );
  });

  test("tapped after the deadline: proof of attendance, no unit", () => {
    expect(
      ask({
        readiness: readiness("pass", "late"),
        tappedAt: "05:26:00",
        firstTapAt: "05:26:00",
      })
    ).toMatchObject({ print: true, reason: "attendance-only" });
  });

  /* The fleet setting was not filled by the time they tapped, so the plan
     gives no seat. The ticket is still theirs. */
  test("no seat in the plan yet: proof of attendance", () => {
    expect(ask({ seat: null })).toMatchObject({
      print: true,
      reason: "attendance-only",
    });
  });
});

describe("a spare", () => {
  /* Nothing to print: the allocation does not exist until 05:26. */
  test("at the first finger: recorded, not printed", () => {
    expect(ask({ role: "spare", tappedAt: "04:50:00" })).toEqual({
      print: false,
      reason: "spare-waits-for-allocation",
    });
  });

  test("at the second finger, allocated: the full ticket", () => {
    expect(
      ask({
        role: "spare",
        tappedAt: "05:29:00",
        firstTapAt: "04:50:00",
      })
    ).toMatchObject({ print: true, reason: "full" });
  });

  /*
   * The arrival is the first tap. This is the whole reason a spare taps twice,
   * and printing 05:29 would date an arrival forty minutes after it happened.
   */
  test("the ticket states the first tap, not the second", () => {
    const out = ask({
      role: "spare",
      tappedAt: "05:29:00",
      firstTapAt: "04:50:00",
    });
    expect(out.print && out.at).toBe("04:50:00");
  });

  /* Most spares, most mornings: 105 of them on 2026-09-12. They came, they
     tapped, and no unit was short. */
  test("at the second finger, not allocated: proof of attendance", () => {
    expect(
      ask({
        role: "spare",
        seat: null,
        tappedAt: "05:29:00",
        firstTapAt: "04:50:00",
      })
    ).toMatchObject({ print: true, reason: "attendance-only" });
  });

  /* Skipped the first finger entirely: the allocation ran without them, so
     they hold no seat, and the arrival is the only tap they made. */
  test("who skipped the first finger: proof of attendance, own time", () => {
    const out = ask({
      role: "spare",
      readiness: readiness("pass", "late"),
      seat: null,
      tappedAt: "05:29:00",
      firstTapAt: "05:29:00",
    });
    expect(out).toMatchObject({ print: true, reason: "attendance-only" });
    expect(out.print && out.at).toBe("05:29:00");
  });

  /* No late tolerance (owner, 2026-09-15): the board will not seat him
     whatever he waits for, so one tap is enough. */
  test("whose first finger was late: printed at once, no second tap", () => {
    const out = ask({
      role: "spare",
      readiness: readiness("pass", "late"),
      seat: null,
      tappedAt: "05:25:30",
      firstTapAt: "05:25:30",
    });
    expect(out).toMatchObject({ print: true, reason: "attendance-only" });
  });
});

describe("the boundary at the second finger", () => {
  /* The gate opens *at* 05:28, not after it — the same reading `readiness.ts`
     gives every other deadline on this timeline. */
  test("a spare tapping exactly at the second finger prints", () => {
    expect(
      ask({ role: "spare", tappedAt: SECOND_FINGER, firstTapAt: "04:50:00" })
    ).toMatchObject({ print: true });
  });

  test("a second before it does not", () => {
    expect(
      ask({ role: "spare", tappedAt: "05:27:59", firstTapAt: "04:50:00" })
    ).toMatchObject({ print: false });
  });
});

/* The full-scenario print test of 2026-09-15: a mechanic and a standby
   employee tapped at 05:00 and got nothing until 05:28, waiting for an
   allocation the board never makes for them. */
describe("somebody the board never considers", () => {
  test("gets his slip at the first finger", () => {
    expect(
      ask({
        role: "spare",
        seat: null,
        tappedAt: "05:00:00",
        firstTapAt: "05:00:00",
        awaitsAllocation: false,
      })
    ).toMatchObject({ print: true, reason: "attendance-only" });
  });

  test("an operator without a unit still waits", () => {
    expect(
      ask({
        role: "spare",
        seat: null,
        tappedAt: "05:00:00",
        firstTapAt: "05:00:00",
      })
    ).toMatchObject({ print: false });
  });
});

/* The admin's placement on the board is how a late person reaches a unit at
   all; judging it again threw it away (owner, 2026-09-15). */
describe("a seat an admin placed by hand", () => {
  test("prints for somebody who tapped late", () => {
    const out = ask({
      readiness: readiness("pass", "late"),
      tappedAt: "05:40:00",
      firstTapAt: "05:40:00",
      placedByHand: true,
    });
    expect(out).toMatchObject({ print: true, reason: "full" });
  });

  test("prints even over a failed FTW — the admin decided", () => {
    const out = ask({
      readiness: readiness("fail", "pass"),
      placedByHand: true,
    });
    expect(out.print && out.seat?.unit).toBe("DT-118");
  });

  test("the engine's own seat is still judged", () => {
    const out = ask({ readiness: readiness("fail", "pass") });
    expect(out.print && out.seat).toBeNull();
  });
});
