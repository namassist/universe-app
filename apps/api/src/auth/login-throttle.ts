/**
 * How many guesses the person login allows, now that it can be reached from
 * the internet (`docs/prd.md`, _Network: reaching the API from a phone_).
 *
 * Two budgets, both spent **before** the password is checked, the way the
 * Operations Center's is (`ops/session.ts`): counting after the verify let a
 * parallel burst all read "0 failures" and all be verified.
 *
 * - **Per address**, everywhere. One machine trying many accounts.
 * - **Per account**, from outside the site only. Many addresses trying one
 *   account, which a per-address budget alone never catches. Attempts from
 *   site neither spend it nor are refused by it: a stranger on the internet
 *   can exhaust an operator's outside budget, but cannot lock that operator
 *   out at the muster.
 *
 * A successful login clears the account's budget and gives the address back
 * the one attempt it just spent, so only failures accumulate there: many
 * people behind one public address (a carrier's CGNAT, an office) logging in
 * correctly never run it out (code review, 2026-10-17). It does not clear the
 * address's earlier failures, or a guesser who also holds one real account
 * would log into it every ninth try and never run out. Neither budget says
 * whether an account exists: an identifier nobody holds is counted the same
 * as one somebody does.
 */

import { createHash } from "node:crypto";

import { redis } from "../redis";

/** Failures a budget allows inside one window before it refuses. */
export const LOGIN_MAX_FAILURES = 10;
/** The window the attempts are counted in, and how long a refusal lasts. */
export const LOGIN_LOCKOUT_SECONDS = 15 * 60;

/**
 * Every key under one prefix, and a test run's under its own, so a suite
 * never locks a developer out of their own login and can clear what it left.
 */
export function throttleKey(suffix: string): string {
  const prefix =
    process.env.NODE_ENV === "test" ? "auth-test-throttle" : "auth-throttle";
  return `${prefix}:${suffix}`;
}

/** Hashed, so a Redis dump does not list who was being guessed at. */
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 32);

/** As login matches it, so `NIK` and ` nik ` are one budget, not two. */
const accountKey = (identifier: string) =>
  throttleKey(`account:${digest(identifier.trim().toLowerCase())}`);
const addressKey = (ip: string | null) =>
  throttleKey(`address:${ip ? digest(ip) : "unknown"}`);

/**
 * Count one attempt and give its window an expiry, atomically: INCR and
 * EXPIRE as two calls could leave a counter with no TTL if the process died
 * between them, locking that budget for good. Returns the count and the
 * seconds the window has left.
 */
const RESERVE = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return { n, redis.call('TTL', KEYS[1]) }
`;

async function reserve(key: string): Promise<{ n: number; ttl: number }> {
  const [n, ttl] = (await redis.eval(
    RESERVE,
    1,
    key,
    String(LOGIN_LOCKOUT_SECONDS)
  )) as [number, number];
  return { n: Number(n), ttl: Number(ttl) };
}

export type LoginAttempt =
  { kind: "ok" } | { kind: "locked"; retryAfter: number };

export async function reserveLoginAttempt(
  identifier: string,
  ip: string | null,
  onSite: boolean
): Promise<LoginAttempt> {
  const spent = [await reserve(addressKey(ip))];
  if (!onSite) spent.push(await reserve(accountKey(identifier)));

  const over = spent.filter((budget) => budget.n > LOGIN_MAX_FAILURES);
  if (over.length === 0) return { kind: "ok" };
  return {
    kind: "locked",
    retryAfter: Math.max(1, ...over.map((budget) => budget.ttl)),
  };
}

/** Never below zero, and never creates a key the window has already let go. */
const REFUND = `
if redis.call('GET', KEYS[1]) and tonumber(redis.call('GET', KEYS[1])) > 0 then
  redis.call('DECR', KEYS[1])
end
`;

export async function settleLoginSuccess(
  identifier: string,
  ip: string | null
): Promise<void> {
  await redis.del(accountKey(identifier));
  await redis.eval(REFUND, 1, addressKey(ip));
}
