"use client";

import Link from "next/link";

import { fmt, useI18n } from "@/lib/i18n";
import type { LeaderboardRow } from "@/lib/queries/leaderboard";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  NameCell,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  breakdownHref,
  type BreakdownFilter,
} from "./leaderboard-breakdown-rows";
import {
  operationRatio,
  percentOf,
  signedPoints,
  sleepHours,
  splitUnits,
} from "./leaderboard-rows";

/** Ranks that get a badge rather than a plain number. */
const PODIUM = 3;

const NUM = "text-right font-mono tabular-nums";
/** The supporting figures step back a tone so the points column leads. */
const SUPPORT = `${NUM} text-(--text-secondary)`;

/** At most three unit codes; the rest behind a "+x" that names them on hover
    and to a screen reader. */
function UnitsCell({ units }: { units: LeaderboardRow["units"] }) {
  const { t } = useI18n();
  const { shown, rest } = splitUnits(units);
  if (!units.length) return <span className="text-(--text-tertiary)">—</span>;
  const more = fmt(t.lbMoreUnits, {
    n: rest.length,
    list: rest.map((u) => u.code).join(", "),
  });
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {shown.map((u) => (
        <Badge key={u.code} className="font-mono">
          {u.code}
        </Badge>
      ))}
      {rest.length ? (
        /* The codes as text for a screen reader; the hover title for a
           mouse. The "+x" itself is only the sighted shorthand. */
        <Badge variant="info" title={more} className="cursor-help">
          <span aria-hidden>+{rest.length}</span>
          <span className="sr-only">{more}</span>
        </Badge>
      ) : null}
    </span>
  );
}

/**
 * The ranked rows. The All board reads the person — department, attendance,
 * sleep; a type's board reads the type — the units of it they ran.
 */
export function LeaderboardTable({
  rows,
  perType,
  filter,
}: {
  rows: LeaderboardRow[];
  perType: boolean;
  /** The board's filter, carried into each operator's breakdown. */
  filter: BreakdownFilter;
}) {
  const { t, lang } = useI18n();
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20 text-center">{t.lbRank}</TableHead>
            <TableHead>{t.lbOperator}</TableHead>
            {perType ? (
              <TableHead>{t.lbUnits}</TableHead>
            ) : (
              <TableHead>{t.lbDepartment}</TableHead>
            )}
            <TableHead className="text-right text-(--text-primary)">
              {t.lbPoints}
            </TableHead>
            <TableHead className="text-right" title={t.lbRatioHint}>
              {t.lbRatio}
            </TableHead>
            <TableHead className="text-right">{t.lbPenalty}</TableHead>
            <TableHead className="text-right">{t.lbStreak}</TableHead>
            {perType ? null : (
              <>
                <TableHead className="text-right">{t.lbAttendance}</TableHead>
                <TableHead className="text-right">{t.lbSleepAvg}</TableHead>
              </>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const attendance = percentOf(row.attended, row.shifts);
            const sleep = sleepHours(row.sleepAvgMinutes, lang);
            return (
              <TableRow key={row.employeeId}>
                <TableCell className="text-center font-mono">
                  {row.rank <= PODIUM ? (
                    <Badge variant="info">{row.rank}</Badge>
                  ) : (
                    <span className="text-(--text-secondary)">{row.rank}</span>
                  )}
                </TableCell>
                <TableCell>
                  <NameCell name={row.name} sub={row.nik} />
                </TableCell>
                <TableCell>
                  {perType ? (
                    <UnitsCell units={row.units} />
                  ) : (
                    (row.department ?? "—")
                  )}
                </TableCell>
                <TableCell
                  className={cn(
                    NUM,
                    "text-base font-bold",
                    row.total < 0
                      ? "text-(--badge-danger-text)"
                      : "text-(--text-primary)"
                  )}
                >
                  {/* The total opens what it is made of, shift by shift,
                      for this board's period, type and department. */}
                  <Link
                    href={breakdownHref(row.employeeId, filter)}
                    prefetch={false}
                    aria-label={`${signedPoints(row.total)} — ${fmt(t.lbBdOpen, { name: row.name })}`}
                    title={fmt(t.lbBdOpen, { name: row.name })}
                    className="rounded-sm text-inherit underline decoration-(--divider) decoration-dotted underline-offset-4 hover:text-primary-bright hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {signedPoints(row.total)}
                  </Link>
                </TableCell>
                <TableCell className={SUPPORT}>
                  {operationRatio(row.operated, row.shifts)}
                </TableCell>
                <TableCell
                  className={cn(
                    NUM,
                    row.penalty < 0
                      ? "text-(--badge-danger-text)"
                      : "text-(--text-tertiary)"
                  )}
                >
                  {signedPoints(row.penalty)}
                </TableCell>
                <TableCell className={SUPPORT}>{row.streak}</TableCell>
                {perType ? null : (
                  <>
                    <TableCell className={SUPPORT}>
                      {attendance === null ? "—" : `${attendance}%`}
                    </TableCell>
                    <TableCell className={SUPPORT}>
                      {sleep === null ? "—" : fmt(t.lbHours, { h: sleep })}
                    </TableCell>
                  </>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
