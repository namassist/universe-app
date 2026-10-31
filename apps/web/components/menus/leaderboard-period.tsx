"use client";

import { useI18n } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { Segmented, SegmentedButton } from "@/components/ui/segmented";

import {
  isoDay,
  monthPeriod,
  weekPeriod,
  type Period,
} from "./leaderboard-rows";

export type PeriodKind = "week" | "month" | "custom";

const KINDS: PeriodKind[] = ["week", "month", "custom"];

/** The period a kind opens on: this week, this month, or — for a custom
    range — whatever was showing, to be widened or narrowed from there. */
export function openPeriod(kind: PeriodKind, showing: Period): Period {
  const today = isoDay(new Date());
  if (kind === "week") return weekPeriod(today);
  if (kind === "month") return monthPeriod(today.slice(0, 7));
  return showing;
}

/**
 * Weekly, monthly or a custom range, and the input each one needs.
 *
 * A week is picked by any day in it and snaps to Monday–Sunday; `<input
 * type="week">` is not offered by every browser the site uses. A custom range
 * is passed on as typed, even backwards — the menu says why it will not read
 * rather than this control silently swapping the ends.
 */
export function PeriodControls({
  kind,
  period,
  onChange,
}: {
  kind: PeriodKind;
  period: Period;
  onChange: (kind: PeriodKind, period: Period) => void;
}) {
  const { t } = useI18n();
  const label: Record<PeriodKind, string> = {
    week: t.lbWeekly,
    month: t.lbMonthly,
    custom: t.lbCustom,
  };

  return (
    <>
      <Segmented role="group" aria-label={t.lbPeriod}>
        {KINDS.map((k) => (
          <SegmentedButton
            key={k}
            type="button"
            active={kind === k}
            aria-pressed={kind === k}
            onClick={() => onChange(k, openPeriod(k, period))}
          >
            {label[k]}
          </SegmentedButton>
        ))}
      </Segmented>

      {kind === "week" ? (
        <Input
          type="date"
          className="w-40 font-mono"
          value={period.from}
          onChange={(e) =>
            e.target.value && onChange("week", weekPeriod(e.target.value))
          }
          aria-label={t.lbWeekOf}
        />
      ) : null}
      {kind === "month" ? (
        <Input
          type="month"
          className="w-44 font-mono"
          value={period.from.slice(0, 7)}
          onChange={(e) =>
            e.target.value && onChange("month", monthPeriod(e.target.value))
          }
          aria-label={t.lbMonth}
        />
      ) : null}
      {kind === "custom" ? (
        <>
          <Input
            type="date"
            className="w-40 font-mono"
            value={period.from}
            onChange={(e) =>
              e.target.value &&
              onChange("custom", { ...period, from: e.target.value })
            }
            aria-label={t.lbFrom}
          />
          <Input
            type="date"
            className="w-40 font-mono"
            value={period.to}
            onChange={(e) =>
              e.target.value &&
              onChange("custom", { ...period, to: e.target.value })
            }
            aria-label={t.lbTo}
          />
        </>
      ) : null}
    </>
  );
}
