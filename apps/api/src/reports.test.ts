/**
 * The five reports' rows, from lines already loaded.
 *
 * Pure on purpose: which operator lands on which report is the whole of the
 * feature's judgement, and it deserves tests that need no database to say it.
 */

import { describe, expect, test } from "bun:test";

import type { AuditLine, AuditRow } from "./board-audit";
import {
  equipmentNoOperatorRows,
  finalValidationRows,
  operatorNoEquipmentRows,
  operatorNoFingerRows,
  operatorNoFtwRows,
  type VacantSeat,
} from "./reports";

const DEPTS = new Map([
  ["d-mo", "Mining Operation"],
  ["d-hm", "Hauling"],
]);

function line(
  over: Partial<AuditRow> & Partial<Omit<AuditLine, "row">> = {}
): AuditLine {
  const {
    employeeId = "e-1",
    departmentId = "d-mo",
    positionName = "HD 90-100T Operator",
    rosterCode = "D",
    busCode = null,
    area = null,
    ...row
  } = over;
  return {
    row: {
      fleetLeaderCode: null,
      fleetSupport: false,
      planUnitCode: null,
      nik: "501000001",
      name: "Operator",
      skills: [],
      ftw: "pass",
      sentAt: null,
      finger: "pass",
      tappedAt: "05:01:00",
      actualUnitCode: null,
      decision: "kept",
      ...row,
    },
    employeeId,
    departmentId,
    positionName,
    rosterCode,
    busCode,
    area,
  };
}

describe("Operator No Equipment", () => {
  /*
   * Rostered, tapped in (on time or late), FTW not standing in the way, and
   * no unit (owner, 2026-10-07). Somebody who never tapped is the No Finger
   * report's, and somebody held back by FTW is the No FTW report's.
   */
  test("lists who tapped in and was clear of FTW, yet got no unit", () => {
    const rows = operatorNoEquipmentRows(
      [
        line({ name: "Kept", decision: "kept", actualUnitCode: "DT1" }),
        line({ name: "Seatless", decision: "no-seat" }),
        line({
          name: "Late",
          decision: "not-ready",
          finger: "late",
          tappedAt: "05:40:00",
        }),
        line({
          name: "No FTW needed",
          decision: "no-seat",
          ftw: "not-required",
        }),
        line({
          name: "Never tapped",
          decision: "not-ready",
          finger: "missing",
          tappedAt: null,
        }),
        line({ name: "FTW failed", decision: "not-ready", ftw: "fail" }),
        line({ name: "FTW missing", decision: "not-ready", ftw: "missing" }),
        line({ name: "FTW late", decision: "not-ready", ftw: "late" }),
      ],
      DEPTS
    );
    expect(rows.map((r) => r.name)).toEqual([
      "Late",
      "No FTW needed",
      "Seatless",
    ]);
  });

  test("prints the SIMPER codes they hold as the matrix", () => {
    const [row] = operatorNoEquipmentRows(
      [
        line({
          nik: "50721065",
          name: "Ali Usman",
          positionName: "Excavator 80-150T Operator",
          decision: "no-seat",
          skills: ["EXC 1200", "PC 200"],
        }),
      ],
      DEPTS
    );
    expect(row).toEqual({
      nik: "50721065",
      name: "Ali Usman",
      position: "Excavator 80-150T Operator",
      department: "Mining Operation",
      simperMatrix: "EXC 1200; PC 200",
    });
  });
});

describe("Operator No FTW", () => {
  const readings = new Map([
    [
      "501000001",
      {
        ftwDecision: "FTW Perlu Tindak Lanjut",
        sleepCategory: "Tidak Boleh Bekerja",
      },
    ],
    [
      "501000002",
      {
        ftwDecision: "Belum Mengisi FTW",
        sleepCategory: "Istirahat Minimal 1 Jam",
      },
    ],
    ["501000003", { ftwDecision: "FTW Aman", sleepCategory: "Dapat Bekerja" }],
  ]);

  test("skips a pass and a unit that asks for no FTW", () => {
    const rows = operatorNoFtwRows(
      [line({ ftw: "pass" }), line({ ftw: "not-required" })],
      DEPTS,
      readings
    );
    expect(rows).toEqual([]);
  });

  test("a failed reading reads as savera categorised it", () => {
    const [row] = operatorNoFtwRows(
      [line({ nik: "501000001", name: "Bima", ftw: "fail" })],
      DEPTS,
      readings
    );
    expect(row).toEqual({
      nik: "501000001",
      name: "Bima",
      roster: "D",
      position: "HD 90-100T Operator",
      department: "Mining Operation",
      saveraStatus: "Tidak Boleh Bekerja",
    });
  });

  test("no reading at all, or savera's own 'not filled in', reads Belum FTW", () => {
    const rows = operatorNoFtwRows(
      [
        line({ nik: "509999999", name: "A", ftw: "missing" }),
        line({ nik: "501000002", name: "B", ftw: "fail" }),
      ],
      DEPTS,
      readings
    );
    expect(rows.map((r) => r.saveraStatus)).toEqual(["Belum FTW", "Belum FTW"]);
  });

  test("a late upload says so, with the time it came in", () => {
    const [row] = operatorNoFtwRows(
      [line({ nik: "501000003", ftw: "late", sentAt: "05:41:10" })],
      DEPTS,
      readings
    );
    expect(row!.saveraStatus).toBe("Terlambat FTW (05:41)");
  });

  test("a verdict nobody can read is printed as it arrived", () => {
    const [row] = operatorNoFtwRows(
      [line({ nik: "501000003", ftw: "unreadable" })],
      DEPTS,
      new Map([
        ["501000003", { ftwDecision: "FTW ???", sleepCategory: "Baru" }],
      ])
    );
    expect(row!.saveraStatus).toBe("Baru");
  });

  test("matches a reading whatever leading zeros the register kept", () => {
    const [row] = operatorNoFtwRows(
      [line({ nik: "0501000001", ftw: "fail" })],
      DEPTS,
      readings
    );
    expect(row!.saveraStatus).toBe("Tidak Boleh Bekerja");
  });
});

