/**
 * The dashboard's numbers, composed server-side.
 *
 * One request rather than a dozen: every card here is a count, and a screen
 * that opened with twelve round trips would spend longer assembling itself
 * than reading anything.
 *
 * **Two gates, and they are not the same gate.** A grant decides whether a
 * section is sent at all; scope decides how much of it. Both live here rather
 * than on the screen, because a card the web merely declines to render still
 * arrived over the wire. What the caller has no grant for is simply absent
 * from the payload.
 *
 * People-shaped sections are scoped through `scopeWhere`, which fails closed.
 * Machine-shaped ones — the unit register, the board, the kiosks, the ingest
 * clock — are not: they describe the site rather than a department, and the
 * fleet board in particular spans departments by design (the `manpower` scope
 * correction, D8). Their gate is the grant alone.
 *
 * **Everything about people is about one shift, and the clock picks it**
 * (`deskShift`, owner 2026-09-18): before noon the day shift, from noon
 * onwards the night one. It used to be neither — every people-shaped count
 * summed `D` and `N` together, so at 07:00 the 325 night operators who had not
 * started work yet were reported as 325 who had not tapped and had not filed a
 * fit-to-work. That is a red number nobody can act on, printed every morning
 * of the year. A shift is also what makes the two IN columns readable at all:
 * `first_in_at` and `first_in_pm_at` exist precisely because one date holds
 * two arrivals, and only a shift says which of them is the one.
 */

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { Elysia } from "elysia";
import {
  type EffectivePermissions,
  type MenuSlug,
  type SessionPrincipal,
  type ShiftKind,
} from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { scopeWhere } from "../auth/scope";
import { deskShift } from "../current-shift";
import { db, schema } from "../db";
import { ftwObligedWhere } from "../ftw-obliged";
import { FTW_PASS_CATEGORY, FTW_PASS_DECISION } from "../readiness";
import { rosterDayInForce } from "../roster-in-force";
import { dashboardAnalytics } from "./dashboard-analytics";
import { DashboardSchema, ErrorSchema } from "./schemas";

/** Holding any of these is enough for a section. */
const holds = (permissions: EffectivePermissions, ...menus: MenuSlug[]) =>
  menus.some((menu) => permissions[menu] !== undefined);

/**
 * All of them, for a section that is genuinely made of several.
 *
 * The charts read the roster, the taps, the fit-to-work verdicts and the unit
 * register in one breath, and a bar labelled "NO FTW" is a fit-to-work figure
 * whatever panel it is drawn on. Letting `fleet-allocation` alone open them
 * would hand FTW numbers to somebody the FTW section is withheld from — the
 * distinction the rest of this file exists to keep. Missing any one grant and
 * the section is absent, which is the same answer the others give.
 */
const holdsAll = (permissions: EffectivePermissions, ...menus: MenuSlug[]) =>
  menus.every((menu) => permissions[menu] !== undefined);

/** How near an expiry has to be before the dashboard calls it "soon". */
const SIMPER_SOON_DAYS = 30;
/** The breakdown card names this many units and counts the rest. */
const BREAKDOWN_NAMED = 3;

/** The one roster code that schedules the given shift. */
const rosterCodeOf = (shift: ShiftKind) => (shift === "night" ? "N" : "D");

/**
 * A filing that passed, by the same rule the board and the walls apply.
 *
 * savera sends **two** verdicts and a filing has to clear both:
 * `ftw_decision` ("FTW aman") and `sleep_category` ("Dapat Bekerja"). This
 * card used to read the decision alone, which made it quietly the most
 * optimistic number on the page — on 2026-09-18 it reported 2 people worth
 * looking at where the Fit To Work menu showed 7, because six of savera's own
 * "FTW aman" rows carry a category of "Tidak Boleh Bekerja" or "Istirahat
 * Minimal N Jam". The two columns are independent answers; neither is a
 * summary of the other.
 *
 * `judgeFtw` in TypeScript and this in SQL are the same rule written twice,
 * which is why both read the vocabulary from one place. What is deliberately
 * *not* here is lateness: `judgeFtw` also fails a filing sent after the
 * deadline, but that is an allocation gate rather than anything about the
 * person's fitness, and this card sends its reader to the Fit To Work menu to
 * look for a health reason.
 *
 * Compared through `lower(btrim(…))` for the same reason `key` exists: casing
 * and padding are savera's presentation, not data.
 */
const ftwPassed = sql`lower(btrim(${schema.ftwReadings.ftwDecision})) = ${FTW_PASS_DECISION}
  and lower(btrim(${schema.ftwReadings.sleepCategory})) = ${FTW_PASS_CATEGORY}`;

