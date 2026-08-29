/**
 * The allocation schedule as configuration — both shifts of it.
 *
 * These rows are what `scheduler.ts` reads each minute. Editing a stage's time
 * changes when it next fires with no deploy, which is the point — the schedule
 * is an operational decision, not a constant.
 *
 * `shift` is what lets two rows carry the same action twelve hours apart: the
 * day's finger-in deadline and the night's are the same kind of thing at
 * different times, and a reader asking for one must not have to compare clocks
 * to work out which is which.
 */

import { asc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { requireAuth } from "../auth/macro";
import { db, schema, type TimelineStageRow } from "../db";
import {
  ErrorSchema,
  OptionalShiftKindSchema,
  OptionalTimelineActionSchema,
  TimelineActionSchema,
  TimelineStageSchema,
} from "./schemas";

/** Postgres `time` reads back "HH:MM:SS"; the schedule is to the minute. */
const toStage = (row: TimelineStageRow) => ({
  id: row.id,
  name: row.name,
  at: row.at.slice(0, 5),
  action: row.action,
  shift: row.shift,
  active: row.active,
  createdAt: row.createdAt.toISOString(),
});

const notFound = {
  code: "stage_not_found",
  message: "Tahapan tidak ditemukan",
};

const AT_PATTERN = "^([01][0-9]|2[0-3]):[0-5][0-9]$";

export const timelineRoutes = new Elysia({
  prefix: "/timeline",
  tags: ["timeline"],
})
  .use(requireAuth)

  .get(
    "/",
    async () => {
      const rows = await db
        .select()
        .from(schema.timelineStages)
        .orderBy(asc(schema.timelineStages.at));
      return rows.map(toStage);
    },
    {
      auth: { menu: "timeline", mode: "view" },
      response: {
        200: t.Array(TimelineStageSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "List the allocation schedule" },
    }
  )

  .post(
    "/",
    async ({ body, status }) => {
      const name = body.name.trim();
      if (!name)
        return status(422, {
          code: "validation_failed",
          message: "Nama tahap tidak boleh kosong",
        });
      const [row] = await db
        .insert(schema.timelineStages)
        .values({
          name,
          at: `${body.at}:00`,
          action: body.action,
          shift: body.shift ?? null,
          active: body.active ?? true,
        })
        .returning();
      return status(201, toStage(row!));
    },
    {
      auth: { menu: "timeline", mode: "manage" },
      // `action` is required rather than optional: an optional enum injects its
      // first value when absent, which would silently make an unspecified stage
      // an FTW deadline. An unknown value is refused by the schema with 422.
      body: t.Object({
        name: t.String({ minLength: 1 }),
        at: t.String({ pattern: AT_PATTERN }),
        action: TimelineActionSchema,
        // Optional *and* nullable, unlike `action`: a stage governing neither
        // shift is a real thing (the `other` markers), so absent means null
        // rather than a value the caller never chose. It must be the
        // spelled-out union — `t.UnionEnum` injects its first value when the
        // field is absent, which made an unspecified stage a day stage.
        shift: OptionalShiftKindSchema,
        active: t.Optional(t.Boolean()),
      }),
      response: {
        201: TimelineStageSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Add a stage to the allocation schedule" },
    }
  )

  .patch(
    "/:id",
    async ({ params, body, status }) => {
      const [row] = await db
        .update(schema.timelineStages)
        .set({
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.at !== undefined ? { at: `${body.at}:00` } : {}),
          ...(body.action !== undefined ? { action: body.action } : {}),
          ...(body.shift !== undefined ? { shift: body.shift } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        })
        .where(eq(schema.timelineStages.id, params.id))
        .returning();
      if (!row) return status(404, notFound);
      return toStage(row);
    },
    {
      auth: { menu: "timeline", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        at: t.Optional(t.String({ pattern: AT_PATTERN })),
        action: OptionalTimelineActionSchema,
        shift: OptionalShiftKindSchema,
        active: t.Optional(t.Boolean()),
      }),
      response: {
        200: TimelineStageSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Edit a stage" },
    }
  )

  .delete(
    "/:id",
    async ({ params, status }) => {
      const [row] = await db
        .delete(schema.timelineStages)
        .where(eq(schema.timelineStages.id, params.id))
        .returning({ id: schema.timelineStages.id });
      if (!row) return status(404, notFound);
      return { ok: true };
    },
    {
      auth: { menu: "timeline", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Remove a stage" },
    }
  );
