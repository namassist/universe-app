/**
 * The hazardous places and the safety message, read once for both audiences.
 *
 * The wall and the ticket must say the same thing on the same morning, so they
 * read the same rows rather than each keeping a list. An administrator sets
 * them before the shift through the running-text screen, which is where the
 * ticker has always been edited.
 *
 * The two shapes differ because the media do. A ticker is a sentence that
 * scrolls past once, so the locations arrive joined: "Lokasi berbahaya: PIT,
 * KASTURI ATAS". A slip is read standing still, so they arrive as a named
 * section the eye can find.
 */

import { asc, eq } from "drizzle-orm";

import { db, schema } from "./db";

/**
 * How many of each reach the paper.
 *
 * Not a database constraint: the ticker may carry more and an administrator
 * may keep more. This is what a 58 mm roll can hold before the slip stops
 * being read — eight locations already take four lines of it.
 */
export const MAX_HAZARDS = 8;
/* Two since 2026-09-15, when the messages moved into the slip's closing lines. */
export const MAX_SAFETY = 2;

export type SafetyNotices = {
  /** Bare place names, no detail — they are read as a list, not a briefing. */
  hazards: string[];
  safety: string[];
};

/** `"Lokasi berbahaya: PIT, KASTURI ATAS"`, or null when none are set. */
export function hazardSentence(hazards: string[]): string | null {
  return hazards.length ? `Lokasi berbahaya: ${hazards.join(", ")}` : null;
}

/**
 * What is set for this shift, capped.
 *
 * Ordered by creation, like the ticker itself: an administrator adding a
 * location expects it at the end of the list, not sorted away from where they
 * put it.
 */
export async function activeNotices(): Promise<SafetyNotices> {
  const rows = await db
    .select({ text: schema.runTexts.text, kind: schema.runTexts.kind })
    .from(schema.runTexts)
    .where(eq(schema.runTexts.active, true))
    .orderBy(asc(schema.runTexts.createdAt));

  const of = (kind: "hazard" | "safety", cap: number) =>
    rows
      .filter((r) => r.kind === kind)
      .map((r) => r.text.trim())
      .filter((t) => t.length > 0)
      .slice(0, cap);

  return {
    hazards: of("hazard", MAX_HAZARDS),
    safety: of("safety", MAX_SAFETY),
  };
}
