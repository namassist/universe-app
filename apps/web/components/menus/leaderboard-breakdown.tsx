"use client";

import * as React from "react";
import { notFound, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Search, TriangleAlert } from "lucide-react";

import { POINTS, type BreakdownKind } from "@universe/contracts";

import { errorMessage, isStatus } from "@/lib/api";
import { fmt, useI18n, type Dict } from "@/lib/i18n";
import { photoUrl } from "@/lib/queries/employees";
import {
  leaderboardOperatorQueryOptions,
  type BreakdownLine,
  type OperatorBreakdown,
} from "@/lib/queries/leaderboard";
import { cn } from "@/lib/utils";
import { useRole } from "@/components/providers/role-context";
import { Avatar, initialsOf } from "@/components/ui/avatar";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pagination, usePagination } from "@/components/ui/pagination";
import {
  FootSum,
  PageTitle,
  Panel,
  PanelFoot,
  SectionTitle,
  Toolbar,
  ToolbarTitle,
} from "@/components/ui/panel";
import { StateBox } from "@/components/ui/state-box";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";

import {
  boardHref,
  kindCounts,
  lineReason,
  readBreakdownFilter,
  unitRole,
  type LineReason,
} from "./leaderboard-breakdown-rows";
import { signedPoints, sleepHours } from "./leaderboard-rows";

const NUM = "text-right font-mono tabular-nums";
/** The best a shift can score: everything, and the full consistency bonus. */
const MAX_SHIFT = POINTS.base + POINTS.onTime + POINTS.sleep + POINTS.streakMax;

/** The six categories of the scheme, then the day nothing was settled. */
const KIND_ORDER: readonly BreakdownKind[] = [
  "operated",
  "stood-down",
  "not-counted",
  "not-ready",
  "unreadable",
  "off-roster",
  "unsettled",
];

const KIND_TONE: Record<BreakdownKind, BadgeVariant> = {
  operated: "success",
  "stood-down": "info",
  "not-counted": "warning",
  "not-ready": "danger",
  unreadable: "neutral",
  "off-roster": "neutral",
  unsettled: "neutral",
};

function kindLabel(t: Dict, kind: BreakdownKind): string {
  return {
    operated: t.lbKindOperated,
    "stood-down": t.lbKindStoodDown,
    "not-counted": t.lbKindNotCounted,
    "not-ready": t.lbKindNotReady,
    unreadable: t.lbKindUnreadable,
    "off-roster": t.lbKindOffRoster,
    unsettled: t.lbKindUnsettled,
  }[kind];
}

function reasonLabel(t: Dict, reason: LineReason): string {
  return {
    noTap: t.lbRsNoTap,
    lateOrFtw: t.lbRsLateOrFtw,
    seatedNoTap: t.lbRsSeatedNoTap,
    seatedNoFtw: t.lbRsSeatedNoFtw,
  }[reason];
}

/** The rule each category scores by, from the same values the API scores. */
function kindRule(t: Dict, kind: BreakdownKind): string {
  switch (kind) {
    case "operated":
    case "stood-down":
      return fmt(t.lbBdRuleCounted, {
        base: POINTS.base,
        onTime: POINTS.onTime,
        sleep: POINTS.sleep,
        bonus: POINTS.streakMax,
        max: MAX_SHIFT,
      });
    case "not-counted":
      return t.lbBdRuleBroken;
    case "not-ready":
      return fmt(t.lbBdRuleNotReady, { n: signedPoints(POINTS.notReady) });
    default:
      return t.lbBdRuleHeld;
  }
}

type DateLabel = (iso: string) => string;

/** A date as the page prints it, with or without the weekday. One formatter
    per language, built once, rather than one per table row. */
