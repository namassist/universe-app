/**
 * Opaque, server-resolved sessions (design D1).
 *
 * Redis holds `session:<id>` and nothing about identity or permissions travels
 * in the identifier — which is what makes a revoked permission take effect on
 * the next request rather than at token expiry.
 *
 * The record carries `issuedAt` and `transport` beyond the subject reference.
 * Neither is identity, role, permission, or scope: `issuedAt` is what the
 * absolute expiry in D2 is measured from, and `transport` is what selects the
 * idle window. Everything a request needs to *authorize* still comes from the
 * caches in `principal.ts`, never from here.
 */

import type { SessionTransport } from "@universe/contracts";

import { env } from "../env";
import { redis } from "../redis";

export const SESSION_COOKIE = "universe_session";
export const DEVICE_COOKIE = "universe_device";

export type SessionRecord = {
  kind: "user" | "device";
  subjectId: string;
  /** Epoch seconds. The absolute expiry is measured from here, not the clock. */
  issuedAt: number;
  transport: SessionTransport;
};

const key = (id: string) => `session:${id}`;

/** Seconds of inactivity a session of this shape survives. */
function idleWindow(record: SessionRecord): number {
  if (record.kind === "device") return env.DEVICE_SESSION_SECONDS;
  return record.transport === "bearer"
    ? env.BEARER_IDLE_SECONDS
    : env.SESSION_IDLE_SECONDS;
}

/**
 * Epoch second past which the session dies regardless of activity, or null
 * when it has no absolute cap.
 *
 * Only web sessions carry one. A bearer client is off-shift by purpose, and a
 * device refreshes on heartbeat, so capping either would sign out the cases the
 * cap exists to protect against.
 */
function absoluteDeadline(record: SessionRecord): number | null {
  if (record.kind === "device") return null;
  if (record.transport === "bearer") return null;
  return record.issuedAt + env.SESSION_ABSOLUTE_SECONDS;
}

/** TTL to write now: the idle window, clipped so it never outlives the cap. */
function ttlFor(record: SessionRecord, now: number): number {
  const idle = idleWindow(record);
  const deadline = absoluteDeadline(record);
  if (deadline === null) return idle;
  return Math.min(idle, deadline - now);
}

export async function createSession(
  kind: "user" | "device",
  subjectId: string,
  transport: SessionTransport
): Promise<{ id: string; record: SessionRecord; maxAge: number }> {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const record: SessionRecord = { kind, subjectId, issuedAt: now, transport };
  const ttl = ttlFor(record, now);
  await redis.set(key(id), JSON.stringify(record), "EX", ttl);
  // The cookie outlives the idle window on purpose: expiry is Redis's call, not
  // the browser's, so a cookie that survives a lapsed session simply 401s.
  const maxAge = absoluteDeadline(record)
    ? env.SESSION_ABSOLUTE_SECONDS
    : idleWindow(record);
  return { id, record, maxAge };
}

/**
 * Resolve and slide in one step. Returns null — and drops the record — when the
 * session is unknown or has passed its absolute expiry.
 */
export async function resolveSession(
  id: string
): Promise<SessionRecord | null> {
  const raw = await redis.get(key(id));
  if (!raw) return null;

  let record: SessionRecord;
  try {
    record = JSON.parse(raw) as SessionRecord;
  } catch {
    await redis.del(key(id));
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const deadline = absoluteDeadline(record);
  if (deadline !== null && now >= deadline) {
    await redis.del(key(id));
    return null;
  }

  // Activity extends the session by a full idle window, up to but not beyond
  // its absolute expiry.
  await redis.expire(key(id), ttlFor(record, now));
  return record;
}

export async function deleteSession(id: string): Promise<void> {
  await redis.del(key(id));
}

/** Cookie attributes shared by the user and device cookies. */
export function cookieAttributes(maxAge: number) {
  return {
    httpOnly: true,
    // Same-origin deployment: Lax suffices and survives plain HTTP. A split
    // deployment changes this pair and nothing else.
    sameSite: "lax" as const,
    path: "/",
    secure: env.COOKIE_SECURE,
    maxAge,
  };
}
