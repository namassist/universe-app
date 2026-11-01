"use client";

import { fmt, useI18n } from "@/lib/i18n";
import { photoUrl } from "@/lib/queries/employees";
import type { LeaderboardRow } from "@/lib/queries/leaderboard";
import { cn } from "@/lib/utils";
import { Avatar, initialsOf } from "@/components/ui/avatar";

import {
  operationRatio,
  percentOf,
  podiumGap,
  podiumOrder,
  signedPoints,
  sleepHours,
} from "./leaderboard-rows";

type Place = 1 | 2 | 3;

/**
 * Everything a place owns. `--medal` is set once on the place and read by the
 * frame, the disc, the plinth's lip; a shared rank shares all of it.
 */
const PLACE: Record<
  Place,
  {
    medal: string;
    ribbon: string;
    portrait: string;
    disc: string;
    name: string;
    score: string;
    plinth: string;
  }
> = {
  1: {
    medal: "[--medal:var(--medal-gold)]",
    ribbon: "text-(--medal-ribbon-first)",
    portrait: "size-32 xl:size-36",
    disc: "size-16 text-4xl",
    name: "text-2xl",
    score: "text-6xl text-(--medal-gold-text)",
    plinth: "bg-(image:--plinth-fill-first) md:min-h-64",
  },
  2: {
    medal: "[--medal:var(--medal-silver)]",
    ribbon: "text-(--medal-ribbon)",
    portrait: "size-24 xl:size-28",
    disc: "size-12 text-2xl",
    name: "text-xl",
    score: "text-5xl",
    plinth: "bg-(image:--plinth-fill) md:min-h-56",
  },
  3: {
    medal: "[--medal:var(--medal-bronze)]",
    ribbon: "text-(--medal-ribbon)",
    portrait: "size-24 xl:size-28",
    disc: "size-12 text-2xl",
    name: "text-xl",
    score: "text-5xl",
    plinth: "bg-(image:--plinth-fill) md:min-h-[200px]",
  },
};

type Stat = { label: string; value: string };

/** What a plinth states beside the score: on the All board the person's
    habits, on a type's board how they did on that type. */
function useStats(row: LeaderboardRow, perType: boolean): Stat[] {
  const { t, lang } = useI18n();
  const ratio = {
    label: t.lbRatio,
    value: operationRatio(row.operated, row.shifts),
  };
  if (perType)
    return [
      ratio,
      { label: t.lbPenalty, value: signedPoints(row.penalty) },
      { label: t.lbStreak, value: String(row.streak) },
    ];
  const attendance = percentOf(row.attended, row.shifts);
  const sleep = sleepHours(row.sleepAvgMinutes, lang);
  return [
    ratio,
    {
      label: t.lbAttendance,
      value: attendance === null ? "—" : `${attendance}%`,
    },
    {
      label: t.lbSleepAvg,
      value: sleep === null ? "—" : fmt(t.lbHours, { h: sleep }),
    },
  ];
}

/** The ribbon the medal hangs from: two strips meeting behind the frame. */
function Ribbon({ className }: { className: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 44 36"
      className={cn("-mb-4 h-9 w-11 flex-none", className)}
    >
      <path d="M2 0h14l10 36H12z" fill="currentColor" opacity="0.8" />
      <path d="M42 0H28L18 36h14z" fill="currentColor" />
    </svg>
  );
}

/** The winner's lead, or another place's distance to the winner. */
function Gap({ row, top }: { row: LeaderboardRow; top: LeaderboardRow[] }) {
  const { t } = useI18n();
  const gap = podiumGap(row, top);
  if (!gap) return null;
  if (gap.kind === "lead")
    return (
      <p className="mt-4 rounded-full bg-(--medal-gold) px-3 py-1 text-xs font-bold text-(--medal-ink)">
        {fmt(t.lbLead, { n: gap.points })}
      </p>
    );
  return (
    <p className="mt-4 text-xs text-(--text-tertiary)">
      {fmt(t.lbBehind, { n: gap.points })}
    </p>
  );
}

