"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, Search } from "lucide-react";

import { ROSTER_CODE_KIND, type RosterCode } from "@universe/contracts";

import { errorMessage, fetchBlob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  rosterDaysQueryOptions,
  rosterDocumentQueryOptions,
} from "@/lib/queries/roster";
import { rosterCodeColor, rosterCodeLabel } from "@/lib/roster-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import {
  FootSum,
  PageTitle,
  Panel,
  PanelFoot,
  Toolbar,
  ToolbarGroup,
  ToolbarTitle,
} from "@/components/ui/panel";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
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
import { useToast } from "@/components/ui/toast";

import { RosterLegend } from "./roster-legend";

/** Every day of the month a `YYYY-MM-01` names, as `YYYY-MM-DD`. */
function monthDays(month: string): string[] {
  const start = new Date(`${month}T00:00:00Z`);
  const last = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)
  ).getUTCDate();
  return Array.from(
    { length: last },
    (_, i) => `${month.slice(0, 8)}${String(i + 1).padStart(2, "0")}`
  );
}

/**
 * The four figures a supervisor actually asks for, folded out of the tally.
 *
 * Folded here rather than sent as four more fields: `kind` is resolved from the
 * code and never stored (contracts D2), so deriving it on the way out is the
 * one way the grouping cannot disagree with the codes it groups. "Away" is
 * everything that is not a shift — off, leave, sick, training, assignment —
 * because to whoever is counting a morning, they are one thing: not here.
 */
function shiftTotals(summary: { code: string; count: number }[]) {
  let day = 0;
  let night = 0;
  let away = 0;
  for (const { code, count } of summary) {
    const kind = ROSTER_CODE_KIND[code as RosterCode];
    if (kind === "day") day += count;
    else if (kind === "night") night += count;
    else away += count;
  }
  return { day, night, away, scheduled: day + night };
}

/** One number and what it counts — the summary strip's unit. */
function Figure({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <b className="text-lg font-bold tabular-nums">{value}</b>
      <span className="text-xs text-(--text-secondary)">{label}</span>
    </span>
  );
}

/**
 * One document's grid (?p= is the document id).
 *
 * Paged by the API rather than by slicing a loaded month (API design D8): a
 * month for a large department is tens of thousands of cells, so `page`,
 * `pageSize`, and the search are query-key members and every move is a request.
 * `keepPreviousData` is what stops the table blanking between pages.
 */
