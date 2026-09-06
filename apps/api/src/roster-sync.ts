/**
 * The roster mirror: unggul_att → `roster_days`, once a day.
 *
 * unggul_att owns the schedule. This module is the only writer of the
 * documents it produces, and universe offers no way to edit them — that is the
 * whole point. An admin revising a shift does it in one place, and the change
 * arrives here on the next pull instead of being typed twice.
 *
 * Three things make this different from the readiness ingest in `ingest.ts`,
 * and each of them is a decision rather than an accident:
 *
 * - **It reconciles, it does not only upsert.** A tap that happened cannot
 *   un-happen, so `syncFingerReadings` may safely only ever add. A roster is a
 *   *plan*, and plans get cancelled: a day dropped upstream must be dropped
 *   here too, or a stale `D` leaves an operator in the morning's candidate
 *   pool, on the board, with a unit held open for someone who was taken off
 *   the schedule days ago. Deletion is bounded twice — to the pulled date
 *   range, and to documents this module owns.
 *
 * - **It looks forward.** `ingestDates` pulls today and yesterday because that
 *   is when readings arrive. What gets revised in a roster is next week, so
 *   the window runs a few days back and a month or more ahead.
 *
 * - **Department comes from our register, never from the response.** The two
 *   systems do not spell departments alike — "PIT SERVICE & DEVELOPMENT" here
 *   is "PIT SERVICE AND DEVELOPMENT" there — and our own record of who works
 *   where is the one allocation reads, so it is the only one that can be right.
 *   A NIK we do not hold is skipped and counted, never invented.
 */

import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { isRosterCode, type RosterCode } from "@universe/contracts";

import { db, schema } from "./db";
import { env } from "./env";
import { localDate } from "./scheduler";
import { normalizeNik } from "./sources/nik";
import { fetchRosterRows, type RosterFetcher } from "./sources/unggul";

export type RosterSyncResult = {
  /** Day cells the source returned. */
  fetched: number;
  /** Cells written or amended locally. */
  upserted: number;
  /** Of those, cells that did not exist here before. */
  inserted: number;
  /** Cells removed because the source no longer schedules them. */
  deleted: number;
  /** Cells for a NIK this system does not hold — counted, never guessed. */
  skippedUnknownNik: number;
  /**
   * Cells whose code is not in `ROSTER_CODES`, by code.
   *
   * Reported rather than dropped in silence. A wrong roster code produces no
   * error anywhere — its symptom is an operator who is simply never picked —
   * and September's pull carried six of them (`DS1`, `DS2`, `NS1`, `NS2`,
   * `KSG`, `0`), every one on an operator's row.
   */
  unknownCodes: Record<string, number>;
  /** Documents the mirror wrote to. */
  documents: number;
  /**
   * Months left to a manual upload, by `department|month`.
   *
   * See `takeOver`: a spreadsheet document is only stood down when the pull
   * covers its whole month.
   */
  deferred: string[];
};

/** Rows go in slices; a month for one department is ~30,000 cells. */
const CHUNK = 500;

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK)
    out.push(rows.slice(i, i + CHUNK));
  return out;
}

const monthOf = (date: string) => `${date.slice(0, 7)}-01`;

/**
 * The window the pull covers: a few days back, and out to the end of a month
 * some way ahead.
 *
 * The end is a month *end* rather than a rolling day count so that a document
 * is either wholly inside the window or wholly outside it. A window that
 * stopped mid-month would leave the mirror owning half a month and a
 * spreadsheet owning the other half, which is two rosters in force at once.
 */
export function rosterSyncRange(now = new Date()): {
  from: string;
  to: string;
} {
  const from = new Date(now.getTime() - env.ROSTER_SYNC_DAYS_BACK * 86_400_000);
  // Day 0 of the month after the last one wanted: the last day of that month.
  const end = new Date(
    now.getFullYear(),
    now.getMonth() + env.ROSTER_SYNC_MONTHS_AHEAD + 1,
    0
  );
  return { from: localDate(from), to: localDate(end) };
}

/**
 * Whether the pull covers a whole month, which is what licenses the mirror to
 * stand down a spreadsheet document for it.
 *
 * Without this rule the first run would archive an uploaded August, mirror the
 * two days of August inside the window, and leave twenty-nine days of roster
 * belonging to no active document — a month that vanishes from every screen
 * while every part of the system reports success.
 */
const covers = (month: string, from: string, to: string) => {
  const start = new Date(`${month}T00:00:00Z`);
  const last = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)
  );
  return from <= month && to >= last.toISOString().slice(0, 10);
};

/**
 * The mirror's document for one department-month, standing down a spreadsheet
 * one if it is in the way.
 *
 * Returns null when a manual document holds a month the pull does not wholly
 * cover — the caller reports it as deferred and leaves that month alone.
 */
