/**
 * The morning allocation schedule as configuration.
 *
 * These rows are what `scheduler.ts` reads each minute. Editing a stage's time
 * changes when it next fires with no deploy, which is the point — the schedule
 * is an operational decision, not a constant.
 */

import { asc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { requireAuth } from "../auth/macro";
import { db, schema, type TimelineStageRow } from "../db";
import {
  ErrorSchema,
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
