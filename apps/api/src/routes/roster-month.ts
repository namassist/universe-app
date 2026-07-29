/**
 * Calendar arithmetic for the roster, done on text.
 *
 * A `Date` here would be a timezone bug waiting for the first server whose
 * offset is west of UTC: `new Date("2026-07-01")` is midnight *UTC*, and
 * formatting it back in local time yields 30 June. Every date the roster stores
 * is a calendar date with no instant attached — a month, a day, a column
 * heading — so it is handled as text and the one place a `Date` is unavoidable
 * reads its parts in UTC.
 *
 * Its own module rather than a corner of `roster.ts` because the routes, the
 * importer, and the revision validator all need it, and having any two of them
 * import each other for it is a cycle waiting to bite.
 */

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one, in UTC where no
  // offset can move it.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `2026-07-01` → every date of July 2026, in order. */
export function monthDays(firstDay: string): string[] {
  const year = Number(firstDay.slice(0, 4));
  const month = Number(firstDay.slice(5, 7));
  return Array.from(
    { length: daysInMonth(year, month) },
    (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`
  );
}

/** The last date of the month a first-of-month date names. */
export function monthEnd(firstDay: string): string {
  const days = monthDays(firstDay);
  return days[days.length - 1]!;
}

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * `2026-08-01` → `01 Aug 26`, the heading a roster sheet already uses.
 *
 * Matched to the planner's existing workbook rather than invented, because the
 * template is meant to be recognisable to someone who has been filling one in
 * by hand. It is presentation only: the parser counts day columns and never
 * reads their headings, so a file whose headings were retyped in another form
 * still imports.
 */
export function dayHeader(date: string): string {
  const month = Number(date.slice(5, 7));
  return `${date.slice(8)} ${MONTH_ABBR[month - 1]} ${date.slice(2, 4)}`;
}

/** `2026-07` → `2026-07-01`; anything else → null. */
export function monthToFirstDay(month: string): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  return `${month}-01`;
}