function useDateLabel(withWeekday: boolean): DateLabel {
  const { lang } = useI18n();
  const format = React.useMemo(
    () =>
      new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "id-ID", {
        weekday: withWeekday ? "short" : undefined,
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
    [lang, withWeekday]
  );
  return (iso) => format.format(new Date(`${iso}T00:00:00`));
}

/** One part of a shift's points; a dot where it scored nothing, read as 0. */
function Part({ points }: { points: number }) {
  if (points === 0)
    return (
      <span className="text-(--text-tertiary)">
        <span aria-hidden>·</span>
        <span className="sr-only">0</span>
      </span>
    );
  return <>{signedPoints(points)}</>;
}

function ShiftCell({ line }: { line: BreakdownLine }) {
  const { t } = useI18n();
  if (line.kind === "off-roster")
    return <Badge className="font-mono">{line.rosterCode}</Badge>;
  const night = line.shift === "night";
  return (
    <span className="font-mono">
      {night ? "N" : "D"}
      <span className="ml-1.5 font-sans text-(--text-tertiary)">
        {night ? t.shiftNight : t.shiftDay}
      </span>
    </span>
  );
}

function UnitCell({ line }: { line: BreakdownLine }) {
  const { t } = useI18n();
  const role = unitRole(line);
  if (role === null) return <span className="text-(--text-tertiary)">—</span>;
  if (role === "spare")
    return <span className="text-(--text-secondary)">{t.lbBdSpare}</span>;
  if (role === "plan")
    return (
      <span className="font-mono text-(--text-secondary)">
        {fmt(t.lbBdPlanUnit, { code: line.unitCode ?? "" })}
      </span>
    );
  return <Badge className="font-mono">{line.unitCode}</Badge>;
}

type TypeName = (id: string | null) => string | null;

function StatusCell({
  line,
  typeName,
}: {
  line: BreakdownLine;
  typeName: TypeName;
}) {
  const { t, lang } = useI18n();
  const reason = lineReason(line);
  const sleep = sleepHours(line.sleepMinutes, lang);
  /* A shift left off this board says where it counted instead. */
  const shiftOffBoard = !line.onBoard && line.rosterCode === null;
  const elsewhere = shiftOffBoard ? typeName(line.unitTypeId) : null;
  const offBoard = shiftOffBoard
    ? elsewhere
      ? fmt(t.lbBdOtherBoard, { name: elsewhere })
      : t.lbBdNoBoard
    : null;
  const notes = [
    reason ? reasonLabel(t, reason) : null,
    sleep ? fmt(t.lbBdSleepRead, { h: sleep }) : null,
    offBoard,
  ].filter((note): note is string => note !== null);
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant={KIND_TONE[line.kind]} dot>
        {kindLabel(t, line.kind)}
      </Badge>
      {notes.length ? (
        <span className="text-xs text-(--text-tertiary)">
          {notes.join(" · ")}
        </span>
      ) : null}
    </div>
  );
}

function LineRow({
  line,
  typeName,
  dateLabel,
}: {
  line: BreakdownLine;
  typeName: TypeName;
  dateLabel: DateLabel;
}) {
  const { t } = useI18n();
  /* Roster days and other boards' shifts step back a tone — they are on the
     page to explain the streak, not the total — and each says why in its
     status. A text token rather than opacity, which would take the notes
     below contrast. */
  const muted = !line.onBoard;
  return (
    <TableRow className={cn(muted && "text-(--text-secondary)")}>
      <TableCell className="whitespace-nowrap">
        {dateLabel(line.date)}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <ShiftCell line={line} />
      </TableCell>
      <TableCell>
        <StatusCell line={line} typeName={typeName} />
      </TableCell>
      <TableCell>
        <UnitCell line={line} />
      </TableCell>
      <TableCell
        className={cn(NUM, line.base < 0 && "text-(--badge-danger-text)")}
      >
        <Part points={line.base} />
      </TableCell>
      <TableCell className={NUM}>
        <Part points={line.onTime} />
      </TableCell>
      <TableCell className={NUM}>
        <Part points={line.sleep} />
      </TableCell>
      <TableCell className={NUM}>
        <Part points={line.streakBonus} />
      </TableCell>
      <TableCell
        className={cn(
          NUM,
          "font-bold",
          line.total < 0
            ? "text-(--badge-danger-text)"
            : muted
              ? "text-(--text-secondary)"
              : "text-(--text-primary)"
        )}
      >
        {signedPoints(line.total)}
      </TableCell>
      <TableCell className={cn(NUM, "text-(--text-secondary)")}>
        {line.streak === null ? (
          <span title={t.lbBdUnchanged}>
            <span aria-hidden>—</span>
            <span className="sr-only">{t.lbBdUnchanged}</span>
          </span>
        ) : (
          line.streak
        )}
      </TableCell>
      <TableCell className={cn(NUM, "text-(--text-secondary)")}>
        {signedPoints(line.running)}
      </TableCell>
    </TableRow>
  );
}

