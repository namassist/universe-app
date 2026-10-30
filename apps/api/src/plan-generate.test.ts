import { describe, expect, test } from "bun:test";
import type { RosterCode } from "@universe/contracts";

import {
  generateShiftAt,
  generateToken,
  planGenerate,
  type GenerateHolder,
  type GenerateSpare,
  type GenerateUnit,
} from "./plan-generate";

const TODAY = "2026-10-30";

const unit = (
  code: string,
  over: Partial<GenerateUnit> = {}
): GenerateUnit => ({
  id: `u-${code}`,
  code,
  simperCodeId: "s-exc",
  simperCodeName: "EXC 1200",
  departmentId: null,
  departmentName: null,
  priority: null,
  holders: [],
  ...over,
});

const holder = (
  nik: string,
  rosterCode: RosterCode | null,
  status: GenerateHolder["status"] = "aktif"
): GenerateHolder => ({
  employeeId: `e-${nik}`,
  nik,
  name: `Holder ${nik}`,
  status,
  rosterCode,
});

const spare = (
  nik: string,
  over: Partial<GenerateSpare> = {}
): GenerateSpare => ({
  id: `e-${nik}`,
  nik,
  name: `Spare ${nik}`,
  statusValue: "aktif",
  departmentId: "d-1",
  simperExp: null,
  positionName: "Operator",
  fleetAllocation: true,
  rosterCode: "D",
  simperCodeIds: new Set(["s-exc"]),
  ...over,
});

const run = (
  units: GenerateUnit[],
  spares: GenerateSpare[],
  shift: "day" | "night" = "day"
) => planGenerate({ units, spares, shift, today: TODAY });

describe("generateShiftAt", () => {
  test("before noon is the day shift, from midnight on", () => {
    expect(generateShiftAt(new Date(2026, 9, 30, 0, 0))).toBe("day");
    expect(generateShiftAt(new Date(2026, 9, 30, 11, 59))).toBe("day");
  });

  test("noon onwards is the night shift", () => {
    expect(generateShiftAt(new Date(2026, 9, 30, 12, 0))).toBe("night");
    expect(generateShiftAt(new Date(2026, 9, 30, 23, 59))).toBe("night");
  });
});

describe("planGenerate — which units are empty", () => {
  test("a unit whose aktif holder works the shift is left alone", () => {
    const out = run(
      [unit("EX1", { holders: [holder("1", "D")] })],
      [spare("9")]
    );
    expect(out.assign).toEqual([]);
    expect(out.unfilled).toEqual([]);
    expect(out.sparesLeft).toBe(1);
  });

  test("a holder on leave leaves the unit empty and a spare takes it", () => {
    const out = run(
      [unit("EX1", { holders: [holder("1", "CR")] })],
      [spare("9")]
    );
    expect(out.assign).toHaveLength(1);
    expect(out.assign[0]).toMatchObject({
      unitId: "u-EX1",
      unit: "EX1",
      employeeId: "e-9",
      nik: "9",
      released: null,
    });
  });

  test("a standby holder rostered on the shift does not fill the seat", () => {
    const out = run(
      [unit("EX1", { holders: [holder("1", "D", "standby")] })],
      [spare("9")]
    );
    expect(out.assign.map((a) => a.nik)).toEqual(["9"]);
  });

  test("on the night shift a day holder leaves the unit empty", () => {
    const out = run(
      [unit("EX1", { holders: [holder("1", "D")] })],
      [spare("9", { rosterCode: "N" })],
      "night"
    );
    expect(out.assign.map((a) => a.nik)).toEqual(["9"]);
  });
});

describe("planGenerate — who may be a spare", () => {
  test("only spares rostered to the shift are used", () => {
    const out = run(
      [unit("EX1")],
      [
        spare("1", { rosterCode: "N" }),
        spare("2", { rosterCode: "OFF" }),
        spare("3", { rosterCode: null }),
      ]
    );
    expect(out.assign).toEqual([]);
    expect(out.unfilled.map((u) => u.unit)).toEqual(["EX1"]);
    expect(out.sparesLeft).toBe(0);
  });

  test("standby and nonaktif operators are never assigned", () => {
    const out = run(
      [unit("EX1")],
      [
        spare("1", { statusValue: "standby" }),
        spare("2", { statusValue: "nonaktif" }),
      ]
    );
    expect(out.assign).toEqual([]);
  });

  test("the spare must hold the unit's SIMPER code", () => {
    const out = run(
      [unit("EX1")],
      [spare("1", { simperCodeIds: new Set(["s-dt"]) }), spare("2")]
    );
    expect(out.assign.map((a) => a.nik)).toEqual(["2"]);
  });

  test("an expired SIMPER is refused", () => {
    const out = run([unit("EX1")], [spare("1", { simperExp: "2026-10-29" })]);
    expect(out.assign).toEqual([]);
  });

  test("a department-owned unit takes only that department", () => {
    const out = run(
      [unit("EX1", { departmentId: "d-2", departmentName: "Hauling" })],
      [spare("1"), spare("2", { departmentId: "d-2" })]
    );
    expect(out.assign.map((a) => a.nik)).toEqual(["2"]);
  });

  test("a unit with no SIMPER code takes any eligible spare", () => {
    const out = run(
      [unit("LV1", { simperCodeId: null, simperCodeName: null })],
      [spare("1", { simperCodeIds: new Set() })]
    );
    expect(out.assign.map((a) => a.nik)).toEqual(["1"]);
  });
});

