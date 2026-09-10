/**
 * What the application has told the people who run it, and marking it seen.
 *
 * Site-wide rows with per-person read marks: a board that failed to generate
 * is one event, not one message each, so the row is written once and everybody
 * with access reads the same one. Only *having seen it* belongs to a person.
 *
 * Behind a menu permission like every other screen, granted to superadmin and
 * manpower (owner). The bell in the topbar is behind the same grant — a bell
 * that is always empty because the reader may not see anything is worse than
 * no bell.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { requireAuth } from "../auth/macro";
import { db, schema } from "../db";
import { ErrorSchema, NotificationSchema } from "./schemas";

/** Newest first, capped: a bell and a page both read the recent end. */
const LIMIT = 100;

const notFound = {
  code: "notification_not_found",
  message: "Notifikasi tidak ditemukan",
};

export const notificationRoutes = new Elysia({
  prefix: "/notifications",
  tags: ["notifications"],
})
  .use(requireAuth)

  .get(
    "/",
    async ({ principal }) => {
      const rows = await db
        .select({
          id: schema.notifications.id,
          kind: schema.notifications.kind,
          tone: schema.notifications.tone,
          params: schema.notifications.params,
          createdAt: schema.notifications.createdAt,
          /* Read state is this caller's, joined rather than stored on the row
             — the row belongs to everybody. */
          read: sql<boolean>`${schema.notificationReads.userId} is not null`,
        })
        .from(schema.notifications)
        .leftJoin(
          schema.notificationReads,
          and(
            eq(
              schema.notificationReads.notificationId,
              schema.notifications.id
            ),
            eq(schema.notificationReads.userId, principal.id)
          )
        )
        .orderBy(desc(schema.notifications.createdAt))
        .limit(LIMIT);

      return rows.map((row) => ({
        ...row,
        params: (row.params ?? {}) as Record<string, unknown>,
        createdAt: row.createdAt.toISOString(),
      }));
    },
    {
      auth: { menu: "notifications", mode: "view" },
      response: {
        200: t.Array(NotificationSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "Recent notifications, newest first" },
    }
  )

  .post(
    "/:id/read",
    async ({ params, principal, status }) => {
      const [row] = await db
        .select({ id: schema.notifications.id })
        .from(schema.notifications)
        .where(eq(schema.notifications.id, params.id))
        .limit(1);
      if (!row) return status(404, notFound);

      /* Idempotent: marking something read twice is the same fact twice, and
         a double-click must not be an error. */
      await db
        .insert(schema.notificationReads)
        .values({ notificationId: row.id, userId: principal.id })
        .onConflictDoNothing();
      return { ok: true as const };
    },
    {
      auth: { menu: "notifications", mode: "manage" },
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Object({ ok: t.Literal(true) }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Mark one notification read" },
    }
  )

  .post(
    "/read-all",
    async ({ principal }) => {
      /* Only what this caller can actually see — the same window the list
         returns. Marking rows beyond it read would hide notifications the
         person was never shown. */
      const rows = await db
        .select({ id: schema.notifications.id })
        .from(schema.notifications)
        .orderBy(desc(schema.notifications.createdAt))
        .limit(LIMIT);
      if (!rows.length) return { ok: true as const, marked: 0 };

      const already = await db
        .select({ id: schema.notificationReads.notificationId })
        .from(schema.notificationReads)
        .where(
          and(
            eq(schema.notificationReads.userId, principal.id),
            inArray(
              schema.notificationReads.notificationId,
              rows.map((r) => r.id)
            )
          )
        );
      const seen = new Set(already.map((r) => r.id));
      const fresh = rows.filter((r) => !seen.has(r.id));
      if (fresh.length)
        await db
          .insert(schema.notificationReads)
          .values(
            fresh.map((r) => ({
              notificationId: r.id,
              userId: principal.id,
            }))
          )
          .onConflictDoNothing();

      return { ok: true as const, marked: fresh.length };
    },
    {
      auth: { menu: "notifications", mode: "manage" },
      response: {
        200: t.Object({ ok: t.Literal(true), marked: t.Integer() }),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "Mark every listed notification read" },
    }
  );
