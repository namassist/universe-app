/**
 * One operator's period, shift by shift: the ledger's settled rows merged with
 * the roster days the ledger has none for, and the sums the board shows for
 * the same person.
 *
 *   bun test src/leaderboard-breakdown.test.ts
 */

import { describe, expect, test } from "bun:test";

import {
  breakdown,
  homeType,
  type LedgerLine,
  type RosterLine,
} from "./leaderboard-breakdown";

const DUMP = "type-dump";
const EXCA = "type-exca";

const ledger = (
  date: string,
  outcome: LedgerLine["outcome"],
  total: number,
  extra: Partial<LedgerLine> = {}
): LedgerLine => ({
  date,
  shift: "day",
  outcome,
  unitCode: null,
  unitTypeId: null,
  base: outcome === "not-ready" ? -15 : total === 0 ? 0 : 10,
  onTime: 0,
  sleep: 0,
  streakBonus: 0,
  total,
  streak: 1,
  attended: true,
  sleepMinutes: null,
  ...extra,
});

const roster = (date: string, code: RosterLine["code"]): RosterLine => ({
  date,
  code,
});

const TODAY = "2026-11-30";

describe("homeType", () => {
  test("the type operated most, counting operated shifts only", () => {
    expect(
      homeType([
        ledger("2026-11-01", "operated", 10, { unitTypeId: DUMP }),
        ledger("2026-11-02", "not-ready", -15, { unitTypeId: EXCA }),
        ledger("2026-11-03", "not-ready", -15, { unitTypeId: EXCA }),
      ])
    ).toBe(DUMP);
  });

  test("a tie goes to the type operated last", () => {
    expect(
      homeType([
        ledger("2026-11-01", "operated", 10, { unitTypeId: DUMP }),
        ledger("2026-11-04", "operated", 10, { unitTypeId: EXCA }),
      ])
    ).toBe(EXCA);
  });

  test("nobody's home when nothing was operated", () => {
    expect(homeType([ledger("2026-11-01", "stood-down", 10)])).toBeNull();
  });
});

describe("breakdown lines", () => {
  test("settled shifts and roster days, in date order, day before night", () => {
    const result = breakdown({
      ledger: [
        ledger("2026-11-02", "operated", 12, { shift: "night" }),
        ledger("2026-11-02", "operated", 15),
      ],
      roster: [
        roster("2026-11-01", "OFF"),
        roster("2026-11-02", "D"),
        roster("2026-11-03", "N"),
      ],
      unitType: null,
      today: TODAY,
    });
    expect(result.lines.map((l) => [l.date, l.shift, l.kind])).toEqual([
      ["2026-11-01", null, "off-roster"],
      ["2026-11-02", "day", "operated"],
      ["2026-11-02", "night", "operated"],
      ["2026-11-03", "night", "unsettled"],
    ]);
  });

  test("an off-roster day keeps its roster code and leaves the streak alone", () => {
    const [line] = breakdown({
      ledger: [],
      roster: [roster("2026-11-01", "CR")],
      unitType: null,
      today: TODAY,
    }).lines;
    expect(line).toMatchObject({
      kind: "off-roster",
      rosterCode: "CR",
      total: 0,
      streak: null,
      onBoard: false,
    });
  });

  test("a settled date drops its roster line, whatever the roster now says", () => {
    const { lines } = breakdown({
      ledger: [ledger("2026-11-01", "operated", 10)],
      roster: [roster("2026-11-01", "OFF")],
      unitType: null,
      today: TODAY,
    });
    expect(lines.map((l) => l.kind)).toEqual(["operated"]);
  });

  test("one roster line a date, even across two departments' documents", () => {
    /* Transferred mid-month: both departments' rosters carry the day. */
    const { lines } = breakdown({
      ledger: [],
      roster: [roster("2026-11-01", "OFF"), roster("2026-11-01", "D")],
      unitType: null,
      today: TODAY,
    });
    expect(lines.map((l) => l.rosterCode)).toEqual(["OFF"]);
  });

  test("roster days after today are not listed", () => {
    const { lines } = breakdown({
      ledger: [],
      roster: [roster("2026-11-30", "D"), roster("2026-12-01", "OFF")],
      unitType: null,
      today: TODAY,
    });
    expect(lines.map((l) => l.date)).toEqual(["2026-11-30"]);
  });

  test("a running total adds only the board's lines", () => {
    const { lines } = breakdown({
      ledger: [
        ledger("2026-11-01", "operated", 15, { unitTypeId: DUMP }),
        ledger("2026-11-02", "operated", 17, { unitTypeId: EXCA }),
        ledger("2026-11-03", "not-ready", -15, { unitTypeId: DUMP }),
      ],
      roster: [roster("2026-11-04", "OFF")],
      unitType: DUMP,
      today: TODAY,
    });
    expect(lines.map((l) => [l.onBoard, l.running])).toEqual([
      [true, 15],
      [false, 15],
      [true, 0],
      [false, 0],
    ]);
  });
});

describe("breakdown sums", () => {
  const shifts = [
    ledger("2026-11-01", "operated", 15, { unitTypeId: DUMP, streak: 1 }),
    ledger("2026-11-02", "operated", 17, { unitTypeId: EXCA, streak: 2 }),
    ledger("2026-11-03", "not-ready", -15, { unitTypeId: DUMP, streak: 0 }),
    /* A spare's stand-down: untyped, so it counts on the home type. */
    ledger("2026-11-04", "stood-down", 25, { streak: 1 }),
  ];

  test("the site's board: every shift", () => {
    expect(
      breakdown({ ledger: shifts, roster: [], unitType: null, today: TODAY })
    ).toMatchObject({ total: 42, penalty: -15, counted: 3, streak: 1 });
  });

  test("a type's board: its shifts and the untyped ones it is home to", () => {
    /* Dump and exca tie on one operated shift each; exca was driven last. */
    expect(
      breakdown({ ledger: shifts, roster: [], unitType: EXCA, today: TODAY })
    ).toMatchObject({ total: 42, penalty: 0, counted: 2, streak: 1 });
    expect(
      breakdown({ ledger: shifts, roster: [], unitType: DUMP, today: TODAY })
    ).toMatchObject({ total: 0, penalty: -15, counted: 1 });
  });

  test("the streak is the person's last settled shift, on any type", () => {
    const result = breakdown({
      ledger: [
        ledger("2026-11-01", "operated", 10, { unitTypeId: DUMP, streak: 4 }),
        ledger("2026-11-02", "operated", 10, { unitTypeId: EXCA, streak: 5 }),
      ],
      roster: [roster("2026-11-03", "OFF")],
      unitType: DUMP,
      today: TODAY,
    });
    expect(result.streak).toBe(5);
  });

  test("no settled shift: nothing summed, no run", () => {
    expect(
      breakdown({
        ledger: [],
        roster: [roster("2026-11-01", "D")],
        unitType: null,
        today: TODAY,
      })
    ).toMatchObject({ total: 0, penalty: 0, counted: 0, streak: 0 });
  });
});
