/**
 * The signed-in person's own muster, for the mobile app (docs/prd.md, Mobile
 * app → User).
 *
 * Every answer is about the caller's own NIK, read from the account, never
 * from the request, so the `self` macro needs no menu. FTW and attendance
 * history are not here: the existing lists answer a `self` caller with their
 * own rows, and a second route for the same rows would be a second place to
 * get the scope wrong.
 */

import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { Elysia, t } from "elysia";
import {
  PERSON_NOTIFICATION_KINDS,
  PUSH_PLATFORMS,
  SHIFT_KINDS,
} from "@universe/contracts";

import { requireSelf } from "../auth/macro";
import { currentShift } from "../current-shift";
import { db, schema } from "../db";
import { myShift } from "../my-shift";
import { myNotifications } from "../person-notify";
import { registerDevice, unregisterDevice } from "../push/devices";
import { localDate } from "../scheduler";
import { shiftGates } from "../stage-time";
import { ErrorSchema } from "./schemas";

const noEmployee = {
  code: "no_employee",
  message: "Akun ini tidak terhubung ke data karyawan",
};

/** As the FTW and attendance lists bound theirs. */
const MAX_RANGE_DAYS = 62;
const invalidRange = {
  code: "invalid_range",
  message: `Rentang tanggal terbalik atau lebih dari ${MAX_RANGE_DAYS} hari`,
};
/** NaN for a date that does not parse, which the guard below refuses. */
const rangeDays = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
    (24 * 60 * 60 * 1000) +
  1;
const SHIFT_ORDER = { day: 0, night: 1 } as const;

const SeatSchema = t.Object({
  unit: t.String(),
  area: t.Nullable(t.String()),
  bus: t.Nullable(t.String()),
  fleet: t.Nullable(t.String()),
});

const MyShiftSchema = t.Object({
  date: t.String(),
  shift: t.UnionEnum(SHIFT_KINDS),
  roster: t.Nullable(t.String()),
  phase: t.UnionEnum(["plan", "board"]),
  status: t.UnionEnum(["holder", "spare", "off", "not-allocated"]),
  reason: t.Nullable(
    t.UnionEnum([
      "breakdown",
      "not-in-fleet",
      "ineligible",
      "partner-rostered",
      "no-plan-seat",
      "awaiting-second-finger",
      "not-seated",
    ])
  ),
  refusal: t.Nullable(t.String()),
  planUnit: t.Nullable(t.String()),
  seat: t.Nullable(SeatSchema),
  ftw: t.Nullable(
    t.Object({
      verdict: t.Nullable(
        t.UnionEnum([
          "pass",
          "fail",
          "late",
          "missing",
          "unreadable",
          "not-required",
        ])
      ),
      sentAt: t.Nullable(t.String()),
      sleepMinutes: t.Nullable(t.Number()),
      category: t.Nullable(t.String()),
    })
  ),
  checkInAt: t.Nullable(t.String()),
});

const PersonNotificationSchema = t.Object({
  id: t.String(),
  kind: t.UnionEnum(PERSON_NOTIFICATION_KINDS),
  date: t.String(),
  shift: t.UnionEnum(SHIFT_KINDS),
  /** The kind's own facts (`@universe/contracts`); the app words them. */
  params: t.Record(t.String(), t.Unknown()),
  availableAt: t.String(),
  readAt: t.Nullable(t.String()),
});

const notFound = {
  code: "not_found",
  message: "Notifikasi tidak ditemukan",
};

/** The caller's own rows that have come due: what read marks may touch. */
async function ownVisibleIds(nik: string, now: Date, id?: string) {
  const rows = await db
    .select({ id: schema.personNotifications.id })
    .from(schema.personNotifications)
    .innerJoin(
      schema.employees,
      eq(schema.employees.id, schema.personNotifications.employeeId)
    )
    .where(
      and(
        eq(schema.employees.nik, nik),
        lte(schema.personNotifications.availableAt, now),
        ...(id ? [eq(schema.personNotifications.id, id)] : [])
      )
    );
  return rows.map((r) => r.id);
}

const PastSeatSchema = t.Object({
  date: t.String(),
  shift: t.UnionEnum(SHIFT_KINDS),
  unit: t.String(),
  area: t.Nullable(t.String()),
  bus: t.Nullable(t.String()),
  fleet: t.Nullable(t.String()),
  source: t.UnionEnum(["plan", "spare", "manual"]),
});

