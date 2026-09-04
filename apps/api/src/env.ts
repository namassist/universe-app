/**
 * Fail fast on boot rather than at the first request that needs a missing var.
 */
function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * The test run's own store, when there is one.
 *
 * `bun test` sets `NODE_ENV=test`, and `.env` has carried `TEST_DATABASE_URL`
 * and `TEST_REDIS_URL` all along — but nothing read them, so every suite ran
 * against the **dev** database and left its fixtures there. Twenty units named
 * `ZZ…` were sitting in the owner's Fleet Setting on 2026-09-04, from runs that
 * failed part-way and could not clean up after themselves.
 *
 * Falls through to the ordinary var when the test one is absent, so a machine
 * that has not set one keeps working exactly as before.
 */
function store(name: string): string {
  const test = process.env.NODE_ENV === "test" && process.env[`TEST_${name}`];
  return test || required(name);
}

function number(name: string, fallback: string): number {
  const raw = required(name, fallback);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`Env var ${name} must be a positive number, got "${raw}"`);
  return value;
}

function boolean(name: string, fallback: string): boolean {
  const raw = required(name, fallback).toLowerCase();
  if (raw !== "true" && raw !== "false")
    throw new Error(`Env var ${name} must be "true" or "false", got "${raw}"`);
  return raw === "true";
}

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

