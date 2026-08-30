/**
 * Reading a configured time out of the master timeline.
 *
 * One place, because two very different questions ask it and they must not
 * drift into two answers: the pass rule needs the `finger-in` gate, and the
 * fleet wall needs the `ftw-ingest` one that opens a shift's changeover.
 *
 * `null` — a missing or switched-off stage — is always a refusal, never a
 * default. The whole reason the schedule is a table is that moving a time is
 * an operational decision; a constant in code would quietly overrule it, and
 * both possible defaults are wrong in a way nobody sees.
 */

import { and, eq } from "drizzle-orm";
import type { ShiftKind, TimelineAction } from "@universe/contracts";

import { db, schema } from "./db";

export async function stageTimeOf(
  action: TimelineAction,
  shift: ShiftKind
): Promise<string | null> {
  const [row] = await db
    .select({ at: schema.timelineStages.at })
    .from(schema.timelineStages)
    .where(
      and(
        eq(schema.timelineStages.action, action),
        eq(schema.timelineStages.shift, shift),
        eq(schema.timelineStages.active, true)
      )
    )
    .limit(1);
  return row?.at ?? null;
}

/** Both shifts' times for one stage — what the wall needs to place `now`. */
export async function stageGates(
  action: TimelineAction
): Promise<{ day: string | null; night: string | null }> {
  const [day, night] = await Promise.all([
    stageTimeOf(action, "day"),
    stageTimeOf(action, "night"),
  ]);
  return { day, night };
}
