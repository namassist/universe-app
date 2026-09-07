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

/**
 * When each shift takes over the walls.
 *
 * `shift-start` if the timeline names it, `ftw-ingest` otherwise. The fallback
 * is the whole point: this used to *be* `ftw-ingest`, so an installation that
 * has not added the new stages keeps the changeover it already had, and the
 * release changes nothing until somebody decides it should.
 *
 * Both halves or neither. A timeline carrying only the night `shift-start`
 * would otherwise pair it with the morning's FTW pull — a boundary assembled
 * from two different intentions, which is exactly the kind of half-answer the
 * rest of this module refuses to invent.
 */
export async function shiftGates(): Promise<{
  day: string | null;
  night: string | null;
}> {
  const named = await stageGates("shift-start");
  if (named.day && named.night) {
    halfConfigured = false;
    return named;
  }
  warnIfHalfConfigured(named);
  return stageGates("ftw-ingest");
}

/**
 * Whether the half-configured warning has already been given.
 *
 * The walls poll this several times a minute, so a bare `console.warn` would
 * bury the log. Warn on entering the state and stay quiet while it lasts —
 * and clear the flag on the way out, so configuring it wrongly a second time
 * says so a second time.
 */
let halfConfigured = false;

/**
 * One stage without its partner is the quiet failure this whole module exists
 * to avoid: the timeline shows a changeover, the scheduler logs it firing, and
 * the walls go on using a time nobody set. Nothing else would say so.
 */
function warnIfHalfConfigured(named: {
  day: string | null;
  night: string | null;
}): void {
  const half = Boolean(named.day) !== Boolean(named.night);
  if (!half) {
    halfConfigured = false;
    return;
  }
  if (halfConfigured) return;
  halfConfigured = true;
  const missing = named.day ? "night" : "day";
  console.warn(
    `[timeline] a "shift-start" stage is set for one shift but not the other ` +
      `(${missing} is missing), so it is ignored and the displays keep ` +
      `turning over at "ftw-ingest". Add the ${missing} half to use it.`
  );
}
