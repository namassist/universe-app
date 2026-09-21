/**
 * savera's sleep rules, applied by us.
 *
 * The fixtures are savera's own `ftw_sleep_rules` rows as they stood on
 * 2026-09-21, not thresholds typed in by hand: the point of this engine is to
 * give savera's answer, and the only honest test of that is savera's table.
 *
 *   bun --env-file=.env test src/ftw-rules.test.ts
 */

import { describe, expect, test } from "bun:test";

import { categoryOf, ruleSetOf, type SleepRule } from "./ftw-rules";

const rule = (over: Partial<SleepRule>): SleepRule => ({
  code: "X",
  metricKey: "effective_sleep_minutes",
  minMinutes: null,
  minInclusive: true,
  maxMinutes: null,
  maxInclusive: false,
  decisionLabel: "X",
  priority: 99,
  shiftId: null,
  sleepType: "all",
  effectiveFrom: null,
  effectiveTo: null,
  ...over,
});

/** savera's active default rules, 2026-09-21. */
const SAVERA = [
  rule({
    code: "SENT_HOME_LT_430",
    maxMinutes: 270,
    decisionLabel: "Tidak Boleh Bekerja",
    priority: 1,
  }),
  rule({
    code: "REST_2H_430_500",
    minMinutes: 270,
    maxMinutes: 300,
    decisionLabel: "Istirahat Minimal 2 Jam",
    priority: 2,
  }),
  rule({
    code: "REST_1H_500_530",
    minMinutes: 300,
    maxMinutes: 330,
    decisionLabel: "Istirahat Minimal 1 Jam",
    priority: 3,
  }),
  rule({
    code: "CAN_WORK_GTE_530",
    minMinutes: 330,
    decisionLabel: "Dapat Bekerja",
    priority: 4,
  }),
  /* The no-upload rule is about presence, not minutes — a row we have is an
     upload by definition, so it must never decide anything here. */
  rule({
    code: "NO_UPLOAD",
    metricKey: "upload_status",
    decisionLabel: "Tidak Boleh Bekerja",
    priority: 0,
  }),
];

const D = "2026-09-21";
const judge = (minutes: number, rules = SAVERA) => {
  const set = ruleSetOf(rules);
  if (!set) throw new Error("rule set refused");
  return categoryOf(minutes, D, set);
};

describe("savera's thresholds, edge by edge", () => {
  test.each([
    [0, "Tidak Boleh Bekerja"],
    [269, "Tidak Boleh Bekerja"],
    [270, "Istirahat Minimal 2 Jam"],
    [299, "Istirahat Minimal 2 Jam"],
    [300, "Istirahat Minimal 1 Jam"],
    [329, "Istirahat Minimal 1 Jam"],
    [330, "Dapat Bekerja"],
    [600, "Dapat Bekerja"],
  ])("%i minutes reads %s", (minutes, category) => {
    expect(judge(minutes)).toBe(category);
  });

  /* The case that started this (2026-09-21): 8h30 of sleep, and savera's
     own row still read "Tidak Boleh Bekerja" when the board was built. */
  test("8h30 of sleep can work, whatever savera had got round to", () => {
    expect(judge(510)).toBe("Dapat Bekerja");
  });
});

describe("reading the rule rows as savera does", () => {
  test("an inclusive maximum takes its own edge", () => {
    const rules = [
      rule({
        maxMinutes: 300,
        maxInclusive: true,
        decisionLabel: "A",
        priority: 1,
      }),
      rule({ minMinutes: 300, decisionLabel: "B", priority: 2 }),
    ];
    expect(judge(300, rules)).toBe("A");
  });

  test("an exclusive minimum leaves its edge to the rule below", () => {
    const rules = [
      rule({
        maxMinutes: 300,
        maxInclusive: true,
        decisionLabel: "A",
        priority: 1,
      }),
      rule({
        minMinutes: 300,
        minInclusive: false,
        decisionLabel: "B",
        priority: 2,
      }),
    ];
    expect(judge(300, rules)).toBe("A");
    expect(judge(301, rules)).toBe("B");
  });

  test("overlapping rules are settled by priority, lowest first", () => {
    const rules = [
      rule({ minMinutes: 0, decisionLabel: "later", priority: 5 }),
      rule({ minMinutes: 0, decisionLabel: "first", priority: 1 }),
    ];
    expect(judge(100, rules)).toBe("first");
  });

  /* A gap in savera's table is a gap: the category is left empty rather than
     borrowed from a neighbour, and the screen shows no verdict. */
  test("minutes no rule covers have no category", () => {
    const rules = [
      rule({ minMinutes: 0, maxMinutes: 100, decisionLabel: "A", priority: 1 }),
    ];
    expect(judge(200, rules)).toBeNull();
  });

  test("a rule is only in force between its own dates", () => {
    const rules = [
      rule({
        minMinutes: 0,
        decisionLabel: "old",
        priority: 1,
        effectiveTo: "2026-09-20",
      }),
      rule({
        minMinutes: 0,
        decisionLabel: "new",
        priority: 2,
        effectiveFrom: "2026-09-21",
      }),
    ];
    expect(judge(100, rules)).toBe("new");
  });
});

describe("rules we cannot honour", () => {
  /* Refused rather than half-applied: savera would narrow these to a shift or
     a sleep type we have no way to match, and applying them to everybody
     would put a rule on people it was never written for. Refusing hands the
     pass back to savera's own category — today's behaviour — until the
     engine learns the dimension. */
  test("a rule for one shift refuses the whole set", () => {
    expect(
      ruleSetOf([...SAVERA, rule({ shiftId: 3, minMinutes: 0, priority: 9 })])
    ).toBeNull();
  });

  test("a rule for one sleep type refuses the whole set", () => {
    expect(
      ruleSetOf([
        ...SAVERA,
        rule({ sleepType: "night", minMinutes: 0, priority: 9 }),
      ])
    ).toBeNull();
  });

  test("no rules at all refuses rather than judging everybody uncovered", () => {
    expect(ruleSetOf([])).toBeNull();
  });

  /* A rule that matches but names no category would answer "nothing" for a
     person who plainly has a verdict — refused like the others, so the pass
     keeps savera's word instead. */
  test("a rule with no category of its own refuses the whole set", () => {
    expect(
      ruleSetOf([
        ...SAVERA,
        rule({ decisionLabel: null, minMinutes: 0, priority: 9 }),
      ])
    ).toBeNull();
    expect(
      ruleSetOf([
        ...SAVERA,
        rule({ decisionLabel: "  ", minMinutes: 0, priority: 9 }),
      ])
    ).toBeNull();
  });
});