export function RosterDetail() {
  const { t, lang } = useI18n();
  const { pushToast } = useToast();
  const router = useRouter();
  const listHref = `/roster-data`;

  const id = useSearchParams().get("p") ?? "";

  const [q, setQ] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [per, setPer] = React.useState("25");

  /* A new search or a new page size is a new result set, so the page resets
     with them — done here rather than in an effect, which would render the old
     page once before correcting itself. */
  const search = (next: string) => {
    setQ(next);
    setPage(1);
  };
  const resize = (next: string) => {
    setPer(next);
    setPage(1);
  };
  /*
   * Picking a bound changes which people have a row at all, so the same reset
   * applies — page 4 of a month is rarely a page of one of its weeks.
   *
   * The other bound follows rather than being validated: dragging `from` past
   * `to` means the reader has moved on to a later span, and answering that
   * with an error message would be answering the wrong thing.
   */
  const pickFrom = (next: string) => {
    setFrom(next);
    if (next && to && next > to) setTo(next);
    setPage(1);
  };
  const pickTo = (next: string) => {
    setTo(next);
    if (next && from && next < from) setFrom(next);
    setPage(1);
  };

  const documentQ = useQuery({
    ...rosterDocumentQueryOptions(id),
    enabled: Boolean(id),
  });
  const gridQ = useQuery({
    ...rosterDaysQueryOptions(id, {
      page,
      pageSize: Number(per),
      ...(q.trim() ? { q: q.trim() } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    }),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
  });

  const doc = documentQ.data;
  const grid = gridQ.data;
  const total = grid?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / Number(per)));
  const range = total
    ? `${(page - 1) * Number(per) + 1}–${Math.min(total, page * Number(per))}`
    : "0";

  const days = doc ? monthDays(doc.month) : [];
  const totals = shiftTotals(grid?.summary ?? []);
  const dayLabel = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(
      lang === "en" ? "en-GB" : "id-ID",
      { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }
    );

  /*
   * What the tally is about, said the way the reader chose it.
   *
   * Read off `grid.days` rather than off the two selects: the server clamps
   * the bounds to the month, so the columns are the truth about what was
   * answered and the selects are only the request.
   */
  const shown = grid?.days ?? [];
  const spanLabel = !shown.length
    ? t.rdSumNone
    : shown.length === days.length
      ? t.rdSumMonth
      : shown.length === 1
        ? dayLabel(shown[0]!)
        : `${dayLabel(shown[0]!)} – ${dayLabel(shown[shown.length - 1]!)}`;

  const monthLabel = doc
    ? new Date(`${doc.month}T00:00:00Z`).toLocaleDateString(
        lang === "en" ? "en-GB" : "id-ID",
        { month: "long", year: "numeric", timeZone: "UTC" }
      )
    : "";

  async function download() {
    if (!doc) return;
    try {
      const blob = await fetchBlob(`/v1/roster/${doc.id}/export`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.fileName || `roster_${doc.month.slice(0, 7)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      pushToast("success", t.rdDlT, doc.fileName);
    } catch (error) {
      pushToast("error", t.rdDlErrT, errorMessage(error, t.rdLoadErr));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title={
          doc
            ? `${t.rdDetailTitle} — ${monthLabel} · ${doc.departmentName}`
            : t.rdDetailTitle
        }
        sub={t.rdDetailSub}
      >
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => router.push(listHref)}>
            <ArrowLeft />
            {t.upBack}
          </Button>
          <Button
            variant="secondary"
            disabled={!doc}
            onClick={() => void download()}
          >
            <Download />
            {t.rdDl}
          </Button>
        </div>
      </PageTitle>

      <Panel>
        <Toolbar className="mb-4">
          <ToolbarTitle>{doc?.fileName ?? "—"}</ToolbarTitle>
          <ToolbarGroup>
            {/* The document's own days, not free date fields: a month is the
                only range this grid has, and a picker that cannot leave it is
                a picker that cannot come back empty by accident. Both bounds
                are optional — one alone runs to the month's edge. */}
            <Select
              aria-label={t.rdFrom}
              wrapperClassName="w-[175px]"
              value={from}
              disabled={!doc}
              onChange={(e) => pickFrom(e.target.value)}
            >
              <option value="">{t.rdFromAny}</option>
              {days.map((d) => (
                <option key={d} value={d}>
                  {dayLabel(d)}
                </option>
              ))}
            </Select>
            <span className="text-xs text-(--text-tertiary)">{t.rdToSep}</span>
            <Select
              aria-label={t.rdTo}
              wrapperClassName="w-[175px]"
              value={to}
              disabled={!doc}
              onChange={(e) => pickTo(e.target.value)}
            >
              <option value="">{t.rdToAny}</option>
              {days.map((d) => (
                <option key={d} value={d}>
                  {dayLabel(d)}
                </option>
              ))}
            </Select>
            <SearchInput
              className="w-[240px]"
              placeholder={t.searchEmp}
              aria-label={t.searchEmp}
              value={q}
              onChange={(e) => search(e.target.value)}
            />
            {doc ? (
              <span className="text-xs text-(--text-tertiary)">
                {doc.employeeCount} {t.thEmpN.toLowerCase()} · {doc.dayCount}{" "}
                {t.thRows.toLowerCase()} ·{" "}
                {doc.uploadedByName ?? t.rdSourceMirror}
              </span>
            ) : null}
            {doc ? (
              <Badge
                variant={doc.status === "aktif" ? "success" : "neutral"}
                dot
              >
                {doc.status === "aktif" ? t.stAktif : t.stArsip}
              </Badge>
            ) : null}
          </ToolbarGroup>
        </Toolbar>

        {/*
          The tally, over the whole filtered set rather than the page below it.
          Four figures first because they are the question — how many are on
          today, how many on each shift, how many are not coming — then the raw
          codes, because "away" collapses seven different reasons and sometimes
          the reason is the point.
        */}
        {grid ? (
          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-card border border-(--divider) bg-(--fill-subtle) px-4 py-3">
            <span className="text-xs font-semibold tracking-[.05em] text-(--text-tertiary) uppercase">
              {t.rdSumTitle}
              {` · ${spanLabel}`}
            </span>
            <Figure label={t.rdSumScheduled} value={totals.scheduled} />
            <Figure label={t.rdSumDay} value={totals.day} />
            <Figure label={t.rdSumNight} value={totals.night} />
            <Figure label={t.rdSumAway} value={totals.away} />
            <div className="flex flex-wrap gap-1.5">
              {grid.summary.map((entry) => (
                <span
                  key={entry.code}
                  className="rounded-md border border-(--divider) bg-(--overlay-fill) px-2 py-1 font-mono text-[11px]"
                  style={{ color: rosterCodeColor(entry.code) }}
                  title={rosterCodeLabel(t, entry.code)}
                >
                  {entry.code}
                  <b className="ml-1.5 font-semibold text-(--text-primary) tabular-nums">
                    {entry.count}
                  </b>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {gridQ.isPending ? (
          <TableSkeleton rows={8} />
        ) : grid && grid.rows.length ? (
          <div className="overflow-x-auto pb-2">
            {/* A month needs the scroller; one day does not, and a table
                stretched to 1600px for a single column reads as broken. */}
            <Table
              className={grid.days.length > 3 ? "min-w-[1600px]" : undefined}
            >
              <TableHeader>
                <tr>
                  <TableHead className="w-[110px]">NIK</TableHead>
                  <TableHead className="w-[190px]">{t.thNama}</TableHead>
                  {grid.days.map((d) => (
                    <TableHead
                      key={d}
                      className="px-1.5 py-3 text-center font-mono"
                    >
                      {/* A month's header is a row of day numbers; a single
                          day gets the date it actually is. */}
                      {grid.days.length > 1 ? d.slice(8) : dayLabel(d)}
                    </TableHead>
                  ))}
                </tr>
              </TableHeader>
              <TableBody>
                {grid.rows.map((r) => (
                  <TableRow key={r.employeeId}>
                    <TableCell className="font-mono whitespace-nowrap">
                      {r.nik}
                    </TableCell>
                    <TableCell className="font-semibold whitespace-nowrap">
                      {r.name}
                    </TableCell>
                    {r.codes.map((c, i) => (
                      <TableCell
                        key={i}
                        className="px-1.5 py-3 text-center font-mono text-xs"
                        style={{ color: rosterCodeColor(c ?? "") }}
                      >
                        {c ?? "—"}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <StateBox
            icon={<Search className="text-(--color-primary-bright)" />}
            title={gridQ.isError ? t.rdLoadErr : t.noResTitle}
            body={
              gridQ.isError
                ? errorMessage(gridQ.error, t.rdLoadErr)
                : t.rdEmptyB
            }
          >
            {gridQ.isError ? (
              <Button
                variant="secondary"
                className="mx-auto"
                onClick={() => void gridQ.refetch()}
              >
                {t.rdRetry}
              </Button>
            ) : null}
          </StateBox>
        )}

        <PanelFoot>
          <FootSum>
            {t.rdSumA} <b>{range}</b> {t.rdOf} <b>{total}</b> {t.rdDetailFoot}
          </FootSum>
          <Pagination
            page={page}
            pageCount={pageCount}
            onPage={setPage}
            per={per}
            perOptions={["10", "25", "50"]}
            onPer={resize}
          />
        </PanelFoot>
      </Panel>

      <RosterLegend />
    </div>
  );
}