describe("planGenerate — priority", () => {
  test("a spare who fits both goes to the higher-ranked unit", () => {
    const out = run(
      [unit("EX5001", { priority: 3 }), unit("EX6001", { priority: 2 })],
      [spare("1")]
    );
    expect(out.assign.map((a) => a.unit)).toEqual(["EX6001"]);
    expect(out.unfilled.map((u) => u.unit)).toEqual(["EX5001"]);
  });

  test("unranked units come after every ranked one", () => {
    const out = run([unit("EX1"), unit("EX2", { priority: 40 })], [spare("1")]);
    expect(out.assign.map((a) => a.unit)).toEqual(["EX2"]);
  });

  test("ties keep the given (register) order", () => {
    const out = run(
      [unit("EX9", { priority: 1 }), unit("EX1", { priority: 1 })],
      [spare("1")]
    );
    expect(out.assign.map((a) => a.unit)).toEqual(["EX9"]);
  });

  test("spares are offered by NIK, each used once", () => {
    const out = run(
      [unit("EX1", { priority: 1 }), unit("EX2", { priority: 2 })],
      [spare("30"), spare("10"), spare("20")]
    );
    expect(out.assign.map((a) => [a.unit, a.nik])).toEqual([
      ["EX1", "10"],
      ["EX2", "20"],
    ]);
    expect(out.sparesLeft).toBe(1);
  });

  test("the same input gives the same answer", () => {
    const units = [unit("EX1"), unit("EX2", { priority: 1 })];
    const spares = [spare("2"), spare("1")];
    expect(run(units, spares)).toEqual(run(units, spares));
  });
});

describe("planGenerate — a full unit gives up a seat", () => {
  test("a unit with one holder keeps them", () => {
    const out = run(
      [unit("EX1", { holders: [holder("1", "N")] })],
      [spare("9")]
    );
    expect(out.assign[0]!.released).toBeNull();
  });

  test("of two, the one not working today goes before the other shift", () => {
    const out = run(
      [unit("EX1", { holders: [holder("1", "N"), holder("2", "CR")] })],
      [spare("9")]
    );
    expect(out.assign[0]!.released).toEqual({
      employeeId: "e-2",
      nik: "2",
      name: "Holder 2",
      rosterCode: "CR",
      standby: false,
    });
  });

  test("a standby holder goes before one on leave", () => {
    const out = run(
      [
        unit("EX1", {
          holders: [holder("1", "CR"), holder("2", "N", "standby")],
        }),
      ],
      [spare("9")]
    );
    expect(out.assign[0]!.released).toMatchObject({ nik: "2", standby: true });
  });

  test("an unknown roster counts as not working today", () => {
    const out = run(
      [unit("EX1", { holders: [holder("1", "N"), holder("2", null)] })],
      [spare("9")]
    );
    expect(out.assign[0]!.released?.nik).toBe("2");
  });

  test("ties fall to the lower NIK", () => {
    const out = run(
      [unit("EX1", { holders: [holder("7", "CR"), holder("3", "OFF")] })],
      [spare("9")]
    );
    expect(out.assign[0]!.released?.nik).toBe("3");
  });

  test("nobody is released when no spare fits", () => {
    const out = run(
      [unit("EX1", { holders: [holder("1", "N"), holder("2", "CR")] })],
      [spare("9", { simperCodeIds: new Set() })]
    );
    expect(out.assign).toEqual([]);
    expect(out.unfilled).toEqual([
      { unitId: "u-EX1", unit: "EX1", simperCode: "EXC 1200", priority: null },
    ]);
  });
});

describe("planGenerate — holders who cannot drive", () => {
  test("a nonaktif holder is released before one on leave", () => {
    const out = run(
      [
        unit("EX1", {
          holders: [holder("1", "CR"), holder("2", "D", "nonaktif")],
        }),
      ],
      [spare("9")]
    );
    expect(out.assign[0]!.released?.nik).toBe("2");
  });

  test("an aktif holder on the shift keeps the unit beside a standby one", () => {
    const out = run(
      [
        unit("EX1", {
          holders: [holder("1", "D", "standby"), holder("2", "D")],
        }),
      ],
      [spare("9")]
    );
    expect(out.assign).toEqual([]);
    expect(out.unfilled).toEqual([]);
  });
});

describe("generateToken", () => {
  const units = [unit("EX1"), unit("EX2", { priority: 1 })];

  test("the same outcome gives the same token", () => {
    expect(generateToken(run(units, [spare("1")]))).toBe(
      generateToken(run(units, [spare("1")]))
    );
  });

  test("a different spare or a different release changes it", () => {
    const base = generateToken(run(units, [spare("1")]));
    expect(generateToken(run(units, [spare("2")]))).not.toBe(base);
    const full = [
      unit("EX2", {
        priority: 1,
        holders: [holder("5", "CR"), holder("6", "N")],
      }),
    ];
    const fullOther = [
      unit("EX2", {
        priority: 1,
        holders: [holder("4", "CR"), holder("6", "N")],
      }),
    ];
    expect(generateToken(run(full, [spare("1")]))).not.toBe(
      generateToken(run(fullOther, [spare("1")]))
    );
  });
});
