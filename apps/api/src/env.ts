/**
 * Fail fast on boot rather than at the first request that needs a missing var.
 */
function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing required env var: ${name}`);
  return value;
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
   *  land in another project's data rather than failing. */
  DATABASE_URL: required("DATABASE_URL"),
  REDIS_URL: required("REDIS_URL"),

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
} as const;

export const isProd = env.NODE_ENV === "production";
