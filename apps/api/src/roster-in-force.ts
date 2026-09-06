/**
 * The roster rows that are actually in force.
 *
 * `roster_days` belongs to a document, and a month can hold several: a
 * re-upload archives its predecessor rather than deleting it, and the roster
 * mirror stands a spreadsheet document down the same way when it takes a month
 * over. Both keep every row they held, which is the point — an archived
 * document's grid still renders (design D5).
 *
 * So a query that joins `roster_days` on a date and nothing else reads *every*
 * version of that day at once. On 2026-09-06, with September mirrored from
 * unggul_att and the uploaded September archived beneath it, today's roster
 * came back as 1,966 rows for 990 people: every attendance denominator doubled,
 * every operator entered the candidate pool twice, and the dashboard rendered
 * each person's attention row twice under one React key.
 *
 * The rule was already written in `readiness-display` and `ingest-sync`, as an
 * inner join to the document with `status = 'aktif'`. It was missing from five
 * other readers — which is what a rule kept in copies eventually does. This is
 * that rule with one home.
 *
 * An `exists` rather than a join on purpose: it drops into an existing `where`
 * without touching the shape of the query around it, so adding it cannot change
 * what a select returns beyond removing the duplicates it exists to remove.
 */

import { sql } from "drizzle-orm";

import { schema } from "./db";

/** The day's document is the one in force for its department and month. */
export const rosterDayInForce = sql`exists (
  select 1
  from ${schema.rosterDocuments}
  where ${schema.rosterDocuments.id} = ${schema.rosterDays.documentId}
    and ${schema.rosterDocuments.status} = 'aktif'
)`;
