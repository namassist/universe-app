/**
 * Peringkat Operator's period and table helpers, without a browser.
 *
 *   cd apps/web && bun test components/menus/leaderboard-rows.test.ts
 */

import { describe, expect, test } from "bun:test";

import {
  customPeriodError,
  isoDay,
  matchesSearch,
  monthPeriod,
  operationRatio,
  percentOf,
  podiumOrder,
  signedPoints,
  sleepHours,
  splitUnits,
  weekPeriod,
} from "./leaderboard-rows";

describe("signedPoints", () => {
  test("a gain carries its plus, a loss a true minus sign", () => {
    expect(signedPoints(25)).toBe("+25");
    expect(signedPoints(-15)).toBe("−15");
    expect(signedPoints(0)).toBe("0");
  });
});

describe("matchesSearch", () => {
  const row = { nik: "50721065", name: "Ali Usman" };

  test("an empty search keeps everyone", () => {
    expect(matchesSearch(row, "")).toBe(true);
    expect(matchesSearch(row, "   ")).toBe(true);
  });

  test("by name, whatever the case", () => {
    expect(matchesSearch(row, "usman")).toBe(true);
    expect(matchesSearch(row, "budi")).toBe(false);
  });

  test("by NIK", () => {
    expect(matchesSearch(row, "7210")).toBe(true);
  });
});

describe("periods", () => {
  test("isoDay is the browser's own calendar day", () => {
    expect(isoDay(new Date(2026, 9, 31, 23, 50))).toBe("2026-10-31");
  });

  test("a week runs Monday to Sunday, whichever day was picked", () => {
    const week = { from: "2026-10-26", to: "2026-11-01" };
    expect(weekPeriod("2026-10-26")).toEqual(week);
    expect(weekPeriod("2026-10-31")).toEqual(week);
    /* Sunday is the week's last day, not the next week's first. */
    expect(weekPeriod("2026-11-01")).toEqual(week);
  });

  test("a month runs first to last day, leap years included", () => {
    expect(monthPeriod("2026-10")).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(monthPeriod("2028-02")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  test("a custom range must run forwards and fit the API's limit", () => {
    expect(customPeriodError("2026-10-01", "2026-10-31")).toBeNull();
    expect(customPeriodError("2026-10-31", "2026-10-31")).toBeNull();
    expect(customPeriodError("2026-10-31", "2026-10-01")).toBe("reversed");
    expect(customPeriodError("2026-01-01", "2027-01-01")).toBeNull();
    expect(customPeriodError("2026-01-01", "2027-01-02")).toBe("too-long");
  });
});

describe("columns", () => {
  test("the operation ratio is operated over rostered shifts", () => {
    expect(operationRatio(20, 27)).toBe("20/27");
  });

  test("a percentage is whole, and nothing over nothing is no figure", () => {
    expect(percentOf(25, 27)).toBe(93);
    expect(percentOf(0, 0)).toBeNull();
  });

  test("sleep is hours to one decimal, in the reader's language", () => {
    expect(sleepHours(390, "id")).toBe("6,5");
    expect(sleepHours(390, "en")).toBe("6.5");
    expect(sleepHours(360, "en")).toBe("6");
    expect(sleepHours(null, "id")).toBeNull();
  });

  test("three units are shown, the rest counted", () => {
    const units = ["DT1", "DT2", "DT3", "DT4", "DT5"].map((code) => ({
      code,
      shifts: 1,
    }));
    const { shown, rest } = splitUnits(units);
    expect(shown.map((u) => u.code)).toEqual(["DT1", "DT2", "DT3"]);
    expect(rest.map((u) => u.code)).toEqual(["DT4", "DT5"]);
    expect(splitUnits(units.slice(0, 2)).rest).toEqual([]);
  });
});

describe("podiumOrder", () => {
  const row = (rank: number, name: string) => ({ rank, name });

  test("second, first, third — the winner in the middle", () => {
    const rows = [row(1, "A"), row(2, "B"), row(3, "C"), row(4, "D")];
    expect(podiumOrder(rows).map((r) => r.name)).toEqual(["B", "A", "C"]);
  });

  test("fewer than three: the places there are", () => {
    expect(podiumOrder([row(1, "A")]).map((r) => r.name)).toEqual(["A"]);
    expect(podiumOrder([row(1, "A"), row(2, "B")]).map((r) => r.name)).toEqual([
      "B",
      "A",
    ]);
  });

  test("a tie keeps its shared rank on the card", () => {
    const rows = [row(1, "A"), row(1, "B"), row(3, "C")];
    expect(podiumOrder(rows).map((r) => [r.rank, r.name])).toEqual([
      [1, "B"],
      [1, "A"],
      [3, "C"],
    ]);
  });
});
