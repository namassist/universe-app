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