export const env = {
  NODE_ENV: required("NODE_ENV", "development"),
  PORT: Number(required("PORT", "3001")),
  /** Comma-separated. Mobile clients send no Origin, so they bypass CORS entirely. */
  CORS_ORIGINS: required("CORS_ORIGINS", "http://localhost:3000").split(","),

  /** No fallback on purpose — a default here would silently point at the wrong
   *  database. Postgres and Redis are shared dev containers, so a typo would
   *  land in another project's data rather than failing.
   *
   *  Under `bun test` these resolve to `TEST_DATABASE_URL` / `TEST_REDIS_URL`
   *  when set; see `store`. */
  DATABASE_URL: store("DATABASE_URL"),
  REDIS_URL: store("REDIS_URL"),

  /** Bootstrap superadmin. Read by the seed only; losing it locks everyone out,
   *  so the seed is idempotent and re-runnable. */
  SUPERADMIN_IDENTIFIER: required("SUPERADMIN_IDENTIFIER", "superadmin"),
  SUPERADMIN_PASSWORD: required("SUPERADMIN_PASSWORD"),

  /** Handed to imported and reset accounts. Never a literal in the repo, and
   *  refused as a *new* password so the forced change cannot be satisfied by
   *  retyping it. */
  DEFAULT_USER_PASSWORD: required("DEFAULT_USER_PASSWORD"),
  /** Configuration rather than a constant so it can be raised without a deploy. */
  PASSWORD_MIN_LENGTH: number("PASSWORD_MIN_LENGTH", "8"),

  /** D2 lifetimes, in seconds. */
  SESSION_IDLE_SECONDS: number("SESSION_IDLE_SECONDS", String(4 * HOUR)),
  /** One shift. A session begun at the start of a shift does not outlive it. */
  SESSION_ABSOLUTE_SECONDS: number(
    "SESSION_ABSOLUTE_SECONDS",
    String(12 * HOUR)
  ),
  /** Bearer clients are off-shift by purpose, so they get idle expiry only. */
  BEARER_IDLE_SECONDS: number("BEARER_IDLE_SECONDS", String(30 * DAY)),
  /** Refreshed on every heartbeat, so a live TV never reaches it. */
  DEVICE_SESSION_SECONDS: number("DEVICE_SESSION_SECONDS", String(365 * DAY)),

  /** Its own flag, deliberately not derived from NODE_ENV: a deployment may
   *  serve plain HTTP, and a browser silently discards a Secure cookie over
   *  HTTP — tying this to the environment would break login in exactly the
   *  setup that needs it most. */
  COOKIE_SECURE: boolean("COOKIE_SECURE", "false"),

  /** Where uploaded sound files are written (design D7).
   *
   *  Explicit configuration for the same reason COOKIE_SECURE is: what the
   *  right directory is depends on how the API is deployed, not on whether it
   *  thinks it is in production. A container needs a mounted volume, a bare
   *  host wants a path under the service account's data directory, and a
   *  developer wants something inside the repo — deriving one of those from
   *  NODE_ENV would silently pick wrong in the other two, and the symptom is
   *  uploaded sounds vanishing on the next redeploy rather than an error. */
  SOUND_DIR: required("SOUND_DIR", "./storage/sounds"),

  /** Where uploaded employee photos are written (design D8).
   *
   *  Explicit for the same reason SOUND_DIR is, and with a sharper consequence:
   *  a photo that vanishes on redeploy leaves its `photo_file_name` behind in
   *  the database, so the record claims a picture that is no longer there. On
   *  an ephemeral container this must point at a mounted volume. /health
   *  reports the directory writable, which catches an unmounted volume at
   *  startup — but writable is not persistent, and no probe can tell the two
   *  apart. */
  PHOTO_DIR: required("PHOTO_DIR", "./storage/photos"),

  /** The two external readiness sources (read-only, snapshot on ingest).
   *
   *  Required with no fallback for the same reason DATABASE_URL is: a default
   *  would silently point at the wrong database, and here "wrong" means
   *  another site's attendance machines. Connections are lazy — the API boots
   *  and serves without reach; only an ingest run needs the network. */
  FTW_SOURCE_URL: required("FTW_SOURCE_URL"),
  ATTENDANCE_SOURCE_URL: required("ATTENDANCE_SOURCE_URL"),

  /** savera hosts several companies in one database; this site is one of
   *  them. Ingesting the others would snapshot people who can never hold a
   *  unit here. */
  FTW_SOURCE_COMPANY_ID: number("FTW_SOURCE_COMPANY_ID", "2"),

  /** How long an ingest stage keeps re-pulling after it fires (design: the
   *  window is retry and late-arrival tolerance in one — every pass is an
   *  idempotent upsert). Bounded so everything is settled before the bus. */
  INGEST_WINDOW_MINUTES: number("INGEST_WINDOW_MINUTES", "5"),

  /* ---- fingerprint machine probing ---- */

  /** How often every active machine is probed. The monitoring TV is a
   *  continuous reading, not a deadline, so this is an interval rather than a
   *  timeline stage.
   *
   *  A full sweep of ~58 machines takes about 3.5 s, so a 30 s cycle leaves
   *  the prober idle roughly nine tenths of the time — the interval is chosen
   *  for how fast an outage should surface, not for cost. */
  PROBE_INTERVAL_SECONDS: number("PROBE_INTERVAL_SECONDS", "30"),

  /** How long one TCP connect may take before it counts as a miss.
   *
   *  Measured on site: the slowest machines answer in ~1.2 s when asked alone,
   *  so this is generous on purpose — a timeout that merely *usually* clears
   *  manufactures offline machines that are not offline. */
  PROBE_TIMEOUT_MS: number("PROBE_TIMEOUT_MS", "5000"),

  /** How many machines are probed at once.
   *
   *  Not all of them: firing 58 simultaneous connects was measured to push the
   *  slower machines past a 3 s timeout and report them offline while `nc`
   *  reached them fine. Batching keeps each probe honest, and a full cycle
   *  still finishes far inside its interval. */
  PROBE_CONCURRENCY: number("PROBE_CONCURRENCY", "10"),

  /** Consecutive misses before a machine is called offline. Site links drop
   *  the occasional packet; one miss must not flash red on a wall-mounted
   *  TV, and two still surfaces a real outage inside a couple of minutes. */
  PROBE_MISSES_BEFORE_OFFLINE: number("PROBE_MISSES_BEFORE_OFFLINE", "2"),

  /** Where a roster upload waits between its preview and its commit (D8).
   *
   *  Explicit like the two above, and the least precious of the three: nothing
   *  in the database points here, and every file under it is a copy of one the
   *  operator still has. A roster month is 62,000 cells, far too many to return
   *  in one preview response, so the pages after the first re-read the file —
   *  and a file that expired or was never persisted degrades the preview to
   *  "upload it again", never to a wrong answer, because the commit re-parses
   *  what the client sends rather than trusting anything stored here. */
  IMPORT_DIR: required("IMPORT_DIR", "./storage/imports"),
} as const;

export const isProd = env.NODE_ENV === "production";