/**
 * The IN column that shift's arrival lives in — never `a ?? b`.
 *
 * The same rule as `shiftIn`, in the dialect a `count(*) filter` speaks. The
 * fallback it refuses is the bug the noon split exists to close: a night
 * operator who presses IN as well as OUT on the way home at 06:20 would
 * otherwise be counted as having arrived for a shift that starts at 17:00.
 */
const arrivalColumn = (shift: ShiftKind) =>
  shift === "night"
    ? schema.fingerReadings.firstInPmAt
    : schema.fingerReadings.firstInAt;

/**
 * One person's day: what the roster says, whether the two readings arrived,
 * the unit today's board seated them on, and anything they are waiting on.
 *
 * Small separate reads rather than one join: they answer different questions
 * about different tables, and a single query would left-join five ways to
 * produce one row that is mostly nulls.
 *
 * The shift is passed in rather than re-derived so that the tap this reports
 * is the one the aggregate above counted. A night operator reading this at
 * 18:00 wants to know whether *tonight's* arrival registered, and their own
 * 06:20 tap on the way home from last night would be a lie told in their
 * favour.
 */
async function personalDay(nik: string, today: string, shift: ShiftKind) {
  const [employee] = await db
    .select({ id: schema.employees.id, name: schema.employees.name })
    .from(schema.employees)
    .where(eq(schema.employees.nik, nik))
    .limit(1);
  if (!employee) return null;

  const [roster] = await db
    .select({ code: schema.rosterDays.code })
    .from(schema.rosterDays)
    .where(
      and(
        eq(schema.rosterDays.employeeId, employee.id),
        eq(schema.rosterDays.date, today),
        rosterDayInForce
      )
    )
    .limit(1);

  const [ftw] = await db
    .select({ decision: schema.ftwReadings.ftwDecision })
    .from(schema.ftwReadings)
    .where(
      and(eq(schema.ftwReadings.nik, nik), eq(schema.ftwReadings.date, today))
    )
    .limit(1);

  const [finger] = await db
    .select({
      firstInAt: schema.fingerReadings.firstInAt,
      firstInPmAt: schema.fingerReadings.firstInPmAt,
    })
    .from(schema.fingerReadings)
    .where(
      and(
        eq(schema.fingerReadings.nik, nik),
        eq(schema.fingerReadings.date, today)
      )
    )
    .limit(1);

  /* This shift's board, not "whichever of today's two came back first". The
     old query filtered on the date alone and took `limit(1)`, so an operator
     who works both halves of a changeover day was shown whichever row the
     planner happened to return — and at 04:00 that could be tonight's unit. */
  const [seat] = await db
    .select({
      unitCode: schema.units.code,
      source: schema.fleetActualSlots.source,
    })
    .from(schema.fleetActualSlots)
    .innerJoin(
      schema.fleetActualDocuments,
      eq(schema.fleetActualDocuments.id, schema.fleetActualSlots.documentId)
    )
    .innerJoin(
      schema.units,
      eq(schema.units.id, schema.fleetActualSlots.unitId)
    )
    .where(
      and(
        eq(schema.fleetActualDocuments.date, today),
        eq(schema.fleetActualDocuments.shift, shift),
        eq(schema.fleetActualSlots.employeeId, employee.id)
      )
    )
    .limit(1);

  return {
    name: employee.name,
    nik,
    rosterCode: roster?.code ?? null,
    ftwDecision: ftw?.decision ?? null,
    tappedAt:
      (shift === "night" ? finger?.firstInPmAt : finger?.firstInAt) ?? null,
    unitCode: seat?.unitCode ?? null,
    unitSource: seat?.source ?? null,
  };
}

