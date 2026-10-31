/**
 * Ranking a month of settled points. Pure.
 *
 *   bun --env-file=.env test src/leaderboard.test.ts
 */

import { describe, expect, test } from "bun:test";

import {
  monthOf,
  periodRange,
  rankLeaderboard,
  type Rankable,
} from "./leaderboard";

const tally = (over: Partial<Rankable>): Rankable => ({
  employeeId: "e",
  nik: "1",
  name: "A",
  total: 0,
  operated: 0,
  stoodDown: 0,
  ...over,
});

describe("periodRange", () => {
  test("both ends counted; the query reads up to the day after", () => {
    expect(periodRange("2026-10-26", "2026-11-01")).toEqual({
      kind: "ok",
      from: "2026-10-26",
      to: "2026-11-01",
      toExclusive: "2026-11-02",
    });
  });

  test("one day is a period", () => {
    expect(periodRange("2026-10-31", "2026-10-31")).toMatchObject({
      kind: "ok",
      toExclusive: "2026-11-01",
    });
  });

  test("an end before its start is refused", () => {
    expect(periodRange("2026-11-01", "2026-10-31").kind).toBe("reversed");
  });

  test("a date that does not exist is refused, not rolled over", () => {
    expect(periodRange("2026-02-30", "2026-03-05").kind).toBe("invalid");
    expect(periodRange("2026-13-01", "2026-13-05").kind).toBe("invalid");
    /* The day after 9999-12-31 has no ISO date Postgres would read. */
    expect(periodRange("9999-12-01", "9999-12-31").kind).toBe("invalid");
  });

  test("366 days is the longest; 367 is refused", () => {
    expect(periodRange("2026-01-01", "2027-01-01").kind).toBe("ok");
    expect(periodRange("2026-01-01", "2027-01-02").kind).toBe("too-long");
  });
});

describe("monthOf", () => {
  test("the calendar month a date falls in, first day to last", () => {
    expect(monthOf("2026-10-31")).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(monthOf("2028-02-10")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });
});

describe("rankLeaderboard", () => {
  test("highest total first", () => {
    const ranked = rankLeaderboard([
      tally({ employeeId: "a", name: "A", total: 40 }),
      tally({ employeeId: "b", name: "B", total: 90 }),
      tally({ employeeId: "c", name: "C", total: -15 }),
    ]);
    expect(ranked.map((r) => [r.rank, r.name])).toEqual([
      [1, "B"],
      [2, "A"],
      [3, "C"],
    ]);
  });

  test("on equal totals, more counted shifts ranks higher", () => {
    const ranked = rankLeaderboard([
      tally({ employeeId: "a", name: "A", total: 50, operated: 2 }),
      tally({
        employeeId: "b",
        name: "B",
        total: 50,
        operated: 2,
        stoodDown: 1,
      }),
    ]);
    expect(ranked.map((r) => [r.rank, r.name])).toEqual([
      [1, "B"],
      [2, "A"],
    ]);
  });

  test("a true tie shares the rank, and the next rank skips", () => {
    const ranked = rankLeaderboard([
      tally({ employeeId: "c", name: "Citra", total: 10 }),
      tally({ employeeId: "a", name: "Adi", total: 50, operated: 3 }),
      tally({ employeeId: "b", name: "Budi", total: 50, operated: 3 }),
    ]);
    expect(ranked.map((r) => [r.rank, r.name])).toEqual([
      [1, "Adi"],
      [1, "Budi"],
      [3, "Citra"],
    ]);
  });

  test("leaves its input as it was", () => {
    const input = [
      tally({ employeeId: "a", total: 1 }),
      tally({ employeeId: "b", total: 2 }),
    ];
    rankLeaderboard(input);
    expect(input.map((t) => t.employeeId)).toEqual(["a", "b"]);
  });
});
