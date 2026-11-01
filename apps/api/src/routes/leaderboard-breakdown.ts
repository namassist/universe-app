/**
 * The reads behind one operator's breakdown on Peringkat Operator — the page
 * a board's points open (`GET /v1/leaderboard/operators/:employeeId`, in
 * `leaderboard.ts`). The layout and the sums are `../leaderboard-breakdown.ts`.
 *
 * Scope is the board's, row by row: the ledger rows are the ones whose
 * department (as it stood when the shift settled) is in scope, and the roster
 * days are the ones on that department's documents in force. Somebody with no
 * settled shift in scope is not found — the board would not have listed them,
 * and a department-scoped role learns nothing of another department's people
 * from a 404 it would not also get for a stranger.
 */

import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { t } from "elysia";
import { BREAKDOWN_KINDS, ROSTER_CODES } from "@universe/contracts";

import { db, schema } from "../db";
import { breakdown } from "../leaderboard-breakdown";

const LineSchema = t.Object({
  date: t.String(),
  shift: t.Nullable(t.UnionEnum(["day", "night"])),
  rosterCode: t.Nullable(t.UnionEnum(ROSTER_CODES)),
  kind: t.UnionEnum(BREAKDOWN_KINDS),
  unitCode: t.Nullable(t.String()),
  unitTypeId: t.Nullable(t.String()),
  /** Summed on the board asked for. */
  onBoard: t.Boolean(),
  base: t.Number(),
  onTime: t.Number(),
  sleep: t.Number(),
  streakBonus: t.Number(),
  total: t.Number(),
  /** The run after the shift; null where the line leaves it as it was. */
  streak: t.Nullable(t.Number()),
  attended: t.Nullable(t.Boolean()),
  sleepMinutes: t.Nullable(t.Number()),
  /** The board's total up to and including this line. */
  running: t.Number(),
});

const Named = t.Object({ id: t.String(), name: t.String() });

export const OperatorBreakdownSchema = t.Object({
  from: t.String(),
  to: t.String(),
  department: t.Nullable(Named),
  /** The board the points were summed for; null for every type. */
  unitType: t.Nullable(Named),
  employee: t.Object({
    id: t.String(),
    nik: t.String(),
    name: t.String(),
    /** As of their last settled shift in the period. */
    department: t.Nullable(t.String()),
    photoFileName: t.Nullable(t.String()),
  }),
  total: t.Number(),
  penalty: t.Number(),
  counted: t.Number(),
  streak: t.Number(),
  /** The types the lines name, for their tags. */
  unitTypes: t.Array(Named),
  lines: t.Array(LineSchema),
});

type Period = { from: string; to: string; toExclusive: string };

const p = schema.operatorPoints;

function ledgerRows(employeeId: string, period: Period, dept: string | null) {
  return db
    .select({
      date: p.date,
      shift: p.shift,
      outcome: p.outcome,
      unitCode: p.unitCode,
      unitTypeId: p.unitTypeId,
      base: p.base,
      onTime: p.onTime,
      sleep: p.sleep,
      streakBonus: p.streakBonus,
      total: p.total,
      streak: p.streak,
      attended: p.attended,
      sleepMinutes: p.sleepMinutes,
      nik: p.nik,
      name: p.name,
      department: schema.departments.name,
    })
    .from(p)
    .leftJoin(schema.departments, eq(schema.departments.id, p.departmentId))
    .where(
      and(
        eq(p.employeeId, employeeId),
        gte(p.date, period.from),
        lt(p.date, period.toExclusive),
        dept ? eq(p.departmentId, dept) : undefined
      )
    )
    .orderBy(asc(p.date), asc(p.shift));
}

/** The in-force roster days, through a join rather than the `exists` in
    `roster-in-force.ts`, so the department narrows the same document. */
function rosterRows(employeeId: string, period: Period, dept: string | null) {
  const days = schema.rosterDays;
  const docs = schema.rosterDocuments;
  return db
    .select({ date: days.date, code: days.code })
    .from(days)
    .innerJoin(
      docs,
      and(
        eq(docs.id, days.documentId),
        eq(docs.status, "aktif"),
        dept ? eq(docs.departmentId, dept) : undefined
      )
    )
    .where(
      and(
        eq(days.employeeId, employeeId),
        gte(days.date, period.from),
        lt(days.date, period.toExclusive)
      )
    )
    .orderBy(asc(days.date), asc(docs.createdAt));
}

export type BreakdownResult =
  | { kind: "ok"; body: typeof OperatorBreakdownSchema.static }
  | { kind: "not-found" }
  | { kind: "unknown-unit-type" };

export async function operatorBreakdown(input: {
  employeeId: string;
  period: Period;
  department: { id: string; name: string } | null;
  unitType: string | null;
  today: string;
}): Promise<BreakdownResult> {
  const { employeeId, period, department, unitType } = input;
  const dept = department?.id ?? null;
  /* The ledger alone decides "not found", before anything else is read. */
  const ledger = await ledgerRows(employeeId, period, dept);
  const last = ledger.at(-1);
  if (!last) return { kind: "not-found" };

  const typeIds = [
    ...new Set(
      [unitType, ...ledger.map((l) => l.unitTypeId)].filter(
        (id): id is string => id !== null
      )
    ),
  ];
  const [allRoster, unitTypes, [person]] = await Promise.all([
    rosterRows(employeeId, period, dept),
    typeIds.length
      ? db
          .select({ id: schema.unitTypes.id, name: schema.unitTypes.name })
          .from(schema.unitTypes)
          .where(inArray(schema.unitTypes.id, typeIds))
          .orderBy(asc(schema.unitTypes.name))
      : Promise.resolve([]),
    db
      .select({
        photoFileName: schema.employees.photoFileName,
        departmentId: schema.employees.departmentId,
      })
      .from(schema.employees)
      .where(eq(schema.employees.id, employeeId)),
  ]);
  /* Somebody who has since left the scoped department: its document may
     still carry their days after they went, which are no longer its to
     read. Its roster stops at the last shift settled there. */
  const leftScope = dept !== null && person?.departmentId !== dept;
  const roster = leftScope
    ? allRoster.filter((r) => r.date <= last.date)
    : allRoster;
  const board = unitType
    ? (unitTypes.find((u) => u.id === unitType) ?? undefined)
    : null;
  if (board === undefined) return { kind: "unknown-unit-type" };

  const result = breakdown({ ledger, roster, unitType, today: input.today });
  return {
    kind: "ok",
    body: {
      from: period.from,
      to: period.to,
      department,
      unitType: board,
      employee: {
        id: employeeId,
        nik: last.nik,
        name: last.name,
        department: last.department,
        photoFileName: person?.photoFileName ?? null,
      },
      unitTypes,
      ...result,
    },
  };
}
