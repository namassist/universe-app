/**
 * Peringkat Operator: a period of settled points — a week, a month or a range
 * the caller picks — per unit type or for all of them, ranked.
 *
 * Read-only — the ledger is written by the scheduler as each shift closes
 * (`points-settle.ts`) and nothing here scores anything. The grant is
 * `leaderboard: view`.
 *
 * Scope is the Report menu's rule (`reportDepartment`): a `dept` role reads its
 * own department whatever it asks for, asking for another is a 403, and a
 * `self` role reads nothing. The department is the one copied onto each
 * ledger row when the shift settled, so a past period does not move when
 * somebody changes department.
 *
 * A shift with no unit to its name — a spare stood down or not ready, with no
 * standing unit — is stored untyped, and a type's board counts it for the type
 * that person operated most in the period (ties: the one operated last). Left
 * off every type's board, a spare's stand-downs would count on the All board
 * only while a PLAN holder's every shift lands on one: on September's boards
 * that was 439 stand-downs. Somebody who operated nothing in the period
 * counts on the All board only.
 *
 * A row's points, counts and penalty are the board's: on a type's board, that
 * type's shifts. Its rostered shifts, attendance, sleep and streak are the
 * person's, whatever they drove: the operation ratio (operated ÷ rostered
 * shifts) on a type's board is the share of their whole roster spent on that
 * type, and a streak is one run per person.
 */

import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNotNull,
  lt,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import { Elysia, t } from "elysia";
import { LEADERBOARD_MAX_DAYS } from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { db, schema } from "../db";
import { monthOf, periodRange, rankLeaderboard } from "../leaderboard";
import { localDate } from "../scheduler";
import { departmentsFor, reportDepartment } from "./reports";
import { ErrorSchema } from "./schemas";

const forbidden = { code: "forbidden", message: "Akses ditolak" };
const unknownDepartment = {
  code: "department_not_found",
  message: "Departemen tidak ditemukan",
};
const badPeriod = { code: "bad_period", message: "Periode tidak valid" };
const periodTooLong = {
  code: "period_too_long",
  message: `Periode paling lama ${LEADERBOARD_MAX_DAYS} hari`,
};

/** No year 0, which Postgres has no date for. */
const DATE = t.String({ pattern: "^[1-9]\\d{3}-\\d{2}-\\d{2}$" });

const LeaderboardQuery = t.Object({
  /** First and last day, both counted; both or neither. Neither reads the
      current month by the server's clock. */
  from: t.Optional(DATE),
  to: t.Optional(DATE),
  /** One unit type's board; every type summed when absent. */
  unitType: t.Optional(t.String({ format: "uuid" })),
  department: t.Optional(t.String({ format: "uuid" })),
});

const LeaderboardRowSchema = t.Object({
  rank: t.Number(),
  employeeId: t.String(),
  nik: t.String(),
  name: t.String(),
  /** The department of their last shift in the period. */
  department: t.Nullable(t.String()),
  photoFileName: t.Nullable(t.String()),
  total: t.Number(),
  /** Rostered shifts on the ledger, counted or not, on any type. */
  shifts: t.Number(),
  operated: t.Number(),
  stoodDown: t.Number(),
  notReady: t.Number(),
  /** The points lost, as a negative number; 0 with none. */
  penalty: t.Number(),
  /** The run their last shift in the period ended on. */
  streak: t.Number(),
  /** Shifts they tapped in for, on time or late. */
  attended: t.Number(),
  /** Over the shifts with a reading; null with none. */
  sleepAvgMinutes: t.Nullable(t.Number()),
  /** Units operated on this board, most shifts first. */
  units: t.Array(t.Object({ code: t.String(), shifts: t.Number() })),
});

