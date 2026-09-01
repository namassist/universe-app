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
 */

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { Elysia } from "elysia";
import {
  type EffectivePermissions,
  type MenuSlug,
  type SessionPrincipal,
} from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { scopeWhere } from "../auth/scope";
import { db, schema } from "../db";
import { localDate } from "../scheduler";
import { DashboardSchema, ErrorSchema } from "./schemas";

/** Holding any of these is enough for a section. */
const holds = (permissions: EffectivePermissions, ...menus: MenuSlug[]) =>
  menus.some((menu) => permissions[menu] !== undefined);

/** A kiosk is offline once it has missed this much of its heartbeat. */
const OFFLINE_AFTER_SECONDS = 180;
/** How near an expiry has to be before the dashboard calls it "soon". */
const SIMPER_SOON_DAYS = 30;
/** The panel is a preview that ends in "open the menu", never the menu. */
const ATTENTION_PER_KIND = 10;

/**
 * One person's day: what the roster says, whether the two readings arrived,
 * the unit today's board seated them on, and anything they are waiting on.
 *
 * Small separate reads rather than one join: they answer different questions
 * about different tables, and a single query would left-join five ways to
 * produce one row that is mostly nulls.
 */
async function personalDay(nik: string, today: string) {
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
        eq(schema.rosterDays.date, today)
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

  /* Whichever of today's boards seated them. Both shifts are searched: an
     operator reading this at 04:00 is on the day board and one reading it at
     20:00 is on the night board, and neither should have to say so. */
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
        eq(schema.fleetActualSlots.employeeId, employee.id)
      )
    )
    .limit(1);

  const [pending] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.rosterRevisionItems)
    .where(
      and(
        eq(schema.rosterRevisionItems.employeeId, employee.id),
        eq(schema.rosterRevisionItems.status, "pending")
      )
    );

  return {
    name: employee.name,
    nik,
    rosterCode: roster?.code ?? null,
    ftwDecision: ftw?.decision ?? null,
    tappedAt: finger?.firstInAt ?? finger?.firstInPmAt ?? null,
    unitCode: seat?.unitCode ?? null,
    unitSource: seat?.source ?? null,
    pendingRevisions: pending?.count ?? 0,
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
      const today = localDate(new Date());
      const person = principal as Extract<SessionPrincipal, { kind: "user" }>;

      /* Scoped to whoever is asking: a department admin counts their own
         department, a `self` account counts only themselves — which is why
         `self` gets `me` below instead of aggregates that would all read 1. */
      const mine = await scopeWhere(principal, {
        dept: schema.employees.departmentId,
        self: schema.employees.nik,
      });
      /**
       * The denominator every attendance figure is read against, and the
       * easiest thing here to get wrong: 990 people carry a roster row for
       * today, but 322 of them are off, on leave, travelling or sick. Counting
       * presence against 990 makes an ordinary day look like a crisis, every
       * day. `D` and `N` are the only codes that schedule a shift.
       */
      const scheduledToday = and(
        eq(schema.employees.status, "aktif"),
        eq(schema.rosterDays.date, today),
        sql`${schema.rosterDays.code} in ('D','N')`,
        mine
      );

      const attendance = holds(permissions, "attendance")
        ? (
            await db
              .select({
                scheduled: sql<number>`count(*)::int`,
                tapped: sql<number>`count(*) filter (
                  where ${schema.fingerReadings.firstInAt} is not null
                     or ${schema.fingerReadings.firstInPmAt} is not null)::int`,
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
              .where(scheduledToday)
          )[0]
        : null;

      const ftw = holds(permissions, "fit-to-work")
        ? (
            await db
              .select({
                scheduled: sql<number>`count(*)::int`,
                fit: sql<number>`count(*) filter (
                  where ${schema.ftwReadings.ftwDecision} ilike '%aman%')::int`,
                followUp: sql<number>`count(*) filter (
                  where ${schema.ftwReadings.ftwDecision} is not null
                    and ${schema.ftwReadings.ftwDecision} not ilike '%aman%')::int`,
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
              .where(scheduledToday)
          )[0]
        : null;

      /* ---- machine-shaped sections: the grant is the only gate ---------- */

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

      /* Items, not documents: a revision is decided line by line, so the
         number somebody has to act on is the line count. The document count
         rides along because that is what the queue lists. */
      const revisions = holds(permissions, "roster-revision", "roster-approval")
        ? (
            await db
              .select({
                pendingItems: sql<number>`count(*)::int`,
                pendingDocs: sql<number>`count(distinct ${schema.rosterRevisionItems.revisionId})::int`,
              })
              .from(schema.rosterRevisionItems)
              .where(eq(schema.rosterRevisionItems.status, "pending"))
          )[0]
        : null;

      const devices = holds(
        permissions,
        "display-attendance",
        "display-fleet",
        "display-fitwork",
        "monitoring-fingerprint"
      )
        ? (
            await db
              .select({
                total: sql<number>`count(*)::int`,
                offline: sql<number>`count(*) filter (
                  where ${schema.devices.lastSeenAt} is null
                     or ${schema.devices.lastSeenAt} < now() - ${sql.raw(`interval '${OFFLINE_AFTER_SECONDS} seconds'`)})::int`,
              })
              .from(schema.devices)
              .where(eq(schema.devices.active, true))
          )[0]
        : null;

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
       * Units a standing operator holds and no formation claims.
       *
       * The signature of a configuration gap rather than a deliberate
       * omission: a grader kept outside the fleets carries no standing pairing
       * either, while a hauler with a named operator and no formation is one
       * somebody has not finished setting up. Those units are invisible to the
       * engine, and their operators are quietly redeployed as spares.
       */
      const fleetConfig = holds(permissions, "fleet-setting")
        ? (
            await db
              .select({
                unitsWithOperatorNoFleet: sql<number>`count(distinct ${schema.units.id})::int`,
              })
              .from(schema.units)
              .innerJoin(
                schema.fleetPlanSlots,
                eq(schema.fleetPlanSlots.unitId, schema.units.id)
              )
              .where(
                and(
                  eq(schema.units.active, true),
                  sql`not exists (select 1 from fleets f where f.digger_unit_id = ${schema.units.id})`,
                  sql`not exists (select 1 from fleet_units fu where fu.unit_id = ${schema.units.id})`
                )
              )
          )[0]
        : null;

      /**
       * Today's boards, one line per shift that has one.
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
              generatedAt: sql<string>`${schema.fleetActualDocuments.generatedAt}::text`,
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
      const me = person.nik ? await personalDay(person.nik, today) : null;

      /* ---- the attention panel -----------------------------------------
         Facts, not sentences: the row carries who and what, and the screen
         composes the wording and the badge in the reader's language. Each
         kind is capped — this is a preview that ends in "open the menu",
         never the menu itself. */
      const attention: {
        kind: "breakdown" | "unfit" | "absent" | "display";
        name: string;
        sub: string;
        dept: string;
        detail: string | null;
      }[] = [];

      if (holds(permissions, "unit-status")) {
        const rows = await db
          .select({
            code: schema.units.code,
            type: schema.unitTypes.name,
            dept: schema.departments.name,
          })
          .from(schema.units)
          .innerJoin(
            schema.unitTypes,
            eq(schema.unitTypes.id, schema.units.typeId)
          )
          .leftJoin(
            schema.departments,
            eq(schema.departments.id, schema.units.departmentId)
          )
          .where(
            and(eq(schema.units.active, true), eq(schema.units.breakdown, true))
          )
          .orderBy(schema.units.code)
          .limit(ATTENTION_PER_KIND);
        for (const row of rows)
          attention.push({
            kind: "breakdown",
            name: row.code,
            sub: row.type,
            dept: row.dept ?? "—",
            detail: null,
          });
      }

      if (holds(permissions, "fit-to-work")) {
        const rows = await db
          .select({
            name: schema.employees.name,
            nik: schema.employees.nik,
            dept: schema.departments.name,
            decision: schema.ftwReadings.ftwDecision,
          })
          .from(schema.employees)
          .innerJoin(
            schema.rosterDays,
            eq(schema.rosterDays.employeeId, schema.employees.id)
          )
          .innerJoin(
            schema.departments,
            eq(schema.departments.id, schema.employees.departmentId)
          )
          .innerJoin(
            schema.ftwReadings,
            and(
              eq(schema.ftwReadings.nik, schema.employees.nik),
              eq(schema.ftwReadings.date, today)
            )
          )
          .where(
            and(
              scheduledToday,
              sql`${schema.ftwReadings.ftwDecision} not ilike '%aman%'`
            )
          )
          .limit(ATTENTION_PER_KIND);
        for (const row of rows)
          attention.push({
            kind: "unfit",
            name: row.name,
            sub: row.nik,
            dept: row.dept,
            detail: row.decision,
          });
      }

      if (holds(permissions, "attendance")) {
        const rows = await db
          .select({
            name: schema.employees.name,
            nik: schema.employees.nik,
            dept: schema.departments.name,
            code: schema.rosterDays.code,
          })
          .from(schema.employees)
          .innerJoin(
            schema.rosterDays,
            eq(schema.rosterDays.employeeId, schema.employees.id)
          )
          .innerJoin(
            schema.departments,
            eq(schema.departments.id, schema.employees.departmentId)
          )
          .leftJoin(
            schema.fingerReadings,
            and(
              eq(schema.fingerReadings.nik, schema.employees.nik),
              eq(schema.fingerReadings.date, today)
            )
          )
          .where(
            and(
              scheduledToday,
              sql`${schema.fingerReadings.firstInAt} is null
                  and ${schema.fingerReadings.firstInPmAt} is null`
            )
          )
          .orderBy(schema.employees.name)
          .limit(ATTENTION_PER_KIND);
        for (const row of rows)
          attention.push({
            kind: "absent",
            name: row.name,
            sub: row.nik,
            dept: row.dept,
            detail: row.code,
          });
      }

      if (holds(permissions, "display-attendance", "display-fleet")) {
        const rows = await db
          .select({ id: schema.devices.id, name: schema.devices.name })
          .from(schema.devices)
          .where(
            and(
              eq(schema.devices.active, true),
              sql`${schema.devices.lastSeenAt} is null
                  or ${schema.devices.lastSeenAt} < now() - ${sql.raw(`interval '${OFFLINE_AFTER_SECONDS} seconds'`)}`
            )
          )
          .orderBy(schema.devices.id)
          .limit(ATTENTION_PER_KIND);
        for (const row of rows)
          attention.push({
            kind: "display",
            name: row.name,
            sub: row.id,
            dept: "—",
            detail: null,
          });
      }

      return {
        date: today,
        attendance: attendance ?? null,
        ftw: ftw ?? null,
        units: units ?? null,
        revisions: revisions ?? null,
        devices: devices ?? null,
        ingest,
        fleetConfig: fleetConfig ?? null,
        allocation,
        simper,
        me,
        attention,
      };
    },
    {
      auth: { menu: "dashboard", mode: "view" },
      response: { 200: DashboardSchema, 401: ErrorSchema, 403: ErrorSchema },
      detail: { summary: "The dashboard's counts, gated by grant and scope" },
    }
  );
