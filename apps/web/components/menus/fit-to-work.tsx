"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Clock,
  Download,
  RefreshCcw,
  Search,
} from "lucide-react";

import type { AccessMode } from "@/lib/access";
import { errorMessage, fetchBlob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { ftwQueryOptions, syncFtw, type FtwRow } from "@/lib/queries/readiness";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pagination, usePagination } from "@/components/ui/pagination";
import {
  FootSum,
  Fresh,
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

import {
  FTW_CAT_BADGE as CAT_BADGE,
  ftwCatOf as catOf,
  daysAgo,
  ftwDecisionBadge as decisionBadge,
  isoDate,
  ftwSeverity as severity,
  ftwShiftLabel as shiftLabel,
  ftwSleepClass as sleepClass,
  ftwSleepText as sleepText,
  ftwUploadShift as uploadShift,
  ftwUploadShiftNow as uploadShiftNow,
  type FtwCatKey as CatKey,
} from "./fit-to-work-shared";

type Strip = "ok" | "bad" | "na";

const STRIP_CLS: Record<Strip, string> = {
  ok: "bg-[rgba(23,206,100,.75)]",
  bad: "bg-[rgba(233,155,42,.85)]",
  na: "bg-(--fill-hover-strong)",
};

const STRIP_DAYS = 7;

/** The API refuses ranges past 62 days, and the fetch runs six days wider
 *  than the visible range for the history strips: 55 + 6 + 1 = 62, exactly
 *  the cap. One more visible day and a maximal range would 422. */
const MAX_SPAN_DAYS = 55;

type SortKey = "date" | "sent" | "sleep";
type SortDir = "asc" | "desc";
type Sort = { key: SortKey; dir: SortDir } | null;

/**
 * Which way each column sorts on its first click.
 *
 * Not uniformly descending: for a date or an upload time the interesting end
 * is the latest, but for sleep it is the *shortest* — a column whose first
 * click showed the best-rested operators would need a second click every time
 * to answer the only question anyone asks of it.
 */
const FIRST_DIR: Record<SortKey, SortDir> = {
  date: "desc",
  sent: "desc",
  sleep: "asc",
};

/** Third click returns to the default order rather than sticking. */
const nextSort = (current: Sort, key: SortKey): Sort => {
  if (!current || current.key !== key) return { key, dir: FIRST_DIR[key] };
  if (current.dir === FIRST_DIR[key])
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return null;
};

function SortHead({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: React.ReactNode;
  sortKey: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort?.key === sortKey ? sort.dir : null;
  return (
    <TableHead
      className={className}
      aria-sort={
        active ? (active === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex cursor-pointer items-center gap-1.5 uppercase hover:text-(--color-primary-bright)"
      >
        {label}
        {active === "asc" ? (
          <ChevronUp className="size-3.5" />
        ) : active === "desc" ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronsUpDown className="size-3.5 text-(--text-tertiary)" />
        )}
      </button>
    </TableHead>
  );
}

export function FitToWorkMenu({ mode }: { mode: AccessMode }) {
  const { t, lang } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const today = isoDate(new Date());
  const [q, setQ] = React.useState("");
  const [cat, setCat] = React.useState("");
  /* Opens on the half of the day it is opened in (owner, 2026-08-30) —
     before noon shows the morning's uploads, after noon the afternoon's.
     Read once on mount: the filter is where you arrive, not something that
     should move under you while you read it. */
  const [shift, setShift] = React.useState(String(uploadShiftNow()));
  const [company, setCompany] = React.useState("");
  const [sort, setSort] = React.useState<Sort>(null);
  const [dept, setDept] = React.useState("");
  /* Today only (owner, 2026-08-30). The screen is read to act on this
     morning; a week of history is a question you go and ask, not the one you
     arrive with — and 353 rows a day means the default range decided whether
     anything on screen was actionable. The history strip still reaches back a
     week, because it is fetched wider than the visible range. */
  const [d1, setD1] = React.useState(today);
  const [d2, setD2] = React.useState(today);

  const spanOk =
    d1 <= d2 &&
    (Date.parse(`${d2}T00:00:00Z`) - Date.parse(`${d1}T00:00:00Z`)) /
      86_400_000 <=
      MAX_SPAN_DAYS;

  // Fetched wider than shown: the history strip needs the week before each
  // visible day, and one fetch answers both.
  const fetchFrom = daysAgo(d1, STRIP_DAYS - 1);
  const listQ = useQuery({
    ...ftwQueryOptions(fetchFrom, d2),
    enabled: spanOk,
  });

  const sync = useMutation({
    mutationFn: syncFtw,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["fit-to-work"] });
      /* The count that answers "did my sync find anything": every pass
         upserts the whole window, so `upserted` is near-constant and a sync
         that pulled thirty late uploads used to look like one that pulled
         nothing. */
      pushToast(
        "success",
        t.refreshDoneT,
        result.inserted
          ? `${result.inserted} ${t.ftwSyncNew} · ${result.upserted} ${t.ftwSyncSeen}`
          : `${t.ftwSyncNone} · ${result.upserted} ${t.ftwSyncSeen}`
      );
    },
    onError: (error) =>
      pushToast("error", t.navFtw, errorMessage(error, t.ftwLoadErr)),
  });

  const [exporting, setExporting] = React.useState(false);

  /**
   * Exports what is on screen, not what is in the table.
   *
   * Every active filter travels with the request — an export that quietly
   * ignored them would hand someone the whole range when they had narrowed to
   * nine names, and they would not find out until they opened the file.
   */
  async function exportSheet() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ from: d1, to: d2 });
      if (company) params.set("company", company);
      if (dept) params.set("department", dept);
      if (shift) params.set("shift", shift);
      if (cat) params.set("category", cat);
      if (q.trim()) params.set("q", q.trim());
      // fetchBlob, not Eden — Treaty decodes an unrecognised body as text and
      // mangles the workbook past recovery (lib/api.ts).
      const blob = await fetchBlob(`/v1/fit-to-work/export?${params}`);
      const url = URL.createObjectURL(blob);
      const name = `ftw-${d1}${d1 === d2 ? "" : `-sd-${d2}`}.xlsx`;
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      pushToast("success", t.toastExportT, `${name} · ${rows.length} baris`);
    } catch (error) {
      pushToast(
        "error",
        t.toastExportT,
        error instanceof Error ? error.message : t.ftwLoadErr
      );
    } finally {
      setExporting(false);
    }
  }

  const all = React.useMemo(() => listQ.data?.rows ?? [], [listQ.data]);

  // nik+date → group, for the strips.
  const catByNikDate = React.useMemo(() => {
    const map = new Map<string, CatKey>();
    for (const row of all)
      map.set(`${row.nik} ${row.date}`, catOf(row.sleepCategory));
    return map;
  }, [all]);

  /* Options come from the rows, not from the master catalogue: these columns
     are savera's own text, and offering a department that never appears in the
     data would be a filter that can only ever return nothing. */
  const companyOptions = React.useMemo(
    () =>
      [...new Set(all.flatMap((r) => (r.company ? [r.company] : [])))].sort(),
    [all]
  );
  /* Narrowed by the chosen company, the way a department belongs to one. */
  const deptOptions = React.useMemo(
    () =>
      [
        ...new Set(
          all
            .filter((r) => !company || r.company === company)
            .flatMap((r) => (r.department ? [r.department] : []))
        ),
      ].sort(),
    [all, company]
  );

  const needle = q.trim().toLowerCase();

  /* Every filter but the shift one, so an empty table can tell the two
     emptinesses apart: "nothing matches what you asked for" and "this half of
     the day has no uploads yet" send a supervisor to different places. */
  const exceptShift = all.filter((r) => {
    if (r.date < d1) return false; // strip context, not a visible day
    if (company && r.company !== company) return false;
    if (dept && r.department !== dept) return false;
    if (cat === "late" ? !r.late : cat && catOf(r.sleepCategory) !== cat)
      return false;
    if (!needle) return true;
    return r.name.toLowerCase().includes(needle) || r.nik.includes(needle);
  });

  const rows = exceptShift
    .filter((r) => !shift || String(uploadShift(r.sentAt) ?? "") === shift)
    /*
     * Default: newest day first, then worst first inside it. Date leads
     * because the screen is operational — a refusal from six days ago must not
     * sit above this morning's — and severity decides the order of the day you
     * are actually looking at.
     *
     * A chosen column replaces that ordering rather than layering on top of
     * it: a sort that silently kept severity above the column you clicked
     * would look broken. Name still breaks ties, so the order is total and a
     * re-render never reshuffles equal rows.
     */
    .sort((a, b) => {
      if (!sort)
        return (
          b.date.localeCompare(a.date) ||
          severity(a.sleepCategory, a.late) -
            severity(b.sleepCategory, b.late) ||
          a.name.localeCompare(b.name)
        );
      const dir = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "sleep")
        return (
          (a.sleepMinutes - b.sleepMinutes) * dir ||
          a.name.localeCompare(b.name)
        );
      if (sort.key === "date")
        return (
          a.date.localeCompare(b.date) * dir || a.name.localeCompare(b.name)
        );
      // Rows with no upload time have nothing to sort by, so they sit at the
      // end whichever way the column points rather than crowding the top.
      if (!a.sentAt || !b.sentAt)
        return a.sentAt ? -1 : b.sentAt ? 1 : a.name.localeCompare(b.name);
      return (
        a.sentAt.localeCompare(b.sentAt) * dir || a.name.localeCompare(b.name)
      );
    });
  const pg = usePagination(rows);

  const loc = lang === "en" ? "en-GB" : "id-ID";
  const dLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(loc, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  const syncedLabel = listQ.data?.lastSyncedAt
    ? new Date(listQ.data.lastSyncedAt).toLocaleTimeString(loc, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  const stripOf = (row: FtwRow): Strip[] =>
    Array.from({ length: STRIP_DAYS }, (_, i) => {
      const day = daysAgo(row.date, STRIP_DAYS - 1 - i);
      const dayCat = catByNikDate.get(`${row.nik} ${day}`);
      return dayCat === undefined ? "na" : dayCat === "fit" ? "ok" : "bad";
    });

  const catLabel: Record<CatKey, string> = {
    fit: t.bFit,
    istirahat: t.ftwStatKurang,
    tidak: "Tidak Boleh Bekerja",
    belum: t.ftwStatBelum,
  };

  return (
    <div className="flex flex-col gap-6">
      {/* The sync sits above the freshness line it governs: pressing it is
          what moves that clock, and it belongs beside the number it changes
          rather than buried among the filters, which change nothing. */}
      <PageTitle title={t.navFtw} sub={t.ftwSub}>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {/* Export sits beside Sync, not among the filters: both act on the
                data as a whole, while a filter only changes the view. */}
            <Button
              variant="secondary"
              onClick={exportSheet}
              disabled={exporting || !rows.length}
            >
              <Download />
              {t.export}
            </Button>
            {mode === "manage" ? (
              <Button
                variant="secondary"
                onClick={() => sync.mutate()}
                disabled={sync.isPending}
              >
                <RefreshCcw className={cn(sync.isPending && "animate-spin")} />
                {t.ftwSync}
              </Button>
            ) : null}
          </div>
          <Fresh>
            {t.dataAsOf}&nbsp;
            <b className="font-mono text-(--text-secondary)">{syncedLabel}</b>
          </Fresh>
        </div>
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.ftwLog}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder={t.searchOp}
              aria-label={t.searchOp}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select
              wrapperClassName="w-[190px]"
              value={cat}
              onChange={(e) => setCat(e.target.value)}
              aria-label={t.allStatus}
            >
              <option value="">{t.allStatus}</option>
              {(Object.keys(catLabel) as CatKey[]).map((key) => (
                <option key={key} value={key}>
                  {catLabel[key]}
                </option>
              ))}
              {/* Not a sleep category — an administrative state, and the one
                  a supervisor comes to this screen to act on. */}
              <option value="late">{t.ftwStatLate}</option>
            </Select>
            {/* Only when there is a choice to make: one company on site is the
                common case, and a select with a single option is furniture. */}
            {companyOptions.length > 1 ? (
              <Select
                wrapperClassName="w-[200px]"
                value={company}
                onChange={(e) => {
                  setCompany(e.target.value);
                  // The chosen department may not exist under the new company.
                  setDept("");
                }}
                aria-label={t.allCompanies}
              >
                <option value="">{t.allCompanies}</option>
                {companyOptions.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            ) : null}
            <Select
              wrapperClassName="w-[200px]"
              value={dept}
              onChange={(e) => setDept(e.target.value)}
              aria-label={t.allDepts}
            >
              <option value="">{t.allDepts}</option>
              {deptOptions.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </Select>
            <Select
              wrapperClassName="w-[210px]"
              value={shift}
              onChange={(e) => setShift(e.target.value)}
              aria-label={t.allShift}
            >
              <option value="">{t.allShift}</option>
              {/* Fixed halves of the day rather than whatever savera wrote:
                  the value is derived from the upload time, so the two options
                  always exist and always mean the same thing. */}
              <option value="1">{t.ftwShift1}</option>
              <option value="2">{t.ftwShift2}</option>
            </Select>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                className="w-40 font-mono"
                value={d1}
                onChange={(e) => setD1(e.target.value)}
                aria-label={t.lblDate}
              />
              <span className="text-(--text-tertiary)">—</span>
              <Input
                type="date"
                className="w-40 font-mono"
                value={d2}
                onChange={(e) => setD2(e.target.value)}
                aria-label={t.lblDateTo}
              />
            </div>
          </ToolbarGroup>
        </Toolbar>

        {listQ.isPending && spanOk ? (
          <TableSkeleton rows={8} />
        ) : listQ.isError ? (
          <StateBox
            icon={<Search className="text-(--color-primary-bright)" />}
            title={t.ftwLoadErr}
            body={errorMessage(listQ.error, t.ftwLoadErr)}
          />
        ) : pg.rows.length ? (
          <div className="overflow-x-auto">
            <Table className="min-w-[1440px]">
              <TableHeader>
                <tr>
                  <TableHead>{t.thOperator}</TableHead>
                  <TableHead>NIK</TableHead>
                  <TableHead>{t.thCompany}</TableHead>
                  <TableHead>{t.thDept}</TableHead>
                  <TableHead>{t.thPos}</TableHead>
                  <TableHead>Mess</TableHead>
                  <TableHead>{t.thShift}</TableHead>
                  <SortHead
                    label={t.thSleep}
                    sortKey="sleep"
                    sort={sort}
                    onSort={(k) => setSort((cur) => nextSort(cur, k))}
                  />
                  <TableHead>{t.thStatus}</TableHead>
                  <TableHead>FTW</TableHead>
                  <SortHead
                    label={t.lblDate}
                    sortKey="date"
                    sort={sort}
                    onSort={(k) => setSort((cur) => nextSort(cur, k))}
                  />
                  <SortHead
                    label={t.thSendTime}
                    sortKey="sent"
                    sort={sort}
                    onSort={(k) => setSort((cur) => nextSort(cur, k))}
                  />
                  <TableHead>{t.thHist}</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {pg.rows.map((r) => {
                  const rowCat = catOf(r.sleepCategory);
                  const strip = stripOf(r);
                  const bad = strip.filter((s) => s === "bad").length;
                  return (
                    <TableRow key={`${r.nik}-${r.date}`}>
                      <TableCell className="font-semibold">{r.name}</TableCell>
                      <TableCell className="font-mono text-(--text-secondary) tabular-nums">
                        {r.nik}
                      </TableCell>
                      <TableCell>{r.company ?? "—"}</TableCell>
                      <TableCell>{r.department ?? "—"}</TableCell>
                      <TableCell>{r.position ?? "—"}</TableCell>
                      <TableCell>{r.mess ?? "—"}</TableCell>
                      <TableCell>{shiftLabel(r.sentAt)}</TableCell>
                      <TableCell className={sleepClass(rowCat)}>
                        {sleepText(r.sleepMinutes)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={CAT_BADGE[rowCat]} dot>
                          {r.sleepCategory ?? t.ftwStatBelum}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {r.ftwDecision ? (
                          <Badge variant={decisionBadge(r.ftwDecision)}>
                            {r.ftwDecision}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="font-mono whitespace-nowrap">
                        {dLabel(r.date)}
                      </TableCell>
                      {/* The upload time is where lateness is legible, so the
                          flag sits on it rather than in a column of its own. */}
                      <TableCell className="font-mono whitespace-nowrap">
                        {r.sentAt ? (
                          r.late ? (
                            <Badge variant="warning" dot>
                              {r.sentAt.slice(11, 16)}
                            </Badge>
                          ) : (
                            r.sentAt.slice(11, 16)
                          )
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {strip.map((s, i) => (
                            <i
                              key={i}
                              className={cn(
                                "size-2.5 flex-none rounded-[3px]",
                                STRIP_CLS[s]
                              )}
                            />
                          ))}
                          <span className="ml-1.5 text-xs text-(--text-tertiary)">
                            {bad === 0 ? t.histStable : `${bad}${t.histBad}`}
                          </span>
                        </div>
                        <Link
                          href={`/fit-to-work/history?nik=${r.nik}`}
                          className="mt-1 inline-block text-xs"
                        >
                          {t.ftwSeeAll}
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : shift && exceptShift.length ? (
          /* The shift filter is what emptied the table, and it was chosen by
             the clock rather than by the reader — so the screen says so and
             offers the way out, instead of looking like missing data. */
          <StateBox
            icon={<Clock className="text-(--color-primary-bright)" />}
            title={shift === "1" ? t.ftwNoShift1T : t.ftwNoShift2T}
            body={t.ftwNoShiftB}
          >
            <Button variant="secondary" onClick={() => setShift("")}>
              {t.ftwShowAllShifts} ({exceptShift.length})
            </Button>
          </StateBox>
        ) : (
          <StateBox
            icon={<Search className="text-(--color-primary-bright)" />}
            title={t.noResTitle}
            body={t.ftwEmptyB}
          />
        )}

        <PanelFoot>
          <FootSum>
            {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
            {t.ftwSumLogs}
          </FootSum>
          <Pagination
            page={pg.page}
            pageCount={pg.pageCount}
            onPage={pg.setPage}
            per={pg.per}
            perOptions={["10", "25", "50"]}
            onPer={pg.setPer}
          />
        </PanelFoot>
      </Panel>
    </div>
  );
}
