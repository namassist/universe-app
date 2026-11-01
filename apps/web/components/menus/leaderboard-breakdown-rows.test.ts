import { describe, expect, test } from "bun:test";

import {
  boardHref,
  breakdownHref,
  kindCounts,
  lineReason,
  periodKindOf,
  readBreakdownFilter,
  unitRole,
  type ReasonLine,
} from "./leaderboard-breakdown-rows";

const line = (
  kind: ReasonLine["kind"],
  extra: Partial<ReasonLine> = {}
): ReasonLine => ({
  kind,
  attended: true,
  unitCode: null,
  onBoard: true,
  ...extra,
});

describe("breakdownHref", () => {
  test("the board's period, and its type and department when it has them", () => {
    expect(
      breakdownHref("e1", {
        from: "2026-10-01",
        to: "2026-10-31",
        unitType: "",
        department: "",
      })
    ).toBe("/leaderboard/e1?from=2026-10-01&to=2026-10-31");
    expect(
      breakdownHref("e1", {
        from: "2026-10-01",
        to: "2026-10-31",
        unitType: "t1",
        department: "d1",
      })
    ).toBe(
      "/leaderboard/e1?from=2026-10-01&to=2026-10-31&unitType=t1&department=d1"
    );
  });

  test("reads back to the same filter", () => {
    const filter = {
      from: "2026-10-01",
      to: "2026-10-31",
      unitType: "t1",
      department: "",
    };
    const href = breakdownHref("e1", filter);
    expect(
      readBreakdownFilter(new URLSearchParams(href.split("?")[1]))
    ).toEqual(filter);
  });

  test("an address without a whole period reads none", () => {
    expect(
      readBreakdownFilter(new URLSearchParams("from=2026-10-01"))
    ).toBeNull();
  });
});

describe("lineReason", () => {
  test("a not-ready shift without a tap is a missed attendance", () => {
    expect(lineReason(line("not-ready", { attended: false }))).toBe("noTap");
  });

  test("a not-ready shift with a tap was late or failed FTW", () => {
    expect(lineReason(line("not-ready"))).toBe("lateOrFtw");
  });

  test("seated but not counted: no tap, or FTW not passed", () => {
    expect(lineReason(line("not-counted", { attended: false }))).toBe(
      "seatedNoTap"
    );
    expect(lineReason(line("not-counted"))).toBe("seatedNoFtw");
  });

  test("the scoring lines need no reason", () => {
    expect(lineReason(line("operated"))).toBeNull();
    expect(lineReason(line("off-roster", { attended: null }))).toBeNull();
  });
});

describe("unitRole", () => {
  test("a seat is a unit operated", () => {
    expect(unitRole(line("operated", { unitCode: "DT1" }))).toBe("operated");
    expect(unitRole(line("not-counted", { unitCode: "DT1" }))).toBe("operated");
  });

  test("no seat: the PLAN unit they were there for, or a spare", () => {
    expect(unitRole(line("stood-down", { unitCode: "DT1" }))).toBe("plan");
    expect(unitRole(line("not-ready", { unitCode: "DT1" }))).toBe("plan");
    expect(unitRole(line("stood-down"))).toBe("spare");
  });

  test("an unreadable FTW does not say whether they sat", () => {
    expect(unitRole(line("unreadable", { unitCode: "DT1" }))).toBe("unit");
    expect(unitRole(line("unreadable"))).toBeNull();
  });
});

describe("kindCounts", () => {
  test("outcomes on this board only; roster days whatever the board", () => {
    const counts = kindCounts([
      line("operated"),
      line("operated", { onBoard: false }),
      line("not-ready"),
      line("off-roster", { onBoard: false, attended: null }),
    ]);
    expect(counts.operated).toBe(1);
    expect(counts["not-ready"]).toBe(1);
    expect(counts["off-roster"]).toBe(1);
    expect(counts.unsettled).toBe(0);
  });
});

describe("back to the board", () => {
  test("the board's address carries the same filter", () => {
    expect(
      boardHref({
        from: "2026-10-01",
        to: "2026-10-31",
        unitType: "t1",
        department: "",
      })
    ).toBe("/leaderboard?from=2026-10-01&to=2026-10-31&unitType=t1");
  });

  test("a period reads back as the kind that made it", () => {
    expect(periodKindOf({ from: "2026-10-01", to: "2026-10-31" })).toBe(
      "month"
    );
    /* Monday 26 October to Sunday 1 November. */
    expect(periodKindOf({ from: "2026-10-26", to: "2026-11-01" })).toBe("week");
    expect(periodKindOf({ from: "2026-10-27", to: "2026-11-02" })).toBe(
      "custom"
    );
    expect(periodKindOf({ from: "2026-10-01", to: "2026-10-30" })).toBe(
      "custom"
    );
  });
});