async function documentFor(
  departmentId: string,
  month: string,
  from: string,
  to: string
): Promise<string | null> {
  const [existing] = await db
    .select({
      id: schema.rosterDocuments.id,
      source: schema.rosterDocuments.source,
    })
    .from(schema.rosterDocuments)
    .where(
      and(
        eq(schema.rosterDocuments.departmentId, departmentId),
        eq(schema.rosterDocuments.month, month),
        eq(schema.rosterDocuments.status, "aktif")
      )
    );

  if (existing?.source === "unggul") return existing.id;
  if (existing) {
    if (!covers(month, from, to)) return null;
    // Archived, never deleted: the spreadsheet document keeps every row it
    // held, and its detail screen keeps rendering (design D5).
    await db
      .update(schema.rosterDocuments)
      .set({ status: "arsip" })
      .where(eq(schema.rosterDocuments.id, existing.id));
  }

  const [created] = await db
    .insert(schema.rosterDocuments)
    .values({
      departmentId,
      month,
      // Not a file name, because there is no file. It reads as what it is on
      // the list screen, beside the spreadsheets that came before it.
      fileName: `unggul_att ${month.slice(0, 7)}`,
      uploadedBy: null,
      source: "unggul",
      status: "aktif",
    })
    .returning({ id: schema.rosterDocuments.id });
  if (!created) throw new Error(`roster document not created for ${month}`);
  return created.id;
}

export async function syncRoster(
  range?: { from: string; to: string },
  fetch: RosterFetcher = fetchRosterRows
): Promise<RosterSyncResult> {
  const { from, to } = range ?? rosterSyncRange();
  const rows = await fetch(from, to);

  const people = await db
    .select({
      id: schema.employees.id,
      nik: schema.employees.nik,
      departmentId: schema.employees.departmentId,
    })
    .from(schema.employees);
  const byNik = new Map(people.map((p) => [normalizeNik(p.nik), p]));

  const unknownCodes: Record<string, number> = {};
  let skippedUnknownNik = 0;

  /** department|month → the cells that belong in that document. */
  const wanted = new Map<
    string,
    Map<string, { employeeId: string; date: string; code: RosterCode }>
  >();

  for (const row of rows) {
    // Outside the asked-for range the mirror knows nothing, so it may neither
    // write nor reconcile — a source that widened the range on its own must
    // not widen the deletion with it.
    if (row.date < from || row.date > to) continue;
    const person = byNik.get(normalizeNik(row.nik));
    if (!person) {
      skippedUnknownNik += 1;
      continue;
    }
    if (!isRosterCode(row.code)) {
      unknownCodes[row.code] = (unknownCodes[row.code] ?? 0) + 1;
      continue;
    }
    const key = `${person.departmentId}|${monthOf(row.date)}`;
    const cells = wanted.get(key) ?? new Map();
    // Last cell wins, as everywhere else a source can repeat a key.
    cells.set(`${person.id} ${row.date}`, {
      employeeId: person.id,
      date: row.date,
      code: row.code,
    });
    wanted.set(key, cells);
  }

  let upserted = 0;
  let inserted = 0;
  let deleted = 0;
  let documents = 0;
  const deferred: string[] = [];

  for (const [key, cells] of wanted) {
    const [departmentId, month] = key.split("|") as [string, string];
    const documentId = await documentFor(departmentId, month, from, to);
    if (!documentId) {
      deferred.push(key);
      continue;
    }
    documents += 1;

    const values = [...cells.values()].map((cell) => ({ documentId, ...cell }));
    for (const slice of chunks(values)) {
      const back = await db
        .insert(schema.rosterDays)
        .values(slice)
        .onConflictDoUpdate({
          target: [
            schema.rosterDays.documentId,
            schema.rosterDays.employeeId,
            schema.rosterDays.date,
          ],
          set: { code: sql`excluded.code` },
        })
        .returning({ fresh: sql<boolean>`(xmax = 0)` });
      inserted += back.filter((r) => r.fresh).length;
    }
    upserted += values.length;

    /*
     * Reconciliation: what this document holds inside the window and the
     * source no longer schedules.
     *
     * Read-then-diff rather than a `not in (…)` of thirty thousand tuples,
     * which is the same answer through a statement Postgres has to plan.
     */
    const held = await db
      .select({
        id: schema.rosterDays.id,
        employeeId: schema.rosterDays.employeeId,
        date: schema.rosterDays.date,
      })
      .from(schema.rosterDays)
      .where(
        and(
          eq(schema.rosterDays.documentId, documentId),
          gte(schema.rosterDays.date, from),
          lte(schema.rosterDays.date, to)
        )
      );
    const stale = held
      .filter((r) => !cells.has(`${r.employeeId} ${r.date}`))
      .map((r) => r.id);
    for (const slice of chunks(stale)) {
      await db
        .delete(schema.rosterDays)
        .where(inArray(schema.rosterDays.id, slice));
      deleted += slice.length;
    }
  }

  return {
    fetched: rows.length,
    upserted,
    inserted,
    deleted,
    skippedUnknownNik,
    unknownCodes,
    documents,
    deferred,
  };
}

/** The scheduler's hook — one pass, logged, never throwing into the tick. */
export async function runRosterSync(): Promise<RosterSyncResult | null> {
  const { from, to } = rosterSyncRange();
  try {
    const result = await syncRoster({ from, to });
    const unknown = Object.entries(result.unknownCodes)
      .map(([code, n]) => `${code}×${n}`)
      .join(", ");
    console.log(
      `roster sync ${from}..${to}: ${result.upserted} cells across ` +
        `${result.documents} documents (${result.inserted} new, ` +
        `${result.deleted} withdrawn, ${result.skippedUnknownNik} unknown NIK)` +
        (unknown ? `; unknown codes: ${unknown}` : "") +
        (result.deferred.length
          ? `; deferred to upload: ${result.deferred.join(", ")}`
          : "")
    );
    return result;
  } catch (error) {
    console.error(`roster sync ${from}..${to} failed:`, error);
    return null;
  }
}
