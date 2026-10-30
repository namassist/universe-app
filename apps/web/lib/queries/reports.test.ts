/**
 * What a report is asked with. The today-only report sends no date and no
 * shift — the API reads today by its own clock and refuses any other day — so
 * a date left in the filter from another report cannot turn into a 422.
 */

import { describe, expect, test } from "bun:test";

import { reportParams, type ReportFilter } from "./reports";

const filter = (over: Partial<ReportFilter> = {}): ReportFilter => ({
  kind: "final-validation",
  date: "2026-10-30",
  shift: "day",
  department: "",
  position: "",
  ...over,
});

describe("reportParams", () => {
  test("a per-shift report sends its date and shift", () => {
    expect(reportParams(filter()).toString()).toBe("date=2026-10-30&shift=day");
  });

  test("the today-only report sends neither date nor shift", () => {
    expect(
      reportParams(
        filter({ kind: "induction-operators", date: "2026-10-01" })
      ).toString()
    ).toBe("");
  });

  test("the today-only report keeps its department, never a position", () => {
    expect(
      reportParams(
        filter({
          kind: "induction-operators",
          department: "d-1",
          position: "Operator Dozer",
        })
      ).toString()
    ).toBe("department=d-1");
  });
});
