/**
 * The Operations Center's own sessions: a shared password, not an account.
 *
 * Deliberately apart from `auth/session.ts`. Those sessions carry a subject
 * that roles, menus and scopes are resolved from; this one carries nothing
 * but "the password was known", so it must never be mistaken for one of them.
 * Its own Redis prefix and its own cookie are what keep that true — an ops id
 * presented as a user session finds no `session:` record, and the other way
 * round finds no `ops-session:` one.
 *
 * Guessing is bounded per client address: five wrong passwords lock that
 * address out for fifteen minutes, and the lock is checked **before** the
 * password, so a locked-out guesser learns nothing even by trying the right
 * one.
 */

import { createHash } from "node:crypto";

import { env, opsPasswordHash } from "../env";
import { redis } from "../redis";
import { opsKey } from "./keys";

export const OPS_COOKIE = "universe_ops";

/** Wrong passwords an address may try before it is locked out. */
export const OPS_MAX_FAILURES = 5;
/** How long a lockout lasts, and the window the failures are counted in. */
export const OPS_LOCKOUT_SECONDS = 15 * 60;

const sessionKey = (id: string) => opsKey(`session:${id}`);
const failureKey = (ip: string | null) =>
  opsKey(`login-failures:${ip ?? "unknown"}`);

/**
 * Count an attempt and give the window its expiry in one atomic step.
 *
 * Reserved **before** the password is checked (security review, 2026-10-02):
 * reading the count, verifying, then incrementing let a burst of parallel
 * requests all read "0 failures" and all be verified — the cap became however
 * many fit in one argon2 run. And INCR and EXPIRE as two calls could leave a
 * counter with no TTL if the process died between them, locking an address
 * out for good.
 */
const RESERVE = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n
`;

/**
 * At most this many argon2 verifications at once. Each one takes ~64 MB and
 * tens of milliseconds by design; a burst against the login must queue rather
 * than take the API's memory with it.
 */
const MAX_CONCURRENT_VERIFIES = 4;
let verifying = 0;
const waiting: (() => void)[] = [];

async function verifyBounded(password: string, hash: string): Promise<boolean> {
  if (verifying >= MAX_CONCURRENT_VERIFIES)
    await new Promise<void>((resolve) => waiting.push(resolve));
  verifying++;
  try {
    return await Bun.password.verify(password, hash);
  } finally {
    verifying--;
    waiting.shift()?.();
  }
}

/**
 * Which password a session was opened with: a short digest of the hash in
 * force. A session is only valid while the hash still matches, so rotating
 * `OPS_PASSWORD_HASH` ends every session opened with the old password at
 * once (security review, 2026-10-02) instead of up to twelve hours later.
 */
const fingerprint = (hash: string) =>
  createHash("sha256").update(hash).digest("hex").slice(0, 16);

export type OpsLogin =
  | { kind: "disabled" }
  | { kind: "locked" }
  | { kind: "wrong" }
  | { kind: "ok"; id: string; maxAge: number };

export function opsEnabled(): boolean {
  return opsPasswordHash() !== null;
}

export async function opsLogin(
  password: string,
  ip: string | null
): Promise<OpsLogin> {
  const hash = opsPasswordHash();
  if (!hash) return { kind: "disabled" };

  const attempt = Number(
    await redis.eval(RESERVE, 1, failureKey(ip), String(OPS_LOCKOUT_SECONDS))
  );
  if (attempt > OPS_MAX_FAILURES) {
    console.warn(
      `[ops] login refused — ${ip ?? "unknown address"} is locked out`
    );
    return { kind: "locked" };
  }

  let valid = false;
  try {
    valid = await verifyBounded(password, hash);
  } catch {
    // A malformed hash in the environment is a configuration error, not a
    // reason to open the page. Logged without the value.
    console.error("[ops] OPS_PASSWORD_HASH is not a valid password hash");
  }

  if (!valid) {
    // Already counted by the reservation above.
    console.warn(`[ops] wrong password from ${ip ?? "unknown address"}`);
    return { kind: "wrong" };
  }

  await redis.del(failureKey(ip));
  const id = crypto.randomUUID();
  await redis.set(
    sessionKey(id),
    fingerprint(hash),
    "EX",
    env.OPS_SESSION_SECONDS
  );
  console.info(`[ops] session opened from ${ip ?? "unknown address"}`);
  return { kind: "ok", id, maxAge: env.OPS_SESSION_SECONDS };
}

/** True when the id names a live ops session. Never slides: one shift, then gone. */
export async function opsSessionValid(
  id: string | undefined
): Promise<boolean> {
  const hash = opsPasswordHash();
  if (!id || !hash) return false;
  return (await redis.get(sessionKey(id))) === fingerprint(hash);
}

export async function opsLogout(id: string | undefined): Promise<void> {
  if (id) await redis.del(sessionKey(id));
}

export function opsCookieAttributes(maxAge: number) {
  return {
    httpOnly: true,
    // Strict, unlike the user cookie: nothing ever links into this page from
    // another site, so there is no navigation for Lax to keep working.
    sameSite: "strict" as const,
    path: "/",
    secure: env.COOKIE_SECURE,
    maxAge,
  };
}
