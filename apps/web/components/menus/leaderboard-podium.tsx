"use client";

import { Trophy } from "lucide-react";

import { fmt, useI18n } from "@/lib/i18n";
import { photoUrl } from "@/lib/queries/employees";
import type { LeaderboardRow } from "@/lib/queries/leaderboard";
import { cn } from "@/lib/utils";
import { Avatar, initialsOf } from "@/components/ui/avatar";

import {
  operationRatio,
  percentOf,
  podiumOrder,
  signedPoints,
  sleepHours,
} from "./leaderboard-rows";

/** The metal of a rank; a shared rank shares its metal. */
const METAL: Record<1 | 2 | 3, string> = {
  1: "bg-(image:--podium-first)",
  2: "bg-(image:--podium-second)",
  3: "bg-(image:--podium-third)",
};

type Stat = { label: string; value: string };

/** What a card states beside the score: on the All board the person's
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

function PodiumCard({
  row,
  perType,
}: {
  row: LeaderboardRow;
  perType: boolean;
}) {
  const { t } = useI18n();
  const stats = useStats(row, perType);
  const place = Math.min(row.rank, 3) as 1 | 2 | 3;
  const placeLabel = { 1: t.lbPlace1, 2: t.lbPlace2, 3: t.lbPlace3 }[place];
  const first = place === 1;

  return (
    <li
      className={cn(
        "relative flex min-h-64 flex-col overflow-hidden rounded-[22px] border border-(--podium-border) p-6 text-(--podium-text) shadow-(--podium-shadow)",
        METAL[place],
        first && "md:min-h-72"
      )}
    >
      <span className="sr-only">{placeLabel}</span>
      <div className="flex items-start justify-between gap-3">
        <div>
          {/* Full white: it sits on the lightest corner of the metal. */}
          <p className="text-[11px] font-semibold tracking-wider uppercase">
            {t.lbPoints}
          </p>
          <p
            className={cn(
              "font-mono leading-none font-extrabold tabular-nums",
              first ? "text-6xl" : "text-5xl"
            )}
          >
            {row.total < 0 ? signedPoints(row.total) : row.total}
          </p>
        </div>
        <Avatar
          src={photoUrl(row)}
          alt={row.name}
          className="size-14 flex-none text-base"
        >
          {initialsOf(row.name)}
        </Avatar>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="flex min-w-0 flex-col-reverse">
            <dt className="truncate text-[11px] text-(--podium-text-muted) uppercase">
              {s.label}
            </dt>
            <dd className="font-mono text-base font-bold tabular-nums">
              {s.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* Engraved, not announced: the card's label already says the place. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-3 -bottom-4 text-(--podium-trophy)"
      >
        <Trophy className="size-36 -rotate-6" strokeWidth={1.4} />
        <span className="absolute inset-x-0 top-9 text-center text-3xl font-black">
          {row.rank}
        </span>
      </div>

      <p className="relative mt-auto line-clamp-2 max-w-[75%] pt-6 text-xl leading-tight font-extrabold uppercase">
        {row.name}
      </p>
    </li>
  );
}

/**
 * The first three of the board, second–first–third, as a podium stands. On a
 * narrow screen they stack in rank order instead, winner first.
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
    <section aria-label={t.lbPodium} className="mb-6">
      <ol className="flex flex-col gap-4 md:hidden">
        {top.map((row) => (
          <PodiumCard key={row.employeeId} row={row} perType={perType} />
        ))}
      </ol>
      <ol className="hidden items-end gap-5 pt-5 md:grid md:grid-cols-3">
        {podiumOrder(top).map((row) => (
          <PodiumCard key={row.employeeId} row={row} perType={perType} />
        ))}
      </ol>
    </section>
  );
}
