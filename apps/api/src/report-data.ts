/**
 * Loads what `reports.ts` builds from: the board's audit lines, the empty
 * seats, today's induction holds, savera's texts, and the department names
 * they print.
 *
 * The department filter is applied to ids here, after scope has already been
 * decided by the route — this module takes the department it is given and
 * never widens it.
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { ReportKind, ReportRow, ShiftKind } from "@universe/contracts";

import { boardAudit, type AuditLine } from "./board-audit";
import { db, schema } from "./db";
import {
  equipmentNoOperatorRows,
  finalValidationRows,
  inductionOperatorRows,
  narrowToPosition,
  operatorNoEquipmentRows,
  operatorNoFingerRows,
  operatorNoFtwRows,
  type FtwText,
  type InductionHolder,
  type VacantSeat,
} from "./reports";
import { normalizeNik } from "./sources/nik";

export type ReportData =
  /** The timeline names no deadline for this shift, so nobody can be judged. */
  | { kind: "no-deadline" }
  | {
      kind: "ok";
      boardGenerated: boolean;
      rows: ReportRow[];
      /** The positions the rows hold, read before any narrowing to one. */
      positions: string[];
    };

async function departmentNames(): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: schema.departments.id, name: schema.departments.name })
    .from(schema.departments);
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** normalized NIK → savera's texts, for the NIKs given. */
async function ftwTexts(
  date: string,
  niks: string[]
): Promise<Map<string, FtwText>> {
  if (!niks.length) return new Map();
  const rows = await db
    .select({
      nik: schema.ftwReadings.nik,
      ftwDecision: schema.ftwReadings.ftwDecision,
      sleepCategory: schema.ftwReadings.sleepCategory,
    })
    .from(schema.ftwReadings)
    .where(
      and(
        eq(schema.ftwReadings.date, date),
        inArray(schema.ftwReadings.nik, niks)
      )
    );
  return new Map(rows.map((r) => [r.nik, r]));
}

/**
 * The board's empty seats, or null when the board was never built.
 *
 * A unit with no department is the whole site's, so it is listed only when no
 * department was asked for — naming it on one department's sheet would claim
 * that department owns it.
 */
async function vacantSeats(
  date: string,
  shift: ShiftKind,
  departmentId: string | null
): Promise<VacantSeat[] | null> {
  const [doc] = await db
    .select({ id: schema.fleetActualDocuments.id })
    .from(schema.fleetActualDocuments)
    .where(
      and(
        eq(schema.fleetActualDocuments.date, date),
        eq(schema.fleetActualDocuments.shift, shift)
      )
    )
    .limit(1);
  if (!doc) return null;

  const rows = await db
    .select({
      unitCode: schema.units.code,
      simperCode: schema.simperCodes.name,
      leaderCode: schema.fleetActualFleets.leaderCode,
      groupKind: schema.fleetActualFleets.kind,
      busCode: schema.fleetActualSlots.transportCode,
      fleetArea: schema.fleetActualFleets.workArea,
      unitArea: schema.fleetActualSlots.workArea,
    })
    .from(schema.fleetActualSlots)
    .innerJoin(
      schema.units,
      eq(schema.units.id, schema.fleetActualSlots.unitId)
    )
    .leftJoin(
      schema.simperCodes,
      eq(schema.simperCodes.id, schema.units.simperCodeId)
    )
    /* The board's own copy of its formations, as every other reader of a
       board uses — Fleet Setting may have been rewritten since. */
    .leftJoin(
      schema.fleetActualFleets,
      eq(schema.fleetActualFleets.id, schema.fleetActualSlots.boardFleetId)
    )
    .where(
      and(
        eq(schema.fleetActualSlots.documentId, doc.id),
        isNull(schema.fleetActualSlots.employeeId),
        departmentId ? eq(schema.units.departmentId, departmentId) : undefined
      )
    )
    .orderBy(asc(schema.units.code));

  return rows.map((r) => ({
    unitCode: r.unitCode,
    simperCode: r.simperCode,
    leaderCode: r.leaderCode,
    support: r.groupKind === "support",
    busCode: r.busCode,
    area: r.fleetArea ?? r.unitArea,
  }));
}

