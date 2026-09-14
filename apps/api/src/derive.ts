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
 * Rebuild every reading for one date from every tap we hold, from either ear.
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
  const [pulled, heard] = await Promise.all([
    db
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
      ),
    db
      .select({
        nik: schema.deviceLiveEvents.nik,
        at: schema.deviceLiveEvents.at,
        ip: schema.deviceLiveEvents.ip,
      })
      .from(schema.deviceLiveEvents)
      .where(
        and(
          gte(schema.deviceLiveEvents.at, `${date} 00:00:00`),
          lt(schema.deviceLiveEvents.at, `${date} 24:00:00`)
        )
      ),
  ]);

  /*
   * Both readers, with the pull's answer winning where they overlap.
   *
   * Two of them hear every tap. The pull asks each machine every thirty
   * seconds and gets the direction the machine recorded; the live session
   * hears it in about a second but is told only who and when — the protocol
   * carries no direction at all. Until 2026-09-14 only the pull reached this
   * function, which meant a morning where the pull was down produced tickets,
   * a full live log, and a board that seated nobody.
   *
   * A live-only tap is taken as an arrival. It is a guess, and it is the safe
   * one: the session is only ever open inside a muster window, which is an
   * arrival window, and the noon split plus the roster is what decides which
   * shift the arrival belongs to. Where the guess is wrong — somebody tapping
   * out at ten to six while the pull is down — it is absorbed anyway, because
   * `reduceTaps` keeps the *earliest* tap in each column and his real arrival
   * that evening came first.
   *
   * Where the pull has the same tap, its direction is the one that counts:
   * something known beats something assumed.
   */
  const seen = new Set(pulled.map((t) => `${t.nik}|${t.at}|${t.ip}`));
  const taps: ReducibleTap[] = [
    ...pulled,
    ...heard
      .filter((t) => !seen.has(`${t.nik}|${t.at}|${t.ip}`))
      .map((t) => ({ ...t, direction: "in" as const })),
  ];
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
    /* When we last rebuilt this row, which is what the screens call "synced". */
    syncedAt: new Date(),
  }));

  /*
   * Written straight into `finger_readings` since the cutover (owner,
   * 2026-09-14): the table the board, the walls and the dashboard have always
   * read. Nothing downstream changed — that is why the shadow table this used
   * to fill carried the same shape, so the day Nakula was dropped became one
   * line here rather than a rewrite of every reader.
   */
  await db
    .insert(schema.fingerReadings)
    .values(rows)
    .onConflictDoUpdate({
      target: [schema.fingerReadings.nik, schema.fingerReadings.date],
      set: {
        firstInAt: sqlExcluded("first_in_at"),
        firstInIp: sqlExcluded("first_in_ip"),
        firstInPmAt: sqlExcluded("first_in_pm_at"),
        firstInPmIp: sqlExcluded("first_in_pm_ip"),
        firstOutAt: sqlExcluded("first_out_at"),
        firstOutIp: sqlExcluded("first_out_ip"),
        syncedAt: sqlExcluded("synced_at"),
      },
    });
  return rows.length;
}
