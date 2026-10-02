/**
 * The first day back from leave is induction, not a shift on a unit (owner,
 * 2026-10-02).
 *
 * Somebody rostered `D` or `N` today whose yesterday was `CR`, `TRV` or `AL`
 * is put on `standby` for the day — the status allocation, tickets and the
 * screens already read as "not on a unit today". Nothing downstream learns a
 * new rule: the plan keeps their slot (it admits `standby`), the engine draws
 * only from `aktif` and so leaves the seat to the spare pool, and the board and
 * a ticket refuse them as they would anyone on light duty.
 *
 * The status is the only thing touched, and only `aktif → standby` — a
 * `nonaktif` person has left and a hand-set `standby` is an admin's decision,
 * so neither is ours to hold or to release. `induction_holds` records exactly
 * the writes this module made, and releasing undoes those and nothing else:
 * back to `aktif` only while the person is still `standby`, because an admin
 * who changed them in between said something newer than we did.
 *
 * Reconciling rather than applying: the roster is re-pulled twice a day, and a
 * return revised away upstream must stop holding the person this same day.
 *
 * It reaches the engine through those statuses and no other way, and three
 * guards keep it to that:
 *
 * - **A cap.** A run that would hold more than `MAX_HOLD_FLOOR` or
 *   `MAX_HOLD_SHARE` of today's scheduled operators holds nobody: October 2026
 *   peaked at 27 returns, 4.1% of the day, so a crowd is bad data — a
 *   re-pulled month reading CR for everyone — not a busy morning. Refusing
 *   leaves the board exactly as it was before this check existed.
 * - **Time limits.** The writes run under a lock and statement timeout, so a
 *   row held by an admin's edit at 05:26 costs the holds, not the board.
 * - **A switch.** `INDUCTION_HOLD_ENABLED=false` holds nobody and releases
 *   every open hold on the next run — the rollback, without a deploy.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  DAY_SHIFT_CODE,
  INDUCTION_TRIGGER_CODES,
  NIGHT_SHIFT_CODE,
  type RosterCode,
} from "@universe/contracts";

import { db, schema } from "./db";
import { env } from "./env";
import { rosterDayInForce } from "./roster-in-force";

export type InductionHoldResult = {
  held: number;
  released: number;
  /** Back from leave but not held, because there were too many to be true. */
  refused: number;
};

/** Never refuse fewer than this — a small site's normal Monday. */
const MAX_HOLD_FLOOR = 30;
/** Of today's scheduled operators; 2.4× the worst day on record. */
const MAX_HOLD_SHARE = 0.1;

/** The calendar day before a `YYYY-MM-DD` date. */
function dayBefore(date: string): string {
  const at = new Date(`${date}T00:00:00Z`);
  return new Date(at.getTime() - 86_400_000).toISOString().slice(0, 10);
}

/** Employees with one of `codes` on `date`, in the document in force. */
async function rostered(date: string, codes: readonly RosterCode[]) {
  const rows = await db
    .select({ employeeId: schema.rosterDays.employeeId })
    .from(schema.rosterDays)
    .where(
      and(
        eq(schema.rosterDays.date, date),
        inArray(schema.rosterDays.code, [...codes]),
        rosterDayInForce
      )
    );
  return new Set(rows.map((r) => r.employeeId));
}

/**
 * Who is back from leave on `date`, among the people allocation reads — and
 * how many of those people are scheduled at all, which is what the cap is a
 * share of.
 */
async function firstDayBack(
  date: string
): Promise<{ back: Set<string>; scheduled: number }> {
  const [today, yesterday] = await Promise.all([
    rostered(date, [DAY_SHIFT_CODE, NIGHT_SHIFT_CODE]),
    rostered(dayBefore(date), INDUCTION_TRIGGER_CODES),
  ]);
  if (![...today].some((id) => yesterday.has(id)))
    return { back: new Set(), scheduled: today.size };

  const operators = await db
    .select({ id: schema.employees.id })
    .from(schema.employees)
    .innerJoin(
      schema.positions,
      eq(schema.positions.id, schema.employees.positionId)
    )
    .where(
      and(
        inArray(schema.employees.id, [...today]),
        eq(schema.positions.fleetAllocation, true)
      )
    );
  return {
    back: new Set(operators.map((o) => o.id).filter((id) => yesterday.has(id))),
    scheduled: operators.length,
  };
}

/**
 * Bring the holds in line with `date`'s roster: hold who is back today,
 * release every other hold still standing.
 *
 * Idempotent — the scheduler calls it after each roster pull and again before
 * each board, and a second call for the same date changes nothing. A hold row
 * already written for today, released or not, is never re-applied: that is
 * what keeps a later run from overruling an admin who reactivated somebody.
 */
export async function reconcileInductionHolds(
  date: string,
  { enabled = env.INDUCTION_HOLD_ENABLED }: { enabled?: boolean } = {}
): Promise<InductionHoldResult> {
  let back = new Set<string>();
  let refused = 0;
  if (enabled) {
    const found = await firstDayBack(date);
    const cap = Math.max(
      MAX_HOLD_FLOOR,
      Math.floor(found.scheduled * MAX_HOLD_SHARE)
    );
    if (found.back.size > cap) {
      refused = found.back.size;
      console.error(
        `[induction] ${date}: ${refused} back from leave of ${found.scheduled} ` +
          `scheduled is over the cap of ${cap} — holding nobody; check the roster`
      );
    } else back = found.back;
  }

  return db.transaction(async (tx) => {
    /* Local to this transaction: whatever it waits on, the board waits on. */
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx.execute(sql`set local statement_timeout = '15s'`);

    const open = await tx
      .select({
        id: schema.inductionHolds.id,
        employeeId: schema.inductionHolds.employeeId,
        date: schema.inductionHolds.date,
      })
      .from(schema.inductionHolds)
      .where(isNull(schema.inductionHolds.releasedAt));

    const ending = open.filter(
      (h) => h.date !== date || !back.has(h.employeeId)
    );
    if (ending.length) {
      await tx
        .update(schema.employees)
        .set({ status: "aktif" })
        .where(
          and(
            inArray(
              schema.employees.id,
              ending.map((h) => h.employeeId)
            ),
            eq(schema.employees.status, "standby")
          )
        );
      await tx
        .update(schema.inductionHolds)
        .set({ releasedAt: new Date() })
        .where(
          inArray(
            schema.inductionHolds.id,
            ending.map((h) => h.id)
          )
        );
    }

    let held = 0;
    if (back.size) {
      const recorded = await tx
        .select({ employeeId: schema.inductionHolds.employeeId })
        .from(schema.inductionHolds)
        .where(
          and(
            eq(schema.inductionHolds.date, date),
            inArray(schema.inductionHolds.employeeId, [...back])
          )
        );
      const already = new Set(recorded.map((r) => r.employeeId));
      const fresh = [...back].filter((id) => !already.has(id));

      if (fresh.length) {
        const placed = await tx
          .update(schema.employees)
          .set({ status: "standby" })
          .where(
            and(
              inArray(schema.employees.id, fresh),
              eq(schema.employees.status, "aktif")
            )
          )
          .returning({ id: schema.employees.id });
        if (placed.length)
          await tx
            .insert(schema.inductionHolds)
            .values(placed.map((p) => ({ employeeId: p.id, date })));
        held = placed.length;
      }
    }

    return { held, released: ending.length, refused };
  });
}
