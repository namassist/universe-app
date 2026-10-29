import { describe, expect, test } from "bun:test";

import { matchesStatus, statusCounts, type UnitFacts } from "./status-filter";

const unit = (over: Partial<UnitFacts> = {}): UnitFacts => ({
  allocated: false,
  vacant: false,
  clash: false,
  issue: false,
  ...over,
});

describe("matchesStatus", () => {
  test("all lets every unit through", () => {
    expect(matchesStatus("all", unit())).toBe(true);
    expect(matchesStatus("all", unit({ allocated: true, issue: true }))).toBe(
      true
    );
  });

  test("allocated and unallocated split on whether anyone is paired", () => {
    expect(matchesStatus("alloc", unit({ allocated: true }))).toBe(true);
    expect(matchesStatus("alloc", unit())).toBe(false);
    expect(matchesStatus("unalloc", unit())).toBe(true);
    expect(matchesStatus("unalloc", unit({ allocated: true }))).toBe(false);
  });

  test("vacant, clash and issue each follow their own fact", () => {
    expect(matchesStatus("vacant", unit({ vacant: true }))).toBe(true);
    expect(matchesStatus("vacant", unit({ allocated: true }))).toBe(false);
    expect(matchesStatus("clash", unit({ clash: true }))).toBe(true);
    expect(matchesStatus("clash", unit({ vacant: true }))).toBe(false);
    expect(matchesStatus("issue", unit({ issue: true }))).toBe(true);
    expect(matchesStatus("issue", unit({ clash: true }))).toBe(false);
  });
});

describe("statusCounts", () => {
  test("counts each segment as the number of cards its click would show", () => {
    const units = [
      unit({ allocated: true }),
      unit({ allocated: true, clash: true }),
      unit({ vacant: true }),
      unit({ vacant: true, issue: true }),
    ];
    expect(
      statusCounts(units, [
        "all",
        "unalloc",
        "alloc",
        "vacant",
        "clash",
        "issue",
      ])
    ).toEqual({ all: 4, unalloc: 2, alloc: 2, vacant: 2, clash: 1, issue: 1 });
  });

  test("an empty view counts zero everywhere asked", () => {
    expect(statusCounts([], ["all", "issue"])).toEqual({ all: 0, issue: 0 });
  });
});