function LinesTable({
  lines,
  typeName,
}: {
  lines: BreakdownLine[];
  typeName: TypeName;
}) {
  const { t } = useI18n();
  const dateLabel = useDateLabel(true);
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.lbBdDate}</TableHead>
            <TableHead>{t.lbBdShift}</TableHead>
            <TableHead>{t.lbBdStatus}</TableHead>
            <TableHead>{t.lbBdUnit}</TableHead>
            <TableHead className="text-right">{t.lbBdBase}</TableHead>
            <TableHead className="text-right">{t.lbBdOnTime}</TableHead>
            <TableHead className="text-right">{t.lbBdSleep}</TableHead>
            <TableHead className="text-right">{t.lbBdBonus}</TableHead>
            <TableHead className="text-right text-(--text-primary)">
              {t.lbBdShiftPoints}
            </TableHead>
            <TableHead className="text-right">{t.lbStreak}</TableHead>
            <TableHead className="text-right">{t.lbBdRunning}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => (
            <LineRow
              key={`${line.date}-${line.shift ?? line.rosterCode}`}
              line={line}
              typeName={typeName}
              dateLabel={dateLabel}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Figure({
  label,
  value,
  lead,
  danger,
}: {
  label: string;
  value: React.ReactNode;
  lead?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-(--text-tertiary)">{label}</dt>
      <dd
        className={cn(
          "font-mono font-bold tabular-nums",
          lead ? "text-3xl" : "text-xl",
          danger && "text-(--badge-danger-text)"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Header({ data }: { data: OperatorBreakdown }) {
  const { t } = useI18n();
  const { employee } = data;
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <Avatar
            src={photoUrl(employee)}
            alt={employee.name}
            className="size-16 flex-none text-xl"
          >
            {initialsOf(employee.name)}
          </Avatar>
          <div>
            <p className="text-lg font-bold">{employee.name}</p>
            <p className="text-sm text-(--text-secondary)">
              <span className="font-mono">{employee.nik}</span>
              {employee.department ? ` · ${employee.department}` : null}
            </p>
            <Badge variant="info" className="mt-2">
              {data.unitType
                ? fmt(t.lbBdBoard, { name: data.unitType.name })
                : t.lbAllTypes}
            </Badge>
          </div>
        </div>
        <dl className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <Figure label={t.lbBdTotal} value={signedPoints(data.total)} lead />
          <Figure label={t.lbBdStreakNow} value={data.streak} />
          <Figure label={t.lbBdCounted} value={data.counted} />
          <Figure
            label={t.lbPenalty}
            value={signedPoints(data.penalty)}
            danger={data.penalty < 0}
          />
        </dl>
      </div>
    </Panel>
  );
}

/** The scheme beside the counts it produced for this person. */
function Legend({ lines }: { lines: BreakdownLine[] }) {
  const { t } = useI18n();
  const counts = kindCounts(lines);
  return (
    <Panel>
      <SectionTitle>{t.lbBdLegend}</SectionTitle>
      <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {KIND_ORDER.map((kind) => (
          <li key={kind} className="flex items-start gap-3">
            <span className="w-8 flex-none pt-0.5 text-right font-mono text-lg font-bold tabular-nums">
              {counts[kind]}
            </span>
            <div className="flex flex-col items-start gap-1">
              <Badge variant={KIND_TONE[kind]} dot>
                {kindLabel(t, kind)}
              </Badge>
              <p className="text-xs text-(--text-secondary)">
                {kindRule(t, kind)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Breakdown({ data }: { data: OperatorBreakdown }) {
  const { t } = useI18n();
  const pg = usePagination(data.lines, "50");
  const typeName: TypeName = (id) =>
    data.unitTypes.find((u) => u.id === id)?.name ?? null;
  return (
    <>
      <Header data={data} />
      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.lbBdShifts}</ToolbarTitle>
        </Toolbar>
        <LinesTable lines={pg.rows} typeName={typeName} />
        {data.lines.length ? (
          <PanelFoot>
            <FootSum>
              <b>{pg.range}</b> / <b>{pg.total}</b> {t.lbBdLines}
            </FootSum>
            <Pagination
              page={pg.page}
              pageCount={pg.pageCount}
              onPage={pg.setPage}
              per={pg.per}
              perOptions={["50", "100", "200"]}
              onPer={pg.setPer}
            />
          </PanelFoot>
        ) : null}
      </Panel>
      <Legend lines={data.lines} />
    </>
  );
}

/** The route's search params as one `URLSearchParams`; a repeated key keeps
    its first value. */
function searchParamsOf(
  search: Record<string, string | string[] | undefined>
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) params.set(key, first);
  }
  return params;
}

/**
 * One operator's period on Peringkat Operator, shift by shift: what the
 * points the board shows are made of. Opened from the board's points with its
 * period, unit type and department in the address, so the total here is the
 * number that was clicked.
 *
 * Read-only, and the API scopes it as it scopes the board: somebody outside
 * the caller's department, or with nothing settled in the period, answers
 * not found.
 */
export function LeaderboardBreakdown({
  employeeId,
  search,
}: {
  employeeId: string;
  /** The page's search params, as the route received them. */
  search: Record<string, string | string[] | undefined>;
}) {
  const { t } = useI18n();
  const { access } = useRole();
  const router = useRouter();
  const filter = readBreakdownFilter(searchParamsOf(search));
  const dateLabel = useDateLabel(false);
  const allowed = access("leaderboard") !== undefined;
  const q = useQuery({
    ...leaderboardOperatorQueryOptions(employeeId, filter),
    enabled: allowed,
  });

  if (!allowed) notFound();

  /* The board keeps its filters in state, which a remount loses, so "back"
     is an address: the board this page was opened from, which it reads on
     opening. History would also leave the site for somebody who came in
     from a link. */
  const back = () => router.push(filter ? boardHref(filter) : "/leaderboard");
  const backButton = (
    <Button variant="secondary" onClick={back}>
      <ArrowLeft />
      {t.lbBdBack}
    </Button>
  );

  const body = (() => {
    if (q.isPending)
      return (
        <Panel>
          <TableSkeleton />
        </Panel>
      );
    if (q.isError) {
      const missing = isStatus(q.error, 404);
      return (
        <Panel>
          <StateBox
            icon={missing ? <Search /> : <TriangleAlert />}
            title={missing ? t.lbBdNotFoundT : t.lbBdLoadErr}
            body={
              missing ? t.lbBdNotFoundB : errorMessage(q.error, t.lbBdLoadErr)
            }
          />
        </Panel>
      );
    }
    return <Breakdown data={q.data} />;
  })();

  const sub = q.data
    ? fmt(t.lbBdSub, {
        from: dateLabel(q.data.from),
        to: dateLabel(q.data.to),
      })
    : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.lbBdTitle} sub={sub}>
        {backButton}
      </PageTitle>
      {body}
    </div>
  );
}
