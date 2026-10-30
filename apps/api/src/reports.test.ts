/**
 * The six reports' rows, from lines already loaded.
 *
 * Pure on purpose: which operator lands on which report is the whole of the
 * feature's judgement, and it deserves tests that need no database to say it.
 */

import { describe, expect, test } from "bun:test";

import type { AuditLine, AuditRow } from "./board-audit";
import {
  equipmentNoOperatorRows,
  finalValidationRows,
  inductionOperatorRows,
  narrowToPosition,
  operatorNoEquipmentRows,
  operatorNoFingerRows,
  operatorNoFtwRows,
  type InductionHolder,
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

  test("only people who tapped in — on time or late — are listed", () => {
    // Owner, 2026-10-09: the report is about who came and could not work,
    // so someone with no IN tap at all belongs on Operator No Finger instead.
    const rows = operatorNoFtwRows(
      [
        line({
          nik: "509000001",
          name: "Absen",
          ftw: "missing",
          finger: "missing",
        }),
        line({
          nik: "509000002",
          name: "Tepat",
          ftw: "missing",
          finger: "pass",
        }),
        line({ nik: "509000003", name: "Telat", ftw: "fail", finger: "late" }),
      ],
      DEPTS,
      readings
    );
    // Sorted by name, as every person report is.
    expect(rows.map((r) => r.name)).toEqual(["Telat", "Tepat"]);
  });

  test("a late FTW upload still counts as not passed for someone who tapped", () => {
    const rows = operatorNoFtwRows(
      [
        line({
          nik: "501000003",
          ftw: "late",
          sentAt: "05:41:10",
          finger: "late",
        }),
      ],
      DEPTS,
      readings
    );
    expect(rows.map((r) => r.saveraStatus)).toEqual(["Terlambat FTW (05:41)"]);
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

  test("the first tap reads as its time, late or not", () => {
    const rows = finalValidationRows(
      [line({ name: "A late one", finger: "late", tappedAt: "05:40:12" })],
      DEPTS
    );
    expect(rows.map((r) => r.jamIn)).toEqual(["05:40"]);
  });

  /*
   * Somebody who never tapped and holds no seat did not take part in the
   * muster, so the final result leaves them out (owner, 2026-10-11) — the
   * Operator No Finger report is where they are listed. A late tap is still
   * an arrival and stays.
   */
  test("leaves out whoever never tapped and holds no seat", () => {
    const rows = finalValidationRows(
      [
        line({ name: "A late one", finger: "late", tappedAt: "05:40:12" }),
        line({ name: "B absent", finger: "missing", tappedAt: null }),
      ],
      DEPTS
    );
    expect(rows.map((r) => r.name)).toEqual(["A late one"]);
  });

  /* Placed by hand without a tap: he holds a unit on the board, so the
     report must agree with the board. */
  test("keeps somebody placed on a unit even with no tap", () => {
    const rows = finalValidationRows(
      [
        line({
          name: "C placed by hand",
          finger: "missing",
          tappedAt: null,
          decision: "kept",
          actualUnitCode: "DT4026",
        }),
      ],
      DEPTS
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.jamIn).toBe("No Finger");
    expect(rows[0]!.unit).toBe("DT4026");
  });

  test("a support seat names the support group as its fleet", () => {
    const [row] = finalValidationRows(
      [line({ decision: "kept", actualUnitCode: "DZ1", fleetSupport: true })],
      DEPTS
    );
    expect(row!.fleet).toBe("Fleet support");
  });
});

describe("narrowing a report to one position", () => {
  const rows = [
    { name: "A", position: "HD 90-100T Operator" },
    { name: "B", position: "Dozer Operator" },
    { name: "C", position: "HD 90-100T Operator" },
    { name: "D", position: "" },
  ];

  test("offers every position the rows hold, once each, in order", () => {
    expect(narrowToPosition(rows, null).positions).toEqual([
      "Dozer Operator",
      "HD 90-100T Operator",
    ]);
  });

  test("keeps only the rows in the position chosen", () => {
    const { rows: kept } = narrowToPosition(rows, "HD 90-100T Operator");
    expect(kept.map((r) => r.name)).toEqual(["A", "C"]);
  });

  /* The choices are read before the narrowing: picking one must not make
     the others vanish from the list. */
  test("still offers every position once one is chosen", () => {
    expect(narrowToPosition(rows, "Dozer Operator").positions).toHaveLength(2);
  });

  test("no position chosen keeps every row", () => {
    expect(narrowToPosition(rows, null).rows).toHaveLength(4);
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

describe("Induction Operators", () => {
  const holder = (over: Partial<InductionHolder> = {}): InductionHolder => ({
    nik: "507231085",
    name: "Danang Arifin",
    position: "Operator Dozer",
    departmentId: "d-mo",
    ...over,
  });

  test("prints the template's columns, ROSTER always IN, KETERANGAN blank", () => {
    const rows = inductionOperatorRows(
      [holder()],
      DEPTS,
      new Map([
        [
          "507231085",
          { ftwDecision: "FTW aman", sleepCategory: "Dapat Bekerja" },
        ],
      ])
    );
    expect(rows).toEqual([
      {
        nik: "507231085",
        name: "Danang Arifin",
        position: "Operator Dozer",
        roster: "IN",
        department: "Mining Operation",
        sleepStatus: "Dapat Bekerja",
        remarks: "",
      },
    ]);
  });

  test("JAM TIDUR is the sleep category, as Universe worked it out", () => {
    const [row] = inductionOperatorRows(
      [holder()],
      DEPTS,
      new Map([
        [
          "507231085",
          {
            ftwDecision: "FTW tidak aman",
            sleepCategory: " Istirahat Minimal 2 Jam ",
          },
        ],
      ])
    );
    expect(row!.sleepStatus).toBe("Istirahat Minimal 2 Jam");
  });

  test("no reading, savera's 'not filled in', or no category reads Belum FTW", () => {
    const rows = inductionOperatorRows(
      [
        holder({ nik: "1", name: "A" }),
        holder({ nik: "2", name: "B" }),
        holder({ nik: "3", name: "C" }),
      ],
      DEPTS,
      new Map([
        [
          "2",
          { ftwDecision: "Belum mengisi FTW", sleepCategory: "Dapat Bekerja" },
        ],
        ["3", { ftwDecision: "FTW aman", sleepCategory: null }],
      ])
    );
    expect(rows.map((r) => r.sleepStatus)).toEqual([
      "Belum FTW",
      "Belum FTW",
      "Belum FTW",
    ]);
  });

  test("matches a reading whatever leading zeros the register kept", () => {
    const [row] = inductionOperatorRows(
      [holder({ nik: "0501241668" })],
      DEPTS,
      new Map([
        [
          "501241668",
          { ftwDecision: "FTW aman", sleepCategory: "Istirahat Minimal 1 Jam" },
        ],
      ])
    );
    expect(row!.sleepStatus).toBe("Istirahat Minimal 1 Jam");
  });

  test("reads by name, and a missing position or department prints blank", () => {
    const rows = inductionOperatorRows(
      [
        holder({ name: "robinson Sumbayak", nik: "1" }),
        holder({ name: "Laban Tangkelangan", nik: "2", position: null }),
        holder({ name: "Darma Yanto Kendek", nik: "3", departmentId: null }),
      ],
      DEPTS,
      new Map()
    );
    expect(rows.map((r) => r.name)).toEqual([
      "Darma Yanto Kendek",
      "Laban Tangkelangan",
      "robinson Sumbayak",
    ]);
    expect(rows[1]!.position).toBe("");
    expect(rows[0]!.department).toBe("");
  });
});
