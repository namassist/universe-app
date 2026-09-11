/**
 * Working out a day's reading from the taps that day produced.
 *
 * The rule is not new. `finger_readings` has carried first-IN-before-noon,
 * first-IN-after-noon and first-OUT since the ingest was written, and
 * `shiftIn` is what resolves which of the two IN columns a given shift means.
 * What is new is *where* the rule lives: on taps we hold, rather than inside a
 * source adapter that reduced Nakula's rows before storing them.
 *
 * That move is the whole point of keeping the taps. The reduction stops being
 * a decision made once, on the way in, and unrecoverable afterwards — it
 * becomes something that can be run again when the rule is refined, or found
 * wrong, without asking anybody else's database for the morning back.
 *
 * **Written to `derived_readings`, not to `finger_readings`.** Both sources are
 * running; the board still reads what Nakula gives it, and will until a week of
 * the two side by side has said whether they agree.
 */

import { and, gte, lt, sql } from "drizzle-orm";

import { db, schema } from "./db";

/** One tap, as much of it as the reduction needs. */
export type ReducibleTap = {
  nik: string;
  /** Local `"YYYY-MM-DD HH:MM:SS"`, as the machine wrote it. */
  at: string;
  direction: "in" | "out";
  ip: string;
};

export type Reading = {
  firstInAt: string | null;
  firstInIp: string | null;
  firstInPmAt: string | null;
  firstInPmIp: string | null;
  firstOutAt: string | null;
  firstOutIp: string | null;
};

const EMPTY: Reading = {
  firstInAt: null,
  firstInIp: null,
  firstInPmAt: null,
  firstInPmIp: null,
  firstOutAt: null,
  firstOutIp: null,
};

/** `excluded.<column>` — the row the upsert was about to write. */
const sqlExcluded = (column: string) => sql.raw(`excluded.${column}`);

/** The clock half of `"YYYY-MM-DD HH:MM:SS"`. Text compares correctly. */
const clockOf = (at: string) => at.slice(11, 19);

/**
 * One person's taps for one day, reduced.
 *
 * Pure, and deliberately ignorant of the roster: it reports both IN columns
 * and lets `shiftIn` decide which one a shift means. A night operator who
 * forgets to switch the machine to OUT before going home at six leaves a
 * morning IN on the next calendar day, and this function reports it as exactly
 * that — a morning IN. Hiding it here would be guessing; the noon split plus
 * the roster is what stops it being read as a night arrival.
 *
 * Noon belongs to the afternoon, matching `shiftIn`'s own boundary.
 */
export function reduceTaps(taps: ReducibleTap[]): Reading {
  const reading: Reading = { ...EMPTY };
  /* Earliest wins in each column, so the order taps arrive in cannot matter —
     a replayed pull and a fresh one must reduce alike. */
  for (const tap of [...taps].sort((a, b) => a.at.localeCompare(b.at))) {
    if (tap.direction === "out") {
      if (!reading.firstOutAt) {
        reading.firstOutAt = tap.at;
        reading.firstOutIp = tap.ip;
      }
      continue;
    }
    const afternoon = clockOf(tap.at) >= "12:00:00";
    if (afternoon && !reading.firstInPmAt) {
      reading.firstInPmAt = tap.at;
      reading.firstInPmIp = tap.ip;
    } else if (!afternoon && !reading.firstInAt) {
      reading.firstInAt = tap.at;
      reading.firstInIp = tap.ip;
    }
  }
  return reading;
}

/**
 * Rebuild every reading for one date from the taps we hold.
 *
 * Rebuild, not amend: the taps are the truth and the rows are a view of them,
 * so a row is replaced rather than merged into. That is what makes re-running
 * safe after a late pull, after a manual sync, or after the rule changes.
 *
 * A person whose taps have all aged out of the three-day window keeps whatever
 * row they had — the reading is not being asserted as absent, we simply no
 * longer hold the taps to say. Removing it would turn "we stopped looking"
 * into "they never tapped".
 */
export async function deriveDate(date: string): Promise<number> {
  const taps = await db
    .select({
      nik: schema.deviceTaps.nik,
      at: schema.deviceTaps.at,
      direction: schema.deviceTaps.direction,
      ip: schema.deviceTaps.ip,
    })
    .from(schema.deviceTaps)
    .where(
      and(
        gte(schema.deviceTaps.at, `${date} 00:00:00`),
        lt(schema.deviceTaps.at, `${date} 24:00:00`)
      )
    );
  if (!taps.length) return 0;

  const byNik = new Map<string, ReducibleTap[]>();
  for (const tap of taps) {
    const list = byNik.get(tap.nik) ?? [];
    list.push(tap);
    byNik.set(tap.nik, list);
  }

  const rows = [...byNik.entries()].map(([nik, list]) => ({
    nik,
    date,
    ...reduceTaps(list),
    derivedAt: new Date(),
  }));

  await db
    .insert(schema.derivedReadings)
    .values(rows)
    .onConflictDoUpdate({
      target: [schema.derivedReadings.nik, schema.derivedReadings.date],
      set: {
        firstInAt: sqlExcluded("first_in_at"),
        firstInIp: sqlExcluded("first_in_ip"),
        firstInPmAt: sqlExcluded("first_in_pm_at"),
        firstInPmIp: sqlExcluded("first_in_pm_ip"),
        firstOutAt: sqlExcluded("first_out_at"),
        firstOutIp: sqlExcluded("first_out_ip"),
        derivedAt: sqlExcluded("derived_at"),
      },
    });
  return rows.length;
}