const LeaderboardSchema = t.Object({
  from: t.String(),
  to: t.String(),
  department: t.Nullable(t.Object({ id: t.String(), name: t.String() })),
  /** The type the rows were summed for; null for every type. */
  unitTypeId: t.Nullable(t.String()),
  /** The types anybody in scope earned points on in the period — the tabs. */
  unitTypes: t.Array(t.Object({ id: t.String(), name: t.String() })),
  rows: t.Array(LeaderboardRowSchema),
});

const p = schema.operatorPoints;
const count = (outcome: string) =>
  sql<number>`(count(*) filter (where ${p.outcome} = ${outcome}))::int`;
const sum = (column: AnyColumn) =>
  sql<number>`coalesce(sum(${column}), 0)::int`;

/** The board's own sums: on a type's board, only shifts credited to it. */
function boardTallies(inScope: SQL | undefined, unitType: string | null) {
  /* Each person's most-operated type in the period, in scope: operated
     shifts only, so not being ready against a planned unit does not make
     that unit's type their home. */
  const typed = db.$with("typed").as(
    db
      .select({
        employeeId: p.employeeId,
        unitTypeId: p.unitTypeId,
        shifts: sql<number>`count(*)`.as("shifts"),
        last: sql<string>`max(${p.date})`.as("last"),
      })
      .from(p)
      .where(and(inScope, eq(p.outcome, "operated"), isNotNull(p.unitTypeId)))
      .groupBy(p.employeeId, p.unitTypeId)
  );
  const home = db.$with("home").as(
    db
      .selectDistinctOn([typed.employeeId], {
        employeeId: typed.employeeId,
        unitTypeId: sql<string>`${typed.unitTypeId}`.as("home_type_id"),
      })
      .from(typed)
      .orderBy(
        typed.employeeId,
        desc(typed.shifts),
        desc(typed.last),
        asc(typed.unitTypeId)
      )
  );
  return db
    .with(typed, home)
    .select({
      employeeId: p.employeeId,
      total: sum(p.total),
      operated: count("operated"),
      stoodDown: count("stood-down"),
      notReady: count("not-ready"),
      penalty: sql<number>`coalesce(sum(${p.total}) filter (where ${p.total} < 0), 0)::int`,
    })
    .from(p)
    .leftJoin(home, eq(home.employeeId, p.employeeId))
    .where(
      and(
        inScope,
        unitType
          ? sql`coalesce(${p.unitTypeId}, ${home.unitTypeId}) = ${unitType}`
          : undefined
      )
    )
    .groupBy(p.employeeId);
}

/** The person's own figures over every shift in the period, on any type. */
function personTallies(inScope: SQL | undefined) {
  return db
    .select({
      employeeId: p.employeeId,
      shifts: sql<number>`count(*)::int`,
      attended: sql<number>`(count(*) filter (where ${p.attended}))::int`,
      sleepAvgMinutes: sql<number | null>`round(avg(${p.sleepMinutes}))::int`,
    })
    .from(p)
    .where(inScope)
    .groupBy(p.employeeId);
}

/** Each person's last shift in the period: the streak it ended on, and the
    NIK, name and department as they then stood. */
function lastShifts(inScope: SQL | undefined) {
  return db
    .selectDistinctOn([p.employeeId], {
      employeeId: p.employeeId,
      nik: p.nik,
      name: p.name,
      streak: p.streak,
      department: schema.departments.name,
      photoFileName: schema.employees.photoFileName,
    })
    .from(p)
    .leftJoin(schema.departments, eq(schema.departments.id, p.departmentId))
    .leftJoin(schema.employees, eq(schema.employees.id, p.employeeId))
    .where(inScope)
    .orderBy(p.employeeId, desc(p.date), desc(p.shift));
}

/** The units each person operated, on this board's type, most shifts first. */
function operatedUnits(inScope: SQL | undefined, unitType: string | null) {
  const shifts = sql<number>`count(*)::int`;
  return db
    .select({
      employeeId: p.employeeId,
      code: sql<string>`${p.unitCode}`,
      shifts,
    })
    .from(p)
    .where(
      and(
        inScope,
        eq(p.outcome, "operated"),
        isNotNull(p.unitCode),
        unitType ? eq(p.unitTypeId, unitType) : undefined
      )
    )
    .groupBy(p.employeeId, p.unitCode)
    .orderBy(p.employeeId, desc(shifts), asc(p.unitCode));
}

