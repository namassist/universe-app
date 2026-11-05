import { describe, expect, test } from "bun:test";

import {
  matchesUnitOption,
  moveItem,
  splitUnitPicks,
  toggleItem,
  unitWallName,
} from "./display-unit-picks";

const option = (
  id: string,
  code: string,
  over: Partial<{
    modelName: string;
    groupKind: "fleet" | "support";
    leaderCode: string | null;
    area: string | null;
  }> = {}
) => ({
  id,
  code,
  modelName: "PC2000",
  groupKind: "fleet" as const,
  leaderCode: "EX4011",
  area: "Pit 3",
  ...over,
});

describe("splitUnitPicks", () => {
  test("keeps pick order and sets aside what Fleet Setting no longer holds", () => {
    const options = [option("a", "EX4011"), option("c", "DT101")];
    expect(splitUnitPicks(["c", "gone", "a"], options)).toEqual({
      live: ["c", "a"],
      stale: ["gone"],
    });
  });

  test("everything is live before the options have loaded", () => {
    /* Not loaded yet is not "gone": flagging every pick while the request
       is in flight would tell the admin the wall is broken. */
    expect(splitUnitPicks(["a", "b"], undefined)).toEqual({
      live: ["a", "b"],
      stale: [],
    });
  });
});

describe("matchesUnitOption", () => {
  const ex = option("a", "EX4011");
  const dz = option("b", "DZ05", {
    modelName: "D375",
    groupKind: "support",
    leaderCode: null,
    area: "Disposal Utara",
  });

  test("an empty search matches everything", () => {
    expect(matchesUnitOption(ex, "  ")).toBe(true);
  });

  test("matches code, model, formation and area, ignoring case", () => {
    expect(matchesUnitOption(ex, "ex40")).toBe(true);
    expect(matchesUnitOption(dz, "d375")).toBe(true);
    expect(matchesUnitOption(ex, "pit 3")).toBe(true);
    expect(matchesUnitOption(dz, "utara")).toBe(true);
    expect(matchesUnitOption(dz, "ex4011")).toBe(false);
  });

  test("support is searchable by name", () => {
    expect(matchesUnitOption(dz, "support")).toBe(true);
    expect(matchesUnitOption(ex, "support")).toBe(false);
  });
});

describe("toggleItem and moveItem", () => {
  test("ticking appends, so the order picked is the order shown", () => {
    expect(toggleItem(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleItem(["a", "b"], "a")).toEqual(["b"]);
  });

  test("moves one step and stops at the ends", () => {
    expect(moveItem(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    const first = ["a", "b"];
    expect(moveItem(first, "a", -1)).toBe(first);
    expect(moveItem(first, "z", 1)).toBe(first);
  });
});

describe("unitWallName", () => {
  const codes = new Map([
    ["a", "EX4011"],
    ["b", "DT101"],
  ]);

  test("names a wall left unnamed after its first unit", () => {
    expect(unitWallName(["a"], codes)).toBe("Unit EX4011");
    expect(unitWallName(["a", "b"], codes)).toBe("Unit EX4011 +1");
  });

  test("gives no name when the first pick is unknown", () => {
    expect(unitWallName(["gone"], codes)).toBeNull();
    expect(unitWallName([], codes)).toBeNull();
  });
});