export const dashboardRoutes = new Elysia({
  prefix: "/dashboard",
  tags: ["dashboard"],
})
  .use(requireAuth)

  .get(
    "/",
    async ({ principal, permissions }) => {
      /* One clock reading for the whole payload: two calls either side of
         noon would build the cards from two different shifts. */
      const now = deskShift(new Date());
      const today = now.date;
      const person = principal as Extract<SessionPrincipal, { kind: "user" }>;

      /* Scoped to whoever is asking: a department admin counts their own
         department, a `self` account counts only themselves — which is why
         `self` gets `me` below instead of aggregates that would all read 1. */
      const mine = await scopeWhere(principal, {
        dept: schema.employees.departmentId,
        self: schema.employees.nik,
      });
      /**
       * The denominator every people-shaped figure is read against, and the
       * easiest thing here to get wrong twice over.
       *
       * First, 990 people carry a roster row for today but 322 of them are
       * off, on leave, travelling or sick; counting presence against 990 makes
       * an ordinary day look like a crisis, every day. Only `D` and `N`
       * schedule a shift at all.
       *
       * Second — and this is what `deskShift` fixes — of those two codes only
       * one is the shift being asked about. Counting both meant the morning
       * dashboard reported every night operator as absent and unfiled hours
       * before their shift began: on 2026-09-18 at 07:15 that was 324 of the
       * 408 "belum upload FTW", none of them late for anything.
       */
      const scheduledShift = and(
        eq(schema.employees.status, "aktif"),
        eq(schema.rosterDays.date, today),
        eq(schema.rosterDays.code, rosterCodeOf(now.shift)),
        // Every count and every attention row below reads through this, so the
        // in-force rule belongs here rather than in each of the six.
        rosterDayInForce,
        mine
      );
      const arrival = arrivalColumn(now.shift);

      const attendance = holds(permissions, "attendance")
        ? (
            await db
              .select({
                scheduled: sql<number>`count(*)::int`,
                tapped: sql<number>`count(*) filter (
                  where ${arrival} is not null)::int`,
              })
              .from(schema.employees)
              .innerJoin(
                schema.rosterDays,
                eq(schema.rosterDays.employeeId, schema.employees.id)
              )
              .leftJoin(
                schema.fingerReadings,
                and(
                  eq(schema.fingerReadings.nik, schema.employees.nik),
                  eq(schema.fingerReadings.date, today)
                )
              )
              .where(scheduledShift)
          )[0]
        : null;

      /**
       * The FTW section counts who *owes* a filing, not who is on the shift.
       *
       * The same narrowing the wall applies, and for the same reason: an
       * excavator operator is never asked for one, so counting him as "belum
       * lapor" puts a number on the page that nobody can act on. On
       * 2026-09-18 the card read 84 where 10 was the answer — 72 of the other
       * 74 hold no licence for a unit the master marks `ftw`, and 2 sit in a
       * position that is never allocated a unit at all. None of them had
       * filed, which is not a failure; it is the rule working.
       *
       * It narrows the whole section rather than the "missing" count alone.
       * A denominator that included people whose filings were never counted
       * would make "240 fit of 332" arithmetic nobody could reproduce.
       */
      const ftw = holds(permissions, "fit-to-work")
        ? (
            await db
              .select({
                scheduled: sql<number>`count(*)::int`,
                /* `is not true`, not `not (…)`: a null category makes the
                   comparison null, and `not null` is null — which would drop
                   the row out of both counts and lose a person the page is
                   supposed to be pointing at. */
                followUp: sql<number>`count(*) filter (
                  where ${schema.ftwReadings.nik} is not null
                    and (${ftwPassed}) is not true)::int`,
                missing: sql<number>`count(*) filter (
                  where ${schema.ftwReadings.nik} is null)::int`,
              })
              .from(schema.employees)
              .innerJoin(
                schema.rosterDays,
                eq(schema.rosterDays.employeeId, schema.employees.id)
              )
              .leftJoin(
                schema.ftwReadings,
                and(
                  eq(schema.ftwReadings.nik, schema.employees.nik),
                  eq(schema.ftwReadings.date, today)
                )
              )
              .where(and(scheduledShift, ftwObligedWhere))
          )[0]
        : null;

      /* ---- machine-shaped sections: the grant is the only gate ---------- */

      /**
       * The register's own state, plus the few codes the card names.
       *
       * `breakdownCodes` is capped: the card has room for three and the
       * number beside them says how many more there are. It replaced a
       * ten-row attention table that listed them (owner, 2026-09-18) — the
       * charts say how the shift is going far better than a list of whoever
       * sorted first ever did.
       */
      const units = holds(permissions, "unit-status")
        ? (
            await db
              .select({
                active: sql<number>`count(*) filter (where ${schema.units.active})::int`,
                breakdown: sql<number>`count(*) filter (
                  where ${schema.units.active} and ${schema.units.breakdown})::int`,
                standby: sql<number>`count(*) filter (
                  where ${schema.units.active} and ${schema.units.standby})::int`,
              })
              .from(schema.units)
          )[0]
        : null;
      const breakdownCodes = units
        ? (
            await db
              .select({ code: schema.units.code })
              .from(schema.units)
              .where(
                and(
                  eq(schema.units.active, true),
                  eq(schema.units.breakdown, true)
                )
              )
              .orderBy(schema.units.code)
              .limit(BREAKDOWN_NAMED)
          ).map((r) => r.code)
        : [];

      /**
       * When the two external sources last answered.
       *
       * Its own card because a stalled ingest is silent: the board still
       * generates, the screens still render, and everyone reads yesterday's
       * readings as today's. Nothing else on this page would show it.
       */
      const ingest = holds(permissions, "fit-to-work", "attendance")
        ? {
            ftwSyncedAt:
              (
                await db
                  .select({ at: sql<string | null>`max(synced_at)::text` })
                  .from(schema.ftwReadings)
              )[0]?.at ?? null,
            fingerSyncedAt:
              (
                await db
                  .select({ at: sql<string | null>`max(synced_at)::text` })
                  .from(schema.fingerReadings)
              )[0]?.at ?? null,
          }
        : null;

      /**
       * Today's boards, one line per shift that has one.
       *
       * Still both, although every card that reads them is now about one
       * shift: the day's other board is one extra grouped row on a query that
       * has to run anyway, and returning the pair keeps this endpoint honest
       * about what exists rather than about what today's grid happens to
       * show. `shift` below says which line the rest of the payload is for.
       *
       * Not scoped: the board spans departments by design — the same reason
       * `manpower` was moved to `all` (D8) — so its grant is the whole gate. A
       * shift with no document is simply absent, which is how the screen says
       * "not generated yet" without inventing a zero.
       */
      const allocation = holds(permissions, "fleet-allocation")
        ? await db
            .select({
              shift: schema.fleetActualDocuments.shift,
              /* The column itself, not `::text`. `generated_at` is a
                 `timestamptz`, and its text form is UTC with a bare `+00`
                 offset that browsers are not obliged to parse — the screen
                 renders this as a clock on the wall at site, so it has to
                 arrive as something `new Date()` can read without guessing. */
              generatedAt: schema.fleetActualDocuments.generatedAt,
              slots: sql<number>`count(${schema.fleetActualSlots.id})::int`,
              filled: sql<number>`count(${schema.fleetActualSlots.employeeId})::int`,
            })
            .from(schema.fleetActualDocuments)
            .leftJoin(
              schema.fleetActualSlots,
              eq(
                schema.fleetActualSlots.documentId,
                schema.fleetActualDocuments.id
              )
            )
            .where(eq(schema.fleetActualDocuments.date, today))
            .groupBy(
              schema.fleetActualDocuments.shift,
              schema.fleetActualDocuments.generatedAt
            )
            .then((rows) =>
              rows.map((row) => ({
                ...row,
                generatedAt: row.generatedAt.toISOString(),
              }))
            )
        : null;

      /**
       * Expiries worth chasing — sent only once the dates exist.
       *
       * Every active employee carries a SIMPER *type*, but exactly one carries
       * an expiry date. A card counting zero out of nothing reads as "all
       * clear", which is the opposite of the truth, so the section is omitted
       * until the register has dates to count. It appears on its own the day
       * they are imported.
       */
      const simperRows = holds(permissions, "employees")
        ? (
            await db
              .select({
                dated: sql<number>`count(*)::int`,
                expired: sql<number>`count(*) filter (
                  where ${schema.employees.simperExp} < current_date)::int`,
                soon: sql<number>`count(*) filter (
                  where ${schema.employees.simperExp} >= current_date
                    and ${schema.employees.simperExp} < current_date + ${sql.raw(String(SIMPER_SOON_DAYS))})::int`,
              })
              .from(schema.employees)
              .where(
                and(
                  eq(schema.employees.status, "aktif"),
                  isNotNull(schema.employees.simperExp),
                  mine
                )
              )
          )[0]
        : null;
      const simper =
        simperRows && simperRows.dated > 0
          ? { expired: simperRows.expired, soon: simperRows.soon }
          : null;

      /**
       * The signed-in person's own day.
       *
       * The whole dashboard for a `self` account, and a useful corner of
       * everyone else's: an aggregate over a department means nothing to an
       * operator, and "you are on D today, you tapped at 04:48, you are on
       * DT4023" is the only thing on this page they can act on.
       */
      const me = person.nik
        ? await personalDay(person.nik, today, now.shift)
        : null;

      /**
       * The four charts, which replaced the attention table on the screen
       * (owner, 2026-09-18) — "jelek dan tidak informatif" was the verdict,
       * and a list of ten names never did say how the shift was going.
       *
       * Its own module: four shaped datasets with their own joins do not read
       * like the dozen `count(*)`s above them.
       */
      const analytics = holdsAll(
        permissions,
        "fleet-allocation",
        "attendance",
        "fit-to-work"
      )
        ? await dashboardAnalytics(today, now.shift)
        : null;

      return {
        date: today,
        /* Which shift every people-shaped figure above counted. Sent rather
           than re-derived on the screen: the browser's clock is not the
           site's, and a laptop an hour out would label the numbers with the
           wrong shift while the numbers themselves stayed right. */
        shift: now.shift,
        attendance: attendance ?? null,
        ftw: ftw ?? null,
        units: units ? { ...units, breakdownCodes } : null,
        ingest,
        allocation,
        analytics,
        simper,
        me,
      };
    },
    {
      auth: { menu: "dashboard", mode: "view" },
      response: { 200: DashboardSchema, 401: ErrorSchema, 403: ErrorSchema },
      detail: { summary: "The dashboard's counts, gated by grant and scope" },
    }
  );