export const meRoutes = new Elysia({ prefix: "/me", tags: ["me"] })
  .use(requireSelf)

  .get(
    "/shift",
    async ({ principal, status }) => {
      if (principal.kind !== "user" || !principal.nik)
        return status(404, noEmployee);
      return { shift: await myShift(principal.nik, new Date()) };
    },
    {
      self: true,
      response: {
        /* Null when the timeline cannot say which shift is running, the
           case in which the walls refuse to guess too. */
        200: t.Object({ shift: t.Nullable(MyShiftSchema) }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: {
        summary: "My coming shift: holder or spare, why, and my FTW and tap",
      },
    }
  )

  .get(
    "/seats",
    async ({ principal, query, status }) => {
      if (principal.kind !== "user" || !principal.nik)
        return status(404, noEmployee);
      const span = rangeDays(query.from, query.to);
      if (!(span >= 1 && span <= MAX_RANGE_DAYS))
        return status(422, invalidRange);

      const rows = await db
        .select({
          date: schema.fleetActualDocuments.date,
          shift: schema.fleetActualDocuments.shift,
          unit: schema.units.code,
          area: schema.fleetActualSlots.workArea,
          bus: schema.fleetActualSlots.transportCode,
          fleet: schema.fleetActualFleets.leaderCode,
          source: schema.fleetActualSlots.source,
        })
        .from(schema.fleetActualSlots)
        .innerJoin(
          schema.fleetActualDocuments,
          eq(schema.fleetActualDocuments.id, schema.fleetActualSlots.documentId)
        )
        .innerJoin(
          schema.employees,
          eq(schema.employees.id, schema.fleetActualSlots.employeeId)
        )
        .innerJoin(
          schema.units,
          eq(schema.units.id, schema.fleetActualSlots.unitId)
        )
        .leftJoin(
          schema.fleetActualFleets,
          eq(schema.fleetActualFleets.id, schema.fleetActualSlots.boardFleetId)
        )
        .where(
          and(
            eq(schema.employees.nik, principal.nik),
            gte(schema.fleetActualDocuments.date, query.from),
            lte(schema.fleetActualDocuments.date, query.to)
          )
        )
        .orderBy(
          desc(schema.fleetActualDocuments.date),
          desc(schema.fleetActualDocuments.shift)
        );

      /* Only shifts strictly before the running one. The running shift and
         anything after it are `/me/shift`'s to tell, held back until the
         second finger as the slip is; a board built early for a coming shift
         would otherwise hand a spare their unit here (security review,
         2026-10-17). With no running shift to measure from, before today. */
      const now = new Date();
      const running = currentShift(now, await shiftGates()) ?? {
        date: localDate(now),
        shift: "day" as const,
      };
      const past = (r: { date: string; shift: "day" | "night" }) =>
        r.date < running.date ||
        (r.date === running.date &&
          SHIFT_ORDER[r.shift] < SHIFT_ORDER[running.shift]);
      return {
        seats: rows.filter(past).map((r) => ({
          date: r.date,
          shift: r.shift,
          unit: r.unit,
          area: r.area ?? null,
          bus: r.bus ?? null,
          fleet: r.fleet ?? null,
          source: r.source ?? "manual",
        })),
      };
    },
    {
      self: true,
      query: t.Object({
        from: t.String({ format: "date" }),
        to: t.String({ format: "date" }),
      }),
      response: {
        200: t.Object({ seats: t.Array(PastSeatSchema) }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "The units I held on past boards" },
    }
  )

  .get(
    "/notifications",
    async ({ principal, status }) => {
      if (principal.kind !== "user" || !principal.nik)
        return status(404, noEmployee);
      const { items, unread } = await myNotifications(
        principal.nik,
        new Date()
      );
      return {
        items: items.map((i) => ({
          ...i,
          params: i.params as Record<string, unknown>,
          availableAt: i.availableAt.toISOString(),
          readAt: i.readAt ? i.readAt.toISOString() : null,
        })),
        unread,
      };
    },
    {
      self: true,
      response: {
        200: t.Object({
          items: t.Array(PersonNotificationSchema),
          unread: t.Number(),
        }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "My own notifications that have come due" },
    }
  )

  .post(
    "/notifications/:id/read",
    async ({ params, principal, status }) => {
      if (principal.kind !== "user" || !principal.nik)
        return status(404, noEmployee);
      /* Somebody else's, or one not yet due, is the same 404 as none: which
         of those it is is not the caller's business. */
      const [id] = await ownVisibleIds(principal.nik, new Date(), params.id);
      if (!id) return status(404, notFound);
      await db
        .update(schema.personNotifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(schema.personNotifications.id, id),
            isNull(schema.personNotifications.readAt)
          )
        );
      return { ok: true };
    },
    {
      self: true,
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Mark one of my notifications read" },
    }
  )

  .post(
    "/notifications/read-all",
    async ({ principal, status }) => {
      if (principal.kind !== "user" || !principal.nik)
        return status(404, noEmployee);
      const ids = await ownVisibleIds(principal.nik, new Date());
      if (ids.length)
        await db
          .update(schema.personNotifications)
          .set({ readAt: new Date() })
          .where(
            and(
              inArray(schema.personNotifications.id, ids),
              isNull(schema.personNotifications.readAt)
            )
          );
      return { ok: true };
    },
    {
      self: true,
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Mark all my due notifications read" },
    }
  )

  /*
   * The phone asking for pushes. Any person may: an account with no NIK
   * simply never has a seat to be told about.
   */
  .post(
    "/push-devices",
    async ({ body, principal, sessionId, status }) => {
      if (principal.kind !== "user") return status(404, noEmployee);
      await registerDevice({
        userId: principal.id,
        sessionId,
        token: body.token,
        platform: body.platform,
      });
      return { ok: true };
    },
    {
      self: true,
      body: t.Object({
        /** FCM's registration token, or the APNs device token. */
        token: t.String({ minLength: 1, maxLength: 4096 }),
        platform: t.UnionEnum(PUSH_PLATFORMS),
      }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Receive pushes on this phone" },
    }
  )

  .delete(
    "/push-devices",
    async ({ body, principal, status }) => {
      if (principal.kind !== "user") return status(404, noEmployee);
      await unregisterDevice(principal.id, body.token);
      return { ok: true };
    },
    {
      self: true,
      body: t.Object({
        token: t.String({ minLength: 1, maxLength: 4096 }),
      }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Stop pushes to this phone" },
    }
  );