describe("Operator No Finger", () => {
  test("no tap reads No Finger, a late tap reads its time", () => {
    const rows = operatorNoFingerRows(
      [
        line({ name: "On time", finger: "pass" }),
        line({ name: "Absent", finger: "missing", tappedAt: null }),
        line({ name: "Late", finger: "late", tappedAt: "05:47:12" }),
      ],
      DEPTS
    );
    expect(rows.map((r) => [r.name, r.jamIn])).toEqual([
      ["Absent", "No Finger"],
      ["Late", "05:47"],
    ]);
    expect(rows[0]).toMatchObject({
      roster: "D",
      department: "Mining Operation",
    });
  });
});

describe("Final Validation", () => {
  test("every operator, with their seat — or SPARE and nothing else", () => {
    const rows = finalValidationRows(
      [
        line({
          name: "Placed",
          decision: "substitute",
          actualUnitCode: "EX7011",
          fleetLeaderCode: "EX7011",
          busCode: "UD BU 09",
          area: "KASTURI - KOLAM",
        }),
        line({
          name: "Left over",
          decision: "no-seat",
          /* Their standing formation: not where they worked. */
          fleetLeaderCode: "EX4001",
          departmentId: "d-hm",
        }),
      ],
      DEPTS
    );
    expect(rows).toEqual([
      {
        nik: "501000001",
        name: "Left over",
        position: "HD 90-100T Operator",
        department: "Hauling",
        jamIn: "05:01",
        unit: "SPARE",
        fleet: "",
        bus: "",
        location: "",
      },
      {
        nik: "501000001",
        name: "Placed",
        position: "HD 90-100T Operator",
        department: "Mining Operation",
        jamIn: "05:01",
        unit: "EX7011",
        fleet: "EX7011",
        bus: "UD BU 09",
        location: "KASTURI - KOLAM",
      },
    ]);
  });

  test("the first tap reads as its time, and no tap as No Finger", () => {
    const rows = finalValidationRows(
      [
        line({ name: "A late one", finger: "late", tappedAt: "05:40:12" }),
        line({ name: "B absent", finger: "missing", tappedAt: null }),
      ],
      DEPTS
    );
    expect(rows.map((r) => r.jamIn)).toEqual(["05:40", "No Finger"]);
  });

  test("a support seat names the support group as its fleet", () => {
    const [row] = finalValidationRows(
      [line({ decision: "kept", actualUnitCode: "DZ1", fleetSupport: true })],
      DEPTS
    );
    expect(row!.fleet).toBe("Fleet support");
  });
});

describe("Equipment No Operator", () => {
  const seat = (over: Partial<VacantSeat>): VacantSeat => ({
    unitCode: "RD5023",
    simperCode: "OHT 777",
    leaderCode: "EX7006",
    support: false,
    busCode: "UD BU 23",
    area: "PANEL EAST - TENGAH & UTARA",
    ...over,
  });

  test("names each empty unit by the template's columns", () => {
    expect(equipmentNoOperatorRows([seat({})])).toEqual([
      {
        unit: "RD5023",
        simperCode: "OHT 777",
        fleet: "EX7006",
        bus: "UD BU 23",
        location: "PANEL EAST - TENGAH & UTARA",
      },
    ]);
  });

  test("formations by leader, then support, then no fleet — each by unit", () => {
    const rows = equipmentNoOperatorRows([
      seat({
        unitCode: "MH1002",
        leaderCode: null,
        simperCode: null,
        busCode: null,
      }),
      seat({ unitCode: "DZ1", leaderCode: null, support: true }),
      seat({ unitCode: "RD5060", leaderCode: "EX7003" }),
      seat({ unitCode: "DT5109", leaderCode: "EX7003" }),
      seat({ unitCode: "RD5023", leaderCode: "EX7006" }),
    ]);
    expect(rows.map((r) => [r.unit, r.fleet])).toEqual([
      ["DT5109", "EX7003"],
      ["RD5060", "EX7003"],
      ["RD5023", "EX7006"],
      ["DZ1", "Fleet support"],
      ["MH1002", ""],
    ]);
    expect(rows[4]).toMatchObject({ simperCode: "", bus: "" });
  });
});

describe("person reports read by name", () => {
  test("whatever order the board's audit put them in", () => {
    const rows = operatorNoFingerRows(
      [
        line({ name: "Zul", finger: "missing" }),
        line({ name: "adi", finger: "missing" }),
        line({ name: "Budi", finger: "missing" }),
      ],
      DEPTS
    );
    expect(rows.map((r) => r.name)).toEqual(["adi", "Budi", "Zul"]);
  });
});
