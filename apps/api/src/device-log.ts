/**
 * Writing down what we asked a machine, and forgetting it after three days.
 *
 * Called by `sources/fingerprint.ts` on every request, success or failure, so
 * that the record cannot disagree with what actually happened. The client has
 * no path that reaches a machine without coming through here.
 *
 * **Never throws.** Its caller is collecting attendance during a muster, and
 * failing to *write down* that work must not be able to stop it. A record that
 * cannot be written is logged and dropped — the same position the application
 * was in before this table existed.
 */

import { lt, sql } from "drizzle-orm";

import { db, schema } from "./db";

/**
 * How long the record is worth keeping.
 *
 * Three days (owner) — the same window as the raw taps, and long enough to
 * answer an incident somebody noticed the same morning. Export is how anything
 * survives longer; the alternative is a table that grows for years to answer a
 * question nobody asked.
 */
const KEEP_DAYS = 3;

export async function recordDeviceRequest(input: {
  ip: string;
  command: string;
  ok: boolean;
  note?: string;
}): Promise<void> {
  try {
    await db.insert(schema.deviceRequests).values({
      ip: input.ip,
      command: input.command,
      ok: input.ok,
      note: input.note ?? null,
    });
    /* Swept here rather than on a schedule of its own: a sweep is one indexed
       delete and the writes are already rare outside the muster window, so a
       stage existing only to run it would be more machinery than the problem.
       The same bargain `notify.ts` strikes. */
    await db
      .delete(schema.deviceRequests)
      .where(
        lt(
          schema.deviceRequests.at,
          sql`now() - ${`${KEEP_DAYS} days`}::interval`
        )
      );
  } catch (error) {
    console.error(
      `[device-log] tidak bisa mencatat ${input.command} ke ${input.ip}`,
      error
    );
  }
}
