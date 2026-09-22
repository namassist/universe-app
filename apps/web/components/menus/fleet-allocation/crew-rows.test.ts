/**
 * The crew table's row order, without a browser.
 *
 *   cd apps/web && bun test components/menus/fleet-allocation/crew-rows.test.ts
 */

import { describe, expect, test } from "bun:test";

import type { PlanBoard } from "@/lib/queries/fleet-allocation";

import { crewRows } from "./crew-table";

type BoardUnitIn = PlanBoard["units"][number];

const unit = (
  code: string,
  group: { leader: string } | "support" | "none"
): BoardUnitIn =>
  ({
    code,
    status: "ready",
    fleet:
      typeof group === "object"
        ? { id: `f-${group.leader}`, leaderCode: group.leader }
        : null,
    fleetSupport: group === "support",
    slots: [],
  }) as unknown as BoardUnitIn;

const spare = (name: string) => ({
  nik: `N-${name}`,
  name,
  departmentName: "D",
  skills: [],
  rosterCode: null,
});

const board = (units: BoardUnitIn[], spares = [spare("Zed"), spare("Ari")]) =>
  ({
    date: "2026-09-22",
    fleets: [],
    units,
    spares,
  }) as unknown as PlanBoard;

describe("the order of the crew table", () => {
  test("formations first, then fleet support, then no fleet, then spares", () => {
    const rows = crewRows(
      board([
        unit("WT0001", "none"),
        unit("DZ0001", "support"),
        unit("DT4018", { leader: "EX8001" }),
        unit("DT4017", { leader: "EX7001" }),
        unit("DT4014", { leader: "EX8001" }),
        unit("AA0001", "none"),
      ])
    );

    expect(rows.map((r) => r.unitCode ?? `spare:${r.crew[0]!.name}`)).toEqual([
      "DT4017", // Fleet EX7001
      "DT4014", // Fleet EX8001, by unit code
      "DT4018",
      "DZ0001", // Fleet support
      "AA0001", // No fleet, by unit code
      "WT0001",
      "spare:Ari", // spares by name
      "spare:Zed",
    ]);
  });
});
