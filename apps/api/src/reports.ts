/**
 * The Report menu's five reports, as rows — pure, over data already loaded.
 *
 * Which operator lands on which report is the whole of the feature's
 * judgement, so it lives here with no database in reach and is tested that
 * way. `report-data.ts` loads the inputs; the route and the workbook only ever
 * see the rows.
 *
 * Every person report is built from the board's audit lines (`board-audit`),
 * the same lines the Actual tab's audit table shows, so a sheet and the screen
 * behind it cannot name a different outcome for the same operator.
 */

import {
  NO_FINGER_LABEL,
  NO_FTW_READING_LABEL,
  SPARE_UNIT_LABEL,
  type ReportRow,
} from "@universe/contracts";

import type { AuditLine } from "./board-audit";
import { normalizeNik } from "./sources/nik";

/** How the board names a unit's formation when it belongs to none. */
const SUPPORT_FLEET_LABEL = "Fleet support";

/** savera's own word for "this person has not filled the form in". */
const NOT_FILLED_DECISION = "belum mengisi ftw";

/** An FTW reading as savera sent it — only the two texts the report prints. */
export type FtwText = {
  ftwDecision: string | null;
  sleepCategory: string | null;
};

/** A seat on the board nobody was put on. */
export type VacantSeat = {
  unitCode: string;
  simperCode: string | null;
  /** The formation's leader, from the board's own copy. */
  leaderCode: string | null;
  support: boolean;
  busCode: string | null;
  area: string | null;
};

const hhmm = (time: string | null) => (time ?? "").slice(0, 5);

const fleetLabel = (leaderCode: string | null, support: boolean) =>
  leaderCode ?? (support ? SUPPORT_FLEET_LABEL : "");

/** The four columns every person report opens with. */
function personCells(line: AuditLine, departments: Map<string, string>) {
  return {
    nik: line.row.nik,
    name: line.row.name,
    position: line.positionName,
    department: line.departmentId
      ? (departments.get(line.departmentId) ?? "")
      : "",
  };
}

/**
 * By name, case aside — the order a printed list is searched in. The board's
 * order (formation, then decision) is what the audit table is for; a report
 * is somebody looking a person up.
 */
const byName = (a: AuditLine, b: AuditLine) =>
  a.row.name.localeCompare(b.row.name, "id", { sensitivity: "base" });

/**
 * Everyone the board placed nowhere — ready and seatless, or turned away
 * (owner, 2026-09-24). The FTW and finger reports say *why* for the second
 * group; this one says who was left standing.
 */
export function operatorNoEquipmentRows(
  lines: AuditLine[],
  departments: Map<string, string>
): ReportRow[] {
  return lines
    .filter(
      (l) => l.row.decision === "no-seat" || l.row.decision === "not-ready"
    )
    .sort(byName)
    .map((l) => ({
      ...personCells(l, departments),
      simperMatrix: l.row.skills.join("; "),
    }));
}

/** STATUS SAVERA for one operator who did not pass. */
function saveraStatus(line: AuditLine, reading: FtwText | undefined): string {
  if (line.row.ftw === "missing" || !reading) return NO_FTW_READING_LABEL;
  if (line.row.ftw === "late")
    return `Terlambat FTW (${hhmm(line.row.sentAt)})`;
  if (reading.ftwDecision?.trim().toLowerCase() === NOT_FILLED_DECISION)
    return NO_FTW_READING_LABEL;
  /* savera's category, as savera spelled it — the report is read against
     savera's own screen, and a paraphrase is one more thing to reconcile. */
  return (
    reading.sleepCategory?.trim() ||
    reading.ftwDecision?.trim() ||
    NO_FTW_READING_LABEL
  );
}

/**
 * Everyone whose FTW did not pass for the unit that applied to them. A unit
 * that asks for no FTW (`not-required`) puts nobody here: the engine never
 * held it against them, and the report must not either.
 *
 * `readings` is keyed by normalized NIK — the only key savera shares with us.
 */
export function operatorNoFtwRows(
  lines: AuditLine[],
  departments: Map<string, string>,
  readings: Map<string, FtwText>
): ReportRow[] {
  return lines
    .filter((l) => l.row.ftw !== "pass" && l.row.ftw !== "not-required")
    .sort(byName)
    .map((l) => {
      const { nik, name, position, department } = personCells(l, departments);
      return {
        nik,
        name,
        roster: l.rosterCode,
        position,
        department,
        saveraStatus: saveraStatus(l, readings.get(normalizeNik(nik))),
      };
    });
}

/**
 * Everyone who did not tap in before the deadline: no tap reads "No Finger",
 * a late one reads the time it came (owner, 2026-09-24).
 */
export function operatorNoFingerRows(
  lines: AuditLine[],
  departments: Map<string, string>
): ReportRow[] {
  return lines
    .filter((l) => l.row.finger !== "pass")
    .sort(byName)
    .map((l) => {
      const { nik, name, position, department } = personCells(l, departments);
      return {
        nik,
        name,
        roster: l.rosterCode,
        position,
        department,
        jamIn:
          l.row.finger === "late" && l.row.tappedAt
            ? hhmm(l.row.tappedAt)
            : NO_FINGER_LABEL,
      };
    });
}

/**
 * Every rostered operator and the seat they ended on. Someone placed nowhere
 * reads SPARE, the word their slip carries, and nothing else: their standing
 * formation is not where they worked, and printing it beside SPARE would say
 * they did.
 */
export function finalValidationRows(
  lines: AuditLine[],
  departments: Map<string, string>
): ReportRow[] {
  return [...lines].sort(byName).map((l) => {
    const placed = l.row.actualUnitCode !== null;
    return {
      ...personCells(l, departments),
      unit: l.row.actualUnitCode ?? SPARE_UNIT_LABEL,
      fleet: placed
        ? fleetLabel(l.row.fleetLeaderCode, l.row.fleetSupport)
        : "",
      bus: placed ? (l.busCode ?? "") : "",
      location: placed ? (l.area ?? "") : "",
    };
  });
}

/** Formations by leader code, then support, then no fleet. */
function formationRank(seat: VacantSeat): string {
  if (seat.leaderCode) return `0${seat.leaderCode}`;
  return seat.support ? "1" : "2";
}

/**
 * Every unit on the board nobody was put on, read the way the board reads:
 * formation by formation, unit by unit.
 */
export function equipmentNoOperatorRows(seats: VacantSeat[]): ReportRow[] {
  return [...seats]
    .sort(
      (a, b) =>
        formationRank(a).localeCompare(formationRank(b)) ||
        a.unitCode.localeCompare(b.unitCode)
    )
    .map((s) => ({
      unit: s.unitCode,
      simperCode: s.simperCode ?? "",
      fleet: fleetLabel(s.leaderCode, s.support),
      bus: s.busCode ?? "",
      location: s.area ?? "",
    }));
}
