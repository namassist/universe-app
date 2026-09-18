/**
 * An instant from the API, as a clock on the wall at site.
 *
 * The API sends `generated_at` — a `timestamptz` — through `toISOString()`, so
 * what arrives is **UTC**: a board generated at 20:03 WITA reads
 * `…T12:03:00.000Z`. Slicing characters 11–16 out of that string, as this
 * screen used to, prints the UTC clock and calls it local — eight hours wrong,
 * every time, with no error anywhere.
 *
 * Parsing and formatting is the whole fix. It follows the machine's timezone,
 * which is the same convention the rest of the app labels "WITA" (see
 * `unit-status.tsx`, `dashboard.tsx`).
 *
 * In `lib` rather than beside the board it was written for, because the
 * dashboard's ACTUAL card needs the same instant read the same way — and a
 * second copy of this is exactly how the eight-hour bug got in the first
 * time.
 *
 * Not to be used on `sent_at` or the attendance in/out columns: those columns
 * are `timestamp` *without* time zone, carrying a naive local clock already,
 * and running them through here would shift a time that was never UTC.
 */
export function siteClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
