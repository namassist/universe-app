/**
 * Writing a notification, and forgetting old ones.
 *
 * One function rather than an insert at each call site, because two rules have
 * to hold everywhere and neither is visible at the point of writing: a
 * notification carries facts and never error text, and the table is not
 * allowed to grow without end.
 *
 * **Never throws.** Every caller is doing something else — generating a board,
 * pulling a source — and failing to *mention* that work must not be able to
 * break it. A notification that cannot be written is logged and dropped, which
 * is exactly the position the application was in before this table existed.
 */

import { lt, sql } from "drizzle-orm";
import type { NotificationKind, NotificationTone } from "@universe/contracts";

import { db, schema } from "./db";

/**
 * How long a notification is worth keeping.
 *
 * Ninety days (owner). Two rows a day from the boards, so this is not about
 * volume — it is about a page that would otherwise accumulate every morning
 * since installation and bury this week's under years of routine success.
 */
const KEEP_DAYS = 90;

export async function notify(
  kind: NotificationKind,
  tone: NotificationTone,
  params: Record<string, unknown>
): Promise<void> {
  try {
    await db.insert(schema.notifications).values({ kind, tone, params });
    /* Swept here rather than on a schedule of its own: writes are rare and a
       sweep is one indexed delete, so a stage that existed only to run it
       would be more machinery than the problem. Read marks cascade. */
    await db
      .delete(schema.notifications)
      .where(
        lt(
          schema.notifications.createdAt,
          sql`now() - ${`${KEEP_DAYS} days`}::interval`
        )
      );
  } catch (error) {
    console.error(`[notify] could not record ${kind}`, error);
  }
}
