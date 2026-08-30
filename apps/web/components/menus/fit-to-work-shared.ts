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

export const FTW_CAT_BADGE: Record<FtwCatKey, BadgeVariant> = {
  fit: "success",
  istirahat: "warning",
  tidak: "danger",
  belum: "neutral",
};

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

export const ftwShiftLabel = (sentAt: string | null): string => {
  const shift = ftwUploadShift(sentAt);
  return shift === null ? "—" : `Shift ${shift}`;
};

/**
 * Reading order: worst first (owner, 2026-08-30).
 *
 *   Tidak Boleh Bekerja → Kurang tidur → Upload telat → Fit
 *
 * Lateness only promotes a row that is otherwise fit: a person who is both
 * short of sleep and late is short of sleep first, and burying that under an
 * administrative flag would rank the smaller problem higher. "Belum lapor"
 * sits with "tidak boleh bekerja" — no FTW at all blocks work just as firmly
 * as a refusal does, and it does not belong below a rest advisory.
 */
const FTW_RANK: Record<FtwCatKey, number> = {
  tidak: 0,
  belum: 1,
  istirahat: 2,
  fit: 4,
};

export const ftwSeverity = (category: string | null, late: boolean): number => {
  const cat = ftwCatOf(category);
  return cat === "fit" && late ? 3 : FTW_RANK[cat];
};
