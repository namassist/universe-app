/**
 * The readiness sync engine: external source → local snapshot, idempotently.
 *
 * Called from two places with one contract: the `ftw-ingest` /
 * `finger-ingest` timeline hooks run `runIngestWindow` (fire once, then
 * re-pull each minute until the window closes), and the manual sync routes
 * run a single pass. Every pass upserts on `(nik, date)`, so a re-pull
 * amends the snapshot and never duplicates it — which is what makes the
 * window double as retry and late-arrival tolerance.
 *
 * The window pulls **today and yesterday**: an operator uploading FTW at
 * 23:48 for the morning shift lands under yesterday's `send_date`, and a
 * night worker's `first_out` amends yesterday's row.
 */

import { sql } from "drizzle-orm";

import { db, schema } from "./db";
import { env } from "./env";
import { localDate } from "./scheduler";
import { normalizeNik } from "./sources/nik";
import { fetchFtwRows, type FtwFetcher } from "./sources/savera";
import { fetchFingerRows, type FingerFetcher } from "./sources/nakula";

export type SyncResult = {
  /** Rows the source returned. */
  fetched: number;
  /** Rows written or amended locally. */
  upserted: number;
  /**
   * Of those, rows that did not exist here before.
   *
   * The number a person pressing Sync actually wants. Every pass upserts the
   * whole window — ~1,100 rows twice a day — so `upserted` is near-constant
   * and a sync that found thirty late uploads looks exactly like one that
   * found nothing. Postgres reports it for free: on a row this statement
   * inserted, `xmax` is 0.
   */
  inserted: number;
  /** Rows refused for want of a usable NIK — counted, never silent. */
  skipped: number;
};

/** Upserts go in slices: a morning is ~1,100 rows, well past one statement's
 *  comfortable parameter count. */
const CHUNK = 200;

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK)
    out.push(rows.slice(i, i + CHUNK));
  return out;
}

/**
 * One row per (nik, date), last in wins.
 *
 * Two raw NIKs can normalize to the same key ("050123" and "50123" are the
 * same person through two source formattings), and ON CONFLICT refuses to
 * touch a row twice in one statement — without this, one duplicated person
 * would kill an entire pass.
 */
function dedupeByNikDate<T extends { nik: string; date: string }>(
  rows: T[]
): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) byKey.set(`${row.nik}\u0000${row.date}`, row);
  return [...byKey.values()];
}

export async function syncFtwReadings(
  dates: string[],
  fetch: FtwFetcher = fetchFtwRows
): Promise<SyncResult> {
  const rows = await fetch(dates);
  const usable = rows.flatMap((row) => {
    const nik = normalizeNik(row.nik);
    if (!nik) return [];
    return [
      {
        nik,
        date: row.date,
        name: row.name ?? "",
        company: row.company,
        department: row.department,
        position: row.position,
        mess: row.mess,
        shift: row.shift,
        sleepMinutes: row.sleep_minutes ?? 0,
        sleepCategory: row.sleep_category,
        ftwDecision: row.ftw_decision,
        sentAt: row.sent_at,
      },
    ];
  });
  const deduped = dedupeByNikDate(usable);

  let inserted = 0;
  for (const slice of chunks(deduped)) {
    const back = await db
      .insert(schema.ftwReadings)
      .values(slice)
      .onConflictDoUpdate({
        target: [schema.ftwReadings.nik, schema.ftwReadings.date],
        set: {
          name: sql`excluded.name`,
          company: sql`excluded.company`,
          department: sql`excluded.department`,
          position: sql`excluded.position`,
          mess: sql`excluded.mess`,
          shift: sql`excluded.shift`,
          sleepMinutes: sql`excluded.sleep_minutes`,
          sleepCategory: sql`excluded.sleep_category`,
          ftwDecision: sql`excluded.ftw_decision`,
          sentAt: sql`excluded.sent_at`,
          syncedAt: sql`now()`,
        },
      })
      .returning({ fresh: sql<boolean>`(xmax = 0)` });
    inserted += back.filter((r) => r.fresh).length;
  }

  return {
    fetched: rows.length,
    upserted: deduped.length,
    inserted,
    skipped: rows.length - deduped.length,
  };
}

