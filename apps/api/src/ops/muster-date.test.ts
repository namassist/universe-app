/**
 * Which muster a stage on the Operations Center belongs to, and whether its
 * moment has come. Pure — no database, no clock of its own.
 */

import { describe, expect, test } from "bun:test";

import { stageDue, stageMusterDate } from "./muster-date";

const at = (iso: string) => new Date(iso);

describe("stageMusterDate", () => {
  test("a night stage before dawn belongs to the night that began yesterday", () => {
    expect(
      stageMusterDate("night", at("2026-10-02T03:12:00"), {
        date: "2026-10-01",
        shift: "night",
      })
    ).toBe("2026-10-01");
  });

  test("a day stage before dawn is this morning's, still ahead", () => {
    expect(
      stageMusterDate("day", at("2026-10-02T03:12:00"), {
        date: "2026-10-01",
        shift: "night",
      })
    ).toBe("2026-10-02");
  });

  test("during the day both shifts are today's", () => {
    const running = { date: "2026-10-02", shift: "day" as const };
    expect(stageMusterDate("day", at("2026-10-02T09:00:00"), running)).toBe(
      "2026-10-02"
    );
    expect(stageMusterDate("night", at("2026-10-02T09:00:00"), running)).toBe(
      "2026-10-02"
    );
  });

  test("a stage governing no shift, or no running muster, is today's", () => {
    expect(stageMusterDate(null, at("2026-10-02T03:12:00"), null)).toBe(
      "2026-10-02"
    );
    expect(stageMusterDate("night", at("2026-10-02T03:12:00"), null)).toBe(
      "2026-10-02"
    );
  });
});

describe("stageDue", () => {
  test("yesterday's 17:25 has come by 03:12 today", () => {
    expect(stageDue("2026-10-01", "17:25", at("2026-10-02T03:12:00"))).toBe(
      true
    );
  });

  test("this morning's 05:25 has not", () => {
    expect(stageDue("2026-10-02", "05:25", at("2026-10-02T03:12:00"))).toBe(
      false
    );
  });

  test("the minute itself counts as come", () => {
    expect(stageDue("2026-10-02", "05:25", at("2026-10-02T05:25:00"))).toBe(
      true
    );
  });
});
