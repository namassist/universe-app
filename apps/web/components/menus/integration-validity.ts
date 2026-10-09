/**
 * An integration token's dates, as the Integrasi API list reads them.
 *
 * Both ends are site calendar dates, inclusive (`YYYY-MM-DD`), the same as
 * the API compares — so this is date arithmetic on strings, with no hour or
 * time zone in it. Pure, so the badges are tested without a browser.
 */

const DAY_MS = 86_400_000;
/** From here on the list warns, so there is time to extend before it stops. */
const SOON_DAYS = 14;

/** Days from `a` to `b`, both `YYYY-MM-DD`. UTC midnight on both sides, so
 *  no daylight-saving hour can make a day 23 or 25 hours long. */
const daysBetween = (a: string, b: string) =>
  Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS
  );

export type ValidityState =
  | { kind: "scheduled"; startsIn: number }
  | { kind: "never" }
  | { kind: "valid"; daysLeft: number }
  | { kind: "soon"; daysLeft: number }
  | { kind: "expired" };

export function validityState(
  validFrom: string,
  validUntil: string | null,
  today: string
): ValidityState {
  if (today < validFrom)
    return { kind: "scheduled", startsIn: daysBetween(today, validFrom) };
  if (!validUntil) return { kind: "never" };
  if (today > validUntil) return { kind: "expired" };
  const daysLeft = daysBetween(today, validUntil);
  return daysLeft <= SOON_DAYS
    ? { kind: "soon", daysLeft }
    : { kind: "valid", daysLeft };
}

/** The same day `years` on; 29 February becomes the 28th in a common year. */
export function addYears(date: string, years: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y + years, m - 1, 1));
  const lastDay = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** What the two date pickers and the "Tanpa batas" box hold. */
export type ValidityInput = {
  validFrom: string;
  validUntil: string;
  noEnd: boolean;
};

/** Today to a year on (owner: the start is today unless changed). */
export const defaultValidity = (today: string): ValidityInput => ({
  validFrom: today,
  validUntil: addYears(today, 1),
  noEnd: false,
});

/** The body the API takes; a ticked "Tanpa batas" wins over a filled end. */
export const validityBody = (input: ValidityInput) => ({
  validFrom: input.validFrom,
  validUntil: input.noEnd ? null : input.validUntil,
});

/** What stops the form being sent, in the words shown under the field. The
 *  API refuses the same ranges; this says so before the round trip. */
export function validityProblem(
  input: ValidityInput,
  today: string
): string | null {
  if (!input.validFrom) return "Isi tanggal mulai";
  if (input.noEnd) return null;
  if (!input.validUntil) return "Isi tanggal akhir, atau centang Tanpa batas";
  if (input.validUntil < input.validFrom)
    return "Tanggal akhir tidak boleh sebelum tanggal mulai";
  if (input.validUntil < today) return "Tanggal akhir sudah lewat";
  return null;
}

/** Today on the site — the browser runs on site time, as elsewhere here. */
export const siteToday = () => new Date().toLocaleDateString("sv-SE");