/** The reports read for one date and one shift. */
export type ShiftReportKind = Exclude<ReportKind, "induction-operators">;

/** The four reports about people, from the board's audit lines. */
async function personRows(
  kind: Exclude<ShiftReportKind, "equipment-no-operator">,
  date: string,
  boardGenerated: boolean,
  lines: AuditLine[]
): Promise<ReportRow[]> {
  const departments = await departmentNames();
  switch (kind) {
    /* Nobody was placed on a board that does not exist, and listing the whole
       roster as unplaced would read as a disaster that did not happen. */
    case "operator-no-equipment":
      return boardGenerated ? operatorNoEquipmentRows(lines, departments) : [];
    case "final-validation":
      return boardGenerated ? finalValidationRows(lines, departments) : [];
    case "operator-no-finger":
      return operatorNoFingerRows(lines, departments);
    case "operator-no-ftw": {
      const failed = lines
        .filter((l) => l.row.ftw !== "pass" && l.row.ftw !== "not-required")
        .map((l) => normalizeNik(l.row.nik));
      return operatorNoFtwRows(
        lines,
        departments,
        await ftwTexts(date, failed)
      );
    }
  }
}

/**
 * One report's rows for a date and shift, narrowed to a department when one is
 * given, and to a position when one is (owner, 2026-10-11 — the people
 * reports only; a unit has no position).
 */
export async function loadReport(
  kind: ShiftReportKind,
  date: string,
  shift: ShiftKind,
  departmentId: string | null,
  position: string | null = null
): Promise<ReportData> {
  if (kind === "equipment-no-operator") {
    const seats = await vacantSeats(date, shift, departmentId);
    return {
      kind: "ok",
      boardGenerated: seats !== null,
      rows: equipmentNoOperatorRows(seats ?? []),
      positions: [],
    };
  }

  const audit = await boardAudit(date, shift, departmentId);
  if (audit.kind === "no-deadline") return audit;

  const narrowed = narrowToPosition(
    await personRows(kind, date, audit.boardGenerated, audit.lines),
    position
  );
  return {
    kind: "ok",
    boardGenerated: audit.boardGenerated,
    rows: narrowed.rows,
    positions: narrowed.positions,
  };
}

/**
 * Who is held on standby for `date`'s induction right now: the rule the
 * employee register's "Standby · Induksi" badge reads (`routes/employees.ts`
 * — an open hold, on someone still on standby), narrowed to holds for `date`.
 * An admin who set them back to aktif has the last word. The badge also shows
 * a hold left open from yesterday, until the first hold run of the new day
 * releases it; the report does not, because that hold is not today's.
 */
async function inductionHolders(
  date: string,
  departmentId: string | null
): Promise<InductionHolder[]> {
  const emp = schema.employees;
  return db
    .select({
      nik: emp.nik,
      name: emp.name,
      position: schema.positions.name,
      departmentId: emp.departmentId,
    })
    .from(schema.inductionHolds)
    .innerJoin(emp, eq(emp.id, schema.inductionHolds.employeeId))
    .leftJoin(schema.positions, eq(schema.positions.id, emp.positionId))
    .where(
      and(
        eq(schema.inductionHolds.date, date),
        isNull(schema.inductionHolds.releasedAt),
        eq(emp.status, "standby"),
        departmentId ? eq(emp.departmentId, departmentId) : undefined
      )
    );
}

/**
 * Induction Operators for `date` — the route only ever asks for today (owner,
 * 2026-10-30). Reads the register, not the board, so it stands whether or not
 * a board was built and needs no deadline from the timeline.
 */
export async function loadInductionReport(
  date: string,
  departmentId: string | null
): Promise<Extract<ReportData, { kind: "ok" }>> {
  const holders = await inductionHolders(date, departmentId);
  const [departments, readings] = await Promise.all([
    departmentNames(),
    ftwTexts(
      date,
      holders.map((h) => normalizeNik(h.nik))
    ),
  ]);
  return {
    kind: "ok",
    boardGenerated: false,
    rows: inductionOperatorRows(holders, departments, readings),
    positions: [],
  };
}