function PodiumPlace({
  row,
  top,
  perType,
}: {
  row: LeaderboardRow;
  top: LeaderboardRow[];
  perType: boolean;
}) {
  const { t } = useI18n();
  const stats = useStats(row, perType);
  const place = Math.min(row.rank, 3) as Place;
  const look = PLACE[place];
  const placeLabel = { 1: t.lbPlace1, 2: t.lbPlace2, 3: t.lbPlace3 }[place];

  return (
    <li className={cn("flex flex-col items-center text-center", look.medal)}>
      <span className="sr-only">{placeLabel}</span>

      {/* The medal: a portrait hung from its ribbon, framed in its metal. */}
      <Ribbon className={look.ribbon} />
      <Avatar
        src={photoUrl(row)}
        alt={row.name}
        className={cn(
          "flex-none text-3xl shadow-[0_0_0_5px_var(--medal),var(--portrait-shadow)]",
          look.portrait
        )}
      >
        {initialsOf(row.name)}
      </Avatar>

      <p
        className={cn(
          "mt-5 line-clamp-2 px-3 font-display leading-none font-bold tracking-wide uppercase",
          look.name
        )}
      >
        {row.name}
      </p>
      <p className="mt-1.5 mb-4 flex items-baseline justify-center gap-1.5">
        <span
          className={cn(
            "font-display leading-none font-extrabold tabular-nums",
            look.score
          )}
        >
          {row.total < 0 ? signedPoints(row.total) : row.total}
        </span>
        <span className="text-sm text-(--text-secondary)">{t.lbPoints}</span>
      </p>

      {/* The plinth: its height is the place, its lit lip the metal. */}
      <div
        className={cn(
          "flex w-full flex-1 flex-col items-center rounded-icon px-4 pt-5 pb-6 shadow-[inset_0_4px_0_var(--medal)] md:flex-none md:rounded-b-none",
          look.plinth
        )}
      >
        <span
          aria-hidden
          className={cn(
            "grid flex-none place-items-center rounded-full bg-(--medal) font-display leading-none font-extrabold text-(--medal-ink) tabular-nums",
            look.disc
          )}
        >
          {row.rank}
        </span>

        <dl className="mt-4 flex flex-wrap justify-center gap-2">
          {stats.map((s) => (
            <div
              key={s.label}
              className="flex min-w-16 flex-col-reverse items-center rounded-control bg-(--plinth-tile) px-3 py-2"
            >
              <dt className="mt-1 text-[11px] leading-tight text-(--text-secondary)">
                {s.label}
              </dt>
              <dd className="font-display text-xl leading-none font-bold tabular-nums">
                {s.value}
              </dd>
            </div>
          ))}
        </dl>

        <Gap row={row} top={top} />
      </div>
    </li>
  );
}

/**
 * The first three of the board on a medal stage, second–first–third, the
 * plinths standing side by side at the heights of their places. On a narrow
 * screen they stack in rank order instead, winner first.
 *
 * The board's own top three, whatever the search box holds: the search finds
 * a person in the table, it does not crown them.
 */
export function Podium({
  rows,
  perType,
}: {
  rows: LeaderboardRow[];
  perType: boolean;
}) {
  const { t } = useI18n();
  const top = rows.slice(0, 3);
  if (!top.length) return null;
  return (
    <section aria-label={t.lbPodium} className="mb-8">
      <ol className="flex flex-col gap-10 md:hidden">
        {top.map((row) => (
          <PodiumPlace
            key={row.employeeId}
            row={row}
            top={top}
            perType={perType}
          />
        ))}
      </ol>
      <ol className="hidden items-end pt-2 md:grid md:grid-cols-3">
        {podiumOrder(top).map((row) => (
          <PodiumPlace
            key={row.employeeId}
            row={row}
            top={top}
            perType={perType}
          />
        ))}
      </ol>
    </section>
  );
}
