/**
 * Loads what `reports.ts` builds from: the board's audit lines, the empty
 * seats, savera's texts, and the department names they print.
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
  operatorNoEquipmentRows,
  operatorNoFingerRows,
  operatorNoFtwRows,
  type FtwText,
  type VacantSeat,
} from "./reports";
import { normalizeNik } from "./sources/nik";

export type ReportData =
  /** The timeline names no deadline for this shift, so nobody can be judged. */
  | { kind: "no-deadline" }
  | { kind: "ok"; boardGenerated: boolean; rows: ReportRow[] };

async function departmentNames(): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: schema.departments.id, name: schema.departments.name })
    .from(schema.departments);
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** normalized NIK → savera's texts, for the operators who did not pass. */
async function ftwTexts(
  date: string,
  lines: AuditLine[]
): Promise<Map<string, FtwText>> {
  const niks = lines
    .filter((l) => l.row.ftw !== "pass" && l.row.ftw !== "not-required")
    .map((l) => normalizeNik(l.row.nik));
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

/** The four reports about people, from the board's audit lines. */
async function personRows(
  kind: Exclude<ReportKind, "equipment-no-operator">,
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
    case "operator-no-ftw":
      return operatorNoFtwRows(lines, departments, await ftwTexts(date, lines));
  }
}

/**
 * One report's rows for a date and shift, narrowed to a department when one is
 * given.
 */
export async function loadReport(
  kind: ReportKind,
  date: string,
  shift: ShiftKind,
  departmentId: string | null
): Promise<ReportData> {
  if (kind === "equipment-no-operator") {
    const seats = await vacantSeats(date, shift, departmentId);
    return {
      kind: "ok",
      boardGenerated: seats !== null,
      rows: equipmentNoOperatorRows(seats ?? []),
    };
  }

  const audit = await boardAudit(date, shift, departmentId);
  if (audit.kind === "no-deadline") return audit;

  return {
    kind: "ok",
    boardGenerated: audit.boardGenerated,
    rows: await personRows(kind, date, audit.boardGenerated, audit.lines),
  };
}
