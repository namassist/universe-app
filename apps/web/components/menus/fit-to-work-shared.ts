import { cn } from "@/lib/utils";
import type { BadgeVariant } from "@/components/ui/badge";

/**
 * Display vocabulary shared by the FTW list and its history page.
 *
 * savera's verdict is grouped for tone and filtering; the badge always shows
 * the source's own words — their rules are operator-configurable, so the
 * exact labels may change under us. Only the grouping is ours.
 */
export type FtwCatKey = "fit" | "istirahat" | "tidak" | "belum";

export const ftwCatOf = (category: string | null): FtwCatKey => {
  if (!category) return "belum";
  if (category.startsWith("Dapat")) return "fit";
  if (category.startsWith("Tidak")) return "tidak";
  return "istirahat";
};

/*
 * `satisfies` rather than an annotation, so the values stay the four literals
 * they are. The kiosk badge takes a narrower set of tones than the admin one,
 * and these four are in both — widening them to `BadgeVariant` would hand the
 * wall an "accent" it cannot render and force a second copy of this mapping.
 */
export const FTW_CAT_BADGE = {
  fit: "success",
  istirahat: "warning",
  tidak: "danger",
  belum: "neutral",
} as const satisfies Record<FtwCatKey, BadgeVariant>;

export const ftwSleepClass = (cat: FtwCatKey) =>
  cn(
    "font-mono",
    (cat === "istirahat" || cat === "tidak") &&
      "font-semibold text-(--color-danger-text)",
    cat === "belum" && "text-(--text-tertiary)",
    cat === "fit" && "text-(--text-secondary)"
  );

export const ftwSleepText = (minutes: number) =>
  minutes > 0 ? `${Math.floor(minutes / 60)}j ${minutes % 60}m` : "—";

export const ftwDecisionBadge = (decision: string | null): BadgeVariant =>
  !decision ? "neutral" : /aman/i.test(decision) ? "success" : "danger";

export const isoDate = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const daysAgo = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - days);
  return isoDate(d);
};

/** Whole-day difference between two ISO dates. */
export const spanDays = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
  86_400_000;

/**
 * Which half of the day an FTW was uploaded in (owner, 2026-08-30).
 *
 *   Shift 1 — 00:00–11:59      Shift 2 — 12:00–23:59
 *
 * This is the *upload* shift, not the operator's working shift, and it is
 * derived here rather than taken from savera's own `shift` column because that
 * column is wrong by this very definition: on 2026-08-29 it labelled 307 rows
 * "Shift 1" that were uploaded at or after 12:00. Derived from `sent_at` it
 * cannot disagree with itself.
 *
 * It is deliberately NOT rendered as Siang/Malam. That would read as a claim
 * about which shift the person works, and the roster is the only thing that
 * knows — 246 of these afternoon uploads on 2026-08-29 belong to day-rostered
 * operators who simply uploaded late.
 */
export type FtwUploadShift = 1 | 2 | null;

/** The one place that knows where the day divides. */
const UPLOAD_SPLIT = "12:00:00";

const shiftOfTime = (hhmmss: string): 1 | 2 => (hhmmss < UPLOAD_SPLIT ? 1 : 2);

export const ftwUploadShift = (sentAt: string | null): FtwUploadShift =>
  sentAt ? shiftOfTime(sentAt.slice(11, 19)) : null;

/**
 * The upload shift now — what the screen opens on, so a supervisor arrives
 * already looking at the half of the day being worked rather than filtering
 * to it by hand. Reads the same boundary as the rows themselves, so the two
 * can never drift apart.
 */
export const ftwUploadShiftNow = (now = new Date()): 1 | 2 =>
  shiftOfTime(now.toTimeString().slice(0, 8));

/**
 * The half of the day a list row belongs to.
 *
 * An upload by when it was sent, as above. A "Belum lapor" row has nothing
 * sent, so it is placed by the shift the roster owed the upload for — the day
 * shift uploads in Shift 1 and the night shift in Shift 2, which is exactly
 * where the row would have landed had it been sent on time (2026-09-17).
 */
export const ftwRowShift = (row: {
  sentAt: string | null;
  rosterShift: "day" | "night" | null;
}): FtwUploadShift =>
  row.sentAt
    ? ftwUploadShift(row.sentAt)
    : row.rosterShift
      ? row.rosterShift === "day"
        ? 1
        : 2
      : null;

export const ftwShiftLabel = (row: {
  sentAt: string | null;
  rosterShift: "day" | "night" | null;
}): string => {
  const shift = ftwRowShift(row);
  return shift === null ? "—" : `Shift ${shift}`;
};

/**
 * Reading order (owner, 2026-09-17): red, yellow, green, then not filed.
 *
 *   Tidak Boleh Bekerja → Istirahat → Dapat Bekerja → Belum lapor
 *
 * "Belum lapor" closes the list. Since the list builds those rows from the
 * roster there are many of them before a shift's uploads come in — 147 on one
 * afternoon — and leading with them buried the verdicts that were actually
 * sent.
 *
 * Lateness does not promote a row: a late "Dapat Bekerja" is green like the
 * rest, and the late flag stays on its send time.
 */
const FTW_RANK: Record<FtwCatKey, number> = {
  tidak: 0,
  istirahat: 1,
  fit: 2,
  belum: 3,
};

export const ftwSeverity = (category: string | null): number =>
  FTW_RANK[ftwCatOf(category)];
