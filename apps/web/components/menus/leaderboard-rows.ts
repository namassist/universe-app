/**
 * Peringkat Operator's period and table helpers. Pure, so they test without a
 * browser (`leaderboard-rows.test.ts`).
 */

import { LEADERBOARD_MAX_DAYS } from "@universe/contracts";

import type { Lang } from "@/lib/i18n";

const DAY_MS = 86_400_000;

export type Period = { from: string; to: string };

/** A point total as the board prints it: "+25", "−15" (a true minus), "0". */
export function signedPoints(points: number): string {
  if (points > 0) return `+${points}`;
  if (points < 0) return `−${Math.abs(points)}`;
  return "0";
}

/** The search box: a name, in any case, or any run of NIK digits. */
export function matchesSearch(
  row: { nik: string; name: string },
  search: string
): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return row.name.toLowerCase().includes(q) || row.nik.includes(q);
}

/* Calendar arithmetic on "YYYY-MM-DD" in UTC, so no clock change moves a day. */
const utc = (date: string) => new Date(`${date}T00:00:00Z`);
const day = (at: Date) => at.toISOString().slice(0, 10);

/** "YYYY-MM-DD" of a date by the browser's clock — the site's, at the site. */
export function isoDay(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/** The Monday-to-Sunday week `date` falls in. */
export function weekPeriod(date: string): Period {
  const at = utc(date);
  const sinceMonday = (at.getUTCDay() + 6) % 7;
  const monday = new Date(at.getTime() - sinceMonday * DAY_MS);
  return {
    from: day(monday),
    to: day(new Date(monday.getTime() + 6 * DAY_MS)),
  };
}

/** "YYYY-MM", first day to last. */
export function monthPeriod(month: string): Period {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  return { from: `${month}-01`, to: day(new Date(Date.UTC(year, mon, 0))) };
}

/** Why a custom range would be refused, as the API would refuse it; null when
    it reads. */
export function customPeriodError(
  from: string,
  to: string
): "reversed" | "too-long" | null {
  const days = (utc(to).getTime() - utc(from).getTime()) / DAY_MS + 1;
  if (days < 1) return "reversed";
  if (days > LEADERBOARD_MAX_DAYS) return "too-long";
  return null;
}

/** Operated over rostered shifts, as counted: "20/27". */
export function operationRatio(operated: number, shifts: number): string {
  return `${operated}/${shifts}`;
}

/** A whole percentage; null when there is nothing to take it of. */
export function percentOf(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 100);
}

/** Minutes as hours to one decimal, in the reader's notation; null with no
    reading. */
export function sleepHours(minutes: number | null, lang: Lang): string | null {
  if (minutes === null) return null;
  return (minutes / 60).toLocaleString(lang === "id" ? "id-ID" : "en-US", {
    maximumFractionDigits: 1,
  });
}

/** The units a row shows, and the ones behind its "+x". */
export function splitUnits<T>(
  units: readonly T[],
  max = 3
): { shown: T[]; rest: T[] } {
  return { shown: units.slice(0, max), rest: units.slice(max) };
}

/** The first three rows as the podium stands them: second, first, third. */
export function podiumOrder<T>(rows: readonly T[]): T[] {
  const [first, second, third] = rows;
  return [second, first, third].filter((r): r is T => r !== undefined);
}
