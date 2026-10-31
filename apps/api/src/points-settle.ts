/**
 * Settle one shift's points onto the ledger (Peringkat Operator).
 *
 * A shift is scored from its board's audit — the same lines the audit table
 * and the Report menu read, so the three never disagree about what happened
 * to somebody. It runs when the next shift starts (`scheduler.ts`), by when
 * the board's manual placements are done and the morning's late FTW syncs
 * have landed.
 *
 * Replacing, not appending: settling a shift again rewrites that shift's rows
 * and nothing else. A rewritten shift does not rescore the ones after it, so
 * their streaks keep the run they were settled with — settling is meant to
 * happen once, in order, and a re-run is a repair for that one shift.
 *
 * It never builds or rebuilds a board. A shift with no board settles nothing.
 */

import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import type { ShiftKind } from "@universe/contracts";

import { boardAudit, type AuditLine } from "./board-audit";
import { db, schema } from "./db";
import { scoreShift } from "./points-rules";
import { normalizeNik } from "./sources/nik";

export type ShiftKey = { date: string; shift: ShiftKind };

type PointInsert = typeof schema.operatorPoints.$inferInsert;

/** What scoring needs beyond the audit lines, loaded once for the shift. */
export type PointContext = {
  /** Normalized NIK → savera's sleep minutes for the shift's date. */
  sleepByNik: Map<string, number>;
  /** employeeId → the streak their previous settled shift ended on. */
  streakByEmployee: Map<string, number>;
  /** Unit code → unit type id. */
  unitTypeByCode: Map<string, string>;
};

/**
 * The shift a `shift-start` closes: the night's start closes that date's day
 * shift; the day's start closes the night that began the date before, which
 * is the date a night board is filed under.
 */
export function previousShift(date: string, shift: ShiftKind): ShiftKey {
  if (shift === "night") return { date, shift: "day" };
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return { date: day.toISOString().slice(0, 10), shift: "night" };
}

/**
 * The ledger rows for one shift's audit lines. Pure.
 *
 * Points are credited to the unit type of the seat, or — with no seat — of the
 * person's standing unit, so a stood-down or not-ready shift lands on the board
 * of the unit they were there for. A spare has neither, and the row is stored
 * with no type: the leaderboard credits it to the type they operated most that
 * month (`routes/leaderboard.ts`), so a type's board does not undercount spares
 * against PLAN holders.
 */
export function pointRows(
  key: ShiftKey,
  lines: AuditLine[],
  context: PointContext
): PointInsert[] {
  return lines.map((line) => {
    const { row } = line;
    const unitCode = row.actualUnitCode ?? row.planUnitCode;
    const sleepMinutes = context.sleepByNik.get(normalizeNik(row.nik)) ?? null;
    const score = scoreShift({
      seated: row.actualUnitCode !== null,
      finger: row.finger,
      ftw: row.ftw,
      sleepMinutes,
      previousStreak: context.streakByEmployee.get(line.employeeId) ?? 0,
    });
    return {
      date: key.date,
      shift: key.shift,
      employeeId: line.employeeId,
      nik: row.nik,
      name: row.name,
      departmentId: line.departmentId,
      unitCode,
      unitTypeId: unitCode
        ? (context.unitTypeByCode.get(unitCode) ?? null)
        : null,
      ...score,
      /* Present at all — a late tap is attendance, just not on time. */
      attended: row.finger !== "missing",
      sleepMinutes,
    };
  });
}

/** Ledger rows settled before `key`. `shift_kind` orders day before night. */
function settledBefore(key: ShiftKey) {
  const t = schema.operatorPoints;
  return key.shift === "night"
    ? or(lt(t.date, key.date), and(eq(t.date, key.date), eq(t.shift, "day")))
    : lt(t.date, key.date);
}

/**
 * employeeId → the streak of each person's last settled shift before `key`.
 * Absent for somebody with none, whose run starts from nothing.
 */
export async function previousStreaks(
  ids: string[],
  key: ShiftKey
): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const t = schema.operatorPoints;
  const rows = await db
    .selectDistinctOn([t.employeeId], {
      employeeId: t.employeeId,
      streak: t.streak,
    })
    .from(t)
    .where(and(inArray(t.employeeId, ids), settledBefore(key)))
    .orderBy(t.employeeId, desc(t.date), desc(t.shift));
  return new Map(rows.map((r) => [r.employeeId, r.streak]));
}

/** Replace one shift's rows with `rows`, in one transaction. */
export async function replaceShift(
  key: ShiftKey,
  rows: PointInsert[]
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.operatorPoints)
      .where(
        and(
          eq(schema.operatorPoints.date, key.date),
          eq(schema.operatorPoints.shift, key.shift)
        )
      );
    if (rows.length) await tx.insert(schema.operatorPoints).values(rows);
  });
}

async function sleepMinutes(
  date: string,
  lines: AuditLine[]
): Promise<Map<string, number>> {
  const niks = [...new Set(lines.map((l) => normalizeNik(l.row.nik)))];
  if (!niks.length) return new Map();
  const rows = await db
    .select({
      nik: schema.ftwReadings.nik,
      minutes: schema.ftwReadings.sleepMinutes,
    })
    .from(schema.ftwReadings)
    .where(
      and(
        eq(schema.ftwReadings.date, date),
        inArray(schema.ftwReadings.nik, niks)
      )
    );
  return new Map(rows.map((r) => [r.nik, r.minutes]));
}

async function unitTypes(lines: AuditLine[]): Promise<Map<string, string>> {
  const codes = [
    ...new Set(
      lines
        .map((l) => l.row.actualUnitCode ?? l.row.planUnitCode)
        .filter((c): c is string => c !== null)
    ),
  ];
  if (!codes.length) return new Map();
  const rows = await db
    .select({ code: schema.units.code, typeId: schema.units.typeId })
    .from(schema.units)
    .where(inArray(schema.units.code, codes));
  return new Map(rows.map((r) => [r.code, r.typeId]));
}

export type SettleResult =
  | { kind: "settled"; rows: number }
  /** No board was built for the shift; nothing was written. */
  | { kind: "no-board" }
  /** The timeline names no deadline for the shift, so nobody can be judged. */
  | { kind: "no-deadline" };

export async function settleShift(
  date: string,
  shift: ShiftKind
): Promise<SettleResult> {
  const audit = await boardAudit(date, shift);
  if (audit.kind === "no-deadline") return { kind: "no-deadline" };
  if (!audit.boardGenerated) return { kind: "no-board" };

  const key = { date, shift };
  const lines = audit.lines;
  const ids = lines.map((l) => l.employeeId);
  const [sleepByNik, unitTypeByCode, streakByEmployee] = await Promise.all([
    sleepMinutes(date, lines),
    unitTypes(lines),
    previousStreaks(ids, key),
  ]);
  const rows = pointRows(key, lines, {
    sleepByNik,
    streakByEmployee,
    unitTypeByCode,
  });
  await replaceShift(key, rows);
  return { kind: "settled", rows: rows.length };
}