async function boardRows(inScope: SQL | undefined, unitType: string | null) {
  const [board, people, last, units] = await Promise.all([
    boardTallies(inScope, unitType),
    personTallies(inScope),
    lastShifts(inScope),
    operatedUnits(inScope, unitType),
  ]);
  const person = new Map(people.map((r) => [r.employeeId, r]));
  const latest = new Map(last.map((r) => [r.employeeId, r]));
  const unitsOf = new Map<string, { code: string; shifts: number }[]>();
  for (const { employeeId, code, shifts } of units)
    unitsOf.set(employeeId, [
      ...(unitsOf.get(employeeId) ?? []),
      { code, shifts },
    ]);
  /* The four reads are not one snapshot: a shift settled between them can
     put somebody on the board before their last shift is read. Such a row is
     left for the next read rather than half-filled. */
  return board.flatMap((b) => {
    const shift = latest.get(b.employeeId);
    const own = person.get(b.employeeId);
    if (!shift || !own) return [];
    return [
      {
        ...b,
        nik: shift.nik,
        name: shift.name,
        department: shift.department,
        photoFileName: shift.photoFileName,
        streak: shift.streak,
        shifts: own.shifts,
        attended: own.attended,
        sleepAvgMinutes: own.sleepAvgMinutes,
        units: unitsOf.get(b.employeeId) ?? [],
      },
    ];
  });
}

export const leaderboardRoutes = new Elysia({
  prefix: "/leaderboard",
  tags: ["leaderboard"],
})
  .use(requireAuth)

  /** The departments this caller may narrow the board to — the reports' list,
      under this menu's own grant. */
  .get("/departments", ({ principal }) => departmentsFor(principal), {
    auth: { menu: "leaderboard", mode: "view" },
    response: {
      200: t.Array(
        t.Object({ id: t.String(), name: t.String(), company: t.String() })
      ),
      401: ErrorSchema,
      403: ErrorSchema,
    },
    detail: { summary: "Departments this caller may narrow the board to" },
  })

  .get(
    "/",
    async ({ query, principal, status }) => {
      const scope = await reportDepartment(principal, query.department);
      if (scope.kind === "forbidden") return status(403, forbidden);
      if (scope.kind === "unknown") return status(422, unknownDepartment);
      const department = scope.department;

      if ((query.from === undefined) !== (query.to === undefined))
        return status(422, badPeriod);
      const thisMonth = monthOf(localDate(new Date()));
      const period = periodRange(
        query.from ?? thisMonth.from,
        query.to ?? thisMonth.to
      );
      if (period.kind === "too-long") return status(422, periodTooLong);
      if (period.kind !== "ok") return status(422, badPeriod);

      const inScope = and(
        gte(p.date, period.from),
        lt(p.date, period.toExclusive),
        department ? eq(p.departmentId, department.id) : undefined
      );
      const unitType = query.unitType ?? null;
      const [unitTypes, rows] = await Promise.all([
        db
          .selectDistinct({
            id: schema.unitTypes.id,
            name: schema.unitTypes.name,
          })
          .from(p)
          .innerJoin(schema.unitTypes, eq(schema.unitTypes.id, p.unitTypeId))
          .where(inScope)
          .orderBy(asc(schema.unitTypes.name)),
        boardRows(inScope, unitType),
      ]);

      return {
        from: period.from,
        to: period.to,
        department,
        unitTypeId: unitType,
        unitTypes,
        rows: rankLeaderboard(rows),
      };
    },
    {
      auth: { menu: "leaderboard", mode: "view" },
      query: LeaderboardQuery,
      response: {
        200: LeaderboardSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "A period of operator points, ranked" },
    }
  );
