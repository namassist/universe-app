/**
 * Which phones receive a person's pushes, and for how long.
 *
 * A phone is registered under the session that registered it, as a hash:
 * the session id is a credential, and this table is read by more than the
 * auth code. Logging out takes it off, so a phone handed to the next shift's
 * operator does not keep buzzing with the last one's seat.
 */

import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { PushPlatform } from "@universe/contracts";

import { db, schema } from "../db";

/**
 * Phones one account may register. An operator has one, perhaps a spare;
 * past that it is junk tokens, each a wasted send on every notice
 * (security review, 2026-10-17). The oldest go first.
 */
const MAX_DEVICES_PER_USER = 5;

export const sessionHash = (sessionId: string) =>
  createHash("sha256").update(sessionId).digest("hex");

/** One row per token: the same phone signing in as somebody else moves. */
export async function registerDevice(input: {
  userId: string;
  sessionId: string;
  token: string;
  platform: PushPlatform;
}): Promise<void> {
  const row = {
    userId: input.userId,
    token: input.token,
    platform: input.platform,
    sessionHash: sessionHash(input.sessionId),
  };
  await db
    .insert(schema.pushDevices)
    .values(row)
    .onConflictDoUpdate({
      target: schema.pushDevices.token,
      set: {
        userId: row.userId,
        platform: row.platform,
        sessionHash: row.sessionHash,
        createdAt: new Date(),
      },
    });

  const surplus = (
    await db
      .select({ id: schema.pushDevices.id })
      .from(schema.pushDevices)
      .where(eq(schema.pushDevices.userId, input.userId))
      .orderBy(desc(schema.pushDevices.createdAt), desc(schema.pushDevices.id))
      .offset(MAX_DEVICES_PER_USER)
  ).map((r) => r.id);
  if (surplus.length)
    await db
      .delete(schema.pushDevices)
      .where(inArray(schema.pushDevices.id, surplus));
}

/** Only the caller's own: a token alone must not unregister somebody else. */
export async function unregisterDevice(
  userId: string,
  token: string
): Promise<void> {
  await db
    .delete(schema.pushDevices)
    .where(
      and(
        eq(schema.pushDevices.userId, userId),
        eq(schema.pushDevices.token, token)
      )
    );
}

export async function forgetSessionDevices(sessionId: string): Promise<void> {
  await db
    .delete(schema.pushDevices)
    .where(eq(schema.pushDevices.sessionHash, sessionHash(sessionId)));
}
