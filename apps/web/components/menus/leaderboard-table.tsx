"use client";

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
  operationRatio,
  percentOf,
  signedPoints,
  sleepHours,
  splitUnits,
} from "./leaderboard-rows";

/** Ranks that get a badge rather than a plain number. */
const PODIUM = 3;

const NUM = "text-right font-mono tabular-nums";

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
}: {
  rows: LeaderboardRow[];
  perType: boolean;
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
            <TableHead className="text-right">{t.lbPoints}</TableHead>
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
                    "font-semibold",
                    row.total < 0 && "text-(--badge-danger-text)"
                  )}
                >
                  {signedPoints(row.total)}
                </TableCell>
                <TableCell className={NUM}>
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
                <TableCell className={NUM}>{row.streak}</TableCell>
                {perType ? null : (
                  <>
                    <TableCell className={NUM}>
                      {attendance === null ? "—" : `${attendance}%`}
                    </TableCell>
                    <TableCell className={NUM}>
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