export async function syncFingerReadings(
  dates: string[],
  fetch: FingerFetcher = fetchFingerRows
): Promise<SyncResult> {
  const rows = await fetch(dates);
  const usable = rows.flatMap((row) => {
    const nik = normalizeNik(row.nik);
    if (!nik) return [];
    return [
      {
        nik,
        date: row.date,
        firstInAt: row.first_in_at,
        firstInIp: row.first_in_ip,
        firstInPmAt: row.first_in_pm_at,
        firstInPmIp: row.first_in_pm_ip,
        firstOutAt: row.first_out_at,
        firstOutIp: row.first_out_ip,
      },
    ];
  });
  const deduped = dedupeByNikDate(usable);

  let inserted = 0;
  for (const slice of chunks(deduped)) {
    const back = await db
      .insert(schema.fingerReadings)
      .values(slice)
      .onConflictDoUpdate({
        target: [schema.fingerReadings.nik, schema.fingerReadings.date],
        set: {
          firstInAt: sql`excluded.first_in_at`,
          firstInIp: sql`excluded.first_in_ip`,
          firstInPmAt: sql`excluded.first_in_pm_at`,
          firstInPmIp: sql`excluded.first_in_pm_ip`,
          firstOutAt: sql`excluded.first_out_at`,
          firstOutIp: sql`excluded.first_out_ip`,
          syncedAt: sql`now()`,
        },
      })
      .returning({ fresh: sql<boolean>`(xmax = 0)` });
    inserted += back.filter((r) => r.fresh).length;
  }

  return {
    fetched: rows.length,
    upserted: deduped.length,
    inserted,
    skipped: rows.length - deduped.length,
  };
}

/* --------------------------------------------------------------- the window */

export type IngestKind = "ftw" | "finger";

export type WindowResult = {
  passes: number;
  failures: number;
  last: SyncResult | null;
};

type WindowOptions = {
  dates?: string[];
  /**
   * When this window stops — the deadline its readings are judged against,
   * read off the timeline by the caller. Takes precedence over `windowMs`.
   */
  endsAt?: Date;
  /** The fallback span, for a caller whose deadline the timeline cannot name. */
  windowMs?: number;
  passDelayMs?: number;
  ftwFetch?: FtwFetcher;
  fingerFetch?: FingerFetcher;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long since `at`, for the log line. */
const took = (at: number) => `${((Date.now() - at) / 1000).toFixed(1)}s`;

/** Today and yesterday, site-local — the pull window every ingest uses. */
export function ingestDates(now = new Date()): string[] {
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return [localDate(now), localDate(yesterday)];
}

/**
 * Fire-once-then-re-pull: one pass immediately, another after each delay,
 * until the window closes. A pass that throws is counted and logged — the
 * next pass is the retry, and the manual sync route is the recovery for a
 * window that failed outright.
 *
 * The close is a *moment*, not a span: `endsAt` when the caller could name the
 * deadline, `windowMs` from now when it could not. One pass always runs before
 * the clock is consulted at all, so a stage firing after its own deadline
 * still pulls rather than concluding there is no time left — the whole shift's
 * readings are not worth losing to a minute of rounding.
 */
export async function runIngestWindow(
  kind: IngestKind,
  options: WindowOptions = {}
): Promise<WindowResult> {
  const windowMs = options.windowMs ?? env.INGEST_WINDOW_MINUTES * 60_000;
  const passDelayMs = options.passDelayMs ?? 60_000;
  const dates = options.dates ?? ingestDates();
  const startedAt = Date.now();
  const closesAt = options.endsAt?.getTime() ?? startedAt + windowMs;

  let passes = 0;
  let failures = 0;
  let last: SyncResult | null = null;

  for (;;) {
    passes += 1;
    /* How long the source took, on the line it already prints. Whether a
       cadence is affordable is a question about *their* system, and this is
       the only place that can answer it — subtracting log timestamps works
       but silently folds in the sleep between passes. */
    const at = Date.now();
    try {
      last =
        kind === "ftw"
          ? await syncFtwReadings(dates, options.ftwFetch)
          : await syncFingerReadings(dates, options.fingerFetch);
      console.log(
        `[ingest] ${kind} pass ${passes}: ` +
          `${last.upserted} upserted, ${last.skipped} skipped ` +
          `(of ${last.fetched} fetched for ${dates.join(", ")}) ` +
          `— ${took(at)}`
      );
    } catch (error) {
      failures += 1;
      console.error(
        `[ingest] ${kind} pass ${passes} failed after ${took(at)}`,
        error
      );
    }

    if (Date.now() + passDelayMs > closesAt) break;
    await sleep(passDelayMs);
  }

  return { passes, failures, last };
}
