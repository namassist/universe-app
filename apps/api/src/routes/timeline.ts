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

import { and, asc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import {
  TIMELINE_ACTION_LABELS,
  type ShiftKind,
  type TimelineAction,
} from "@universe/contracts";

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

/**
 * The order the muster's gates have to keep, and why each pair matters.
 *
 * Not the whole schedule — only the two relationships where getting it wrong
 * damages a morning rather than merely looking odd.
 *
 * `spare-validate` **after** `finger-in`: a board built before the tap
 * deadline judges people who were still entitled to arrive, and because a
 * stage is claimed once it fires, that wrong board is the one the yard uses
 * until the bus leaves. There is no second attempt.
 *
 * A pull **at or before** the deadline it runs until: a window is the span
 * between the two, so opening a pull after its own deadline is a window of
 * nothing — which is how the readings tables stood still all morning before
 * they ran until their deadlines at all.
 */
const ORDER: {
  action: TimelineAction;
  against: TimelineAction;
  /** `after`: strictly later. `notAfter`: at or before. */
  rule: "after" | "notAfter";
  why: string;
}[] = [
  {
    action: "spare-validate",
    against: "finger-in",
    rule: "after",
    why: "papan tidak boleh dibangun sebelum batas tap lewat",
  },
  {
    action: "finger-ingest",
    against: "finger-in",
    rule: "notAfter",
    why: "penarikan berjalan sampai batasnya, jadi tidak boleh dibuka setelahnya",
  },
  {
    action: "ftw-ingest",
    against: "ftw-deadline",
    rule: "notAfter",
    why: "penarikan berjalan sampai batasnya, jadi tidak boleh dibuka setelahnya",
  },
];

/**
 * Whether a stage would sit out of order, as the message to refuse it with.
 *
 * `null` when it is fine, when it governs no shift — the `other` markers sit
 * outside the muster's order entirely — or when its partner is not configured,
 * which the engine already refuses at dispatch with a message naming the
 * missing stage.
 *
 * Compared against the **latest** partner for `after` and the **earliest** for
 * `notAfter`: a schedule carrying two rows for one gate is already ambiguous —
 * `stageTimeOf` takes whichever the database hands back first — so the
 * conservative end is the honest one to hold a new stage to.
 */
async function outOfOrder(stage: {
  at: string;
  action: TimelineAction;
  shift: ShiftKind | null;
  active: boolean;
}): Promise<string | null> {
  if (!stage.shift || !stage.active) return null;
  const rule = ORDER.find((r) => r.action === stage.action);
  if (!rule) return null;

  const rows = await db
    .select({ at: schema.timelineStages.at })
    .from(schema.timelineStages)
    .where(
      and(
        eq(schema.timelineStages.action, rule.against),
        eq(schema.timelineStages.shift, stage.shift),
        eq(schema.timelineStages.active, true)
      )
    );
  if (!rows.length) return null;

  const times = rows.map((r) => r.at.slice(0, 5)).sort();
  const partner = rule.rule === "after" ? times[times.length - 1]! : times[0]!;
  const ok = rule.rule === "after" ? stage.at > partner : stage.at <= partner;
  if (ok) return null;

  const label = TIMELINE_ACTION_LABELS[stage.action];
  const other = TIMELINE_ACTION_LABELS[rule.against];
  return rule.rule === "after"
    ? `"${label}" harus setelah "${other}" (${partner}), bukan ${stage.at} — ${rule.why}`
    : `"${label}" harus sebelum atau sama dengan "${other}" (${partner}), bukan ${stage.at} — ${rule.why}`;
}

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

      const disorder = await outOfOrder({
        at: body.at,
        action: body.action,
        shift: body.shift ?? null,
        active: body.active ?? true,
      });
      if (disorder)
        return status(422, { code: "stage_out_of_order", message: disorder });

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
      /* Read first, because a patch is partial: the rule is about the stage
         the edit would leave behind, not about the fields it mentions. */
      const [before] = await db
        .select()
        .from(schema.timelineStages)
        .where(eq(schema.timelineStages.id, params.id))
        .limit(1);
      if (!before) return status(404, notFound);

      const disorder = await outOfOrder({
        at: body.at ?? before.at.slice(0, 5),
        action: body.action ?? before.action,
        shift: body.shift !== undefined ? body.shift : before.shift,
        active: body.active ?? before.active,
      });
      if (disorder)
        return status(422, { code: "stage_out_of_order", message: disorder });

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
        422: ErrorSchema,
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
