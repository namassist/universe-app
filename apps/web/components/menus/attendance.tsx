"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Download,
  RefreshCcw,
  Search,
} from "lucide-react";

import type { AccessMode } from "@/lib/access";
import { errorMessage, fetchBlob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { masterQueryOptions } from "@/lib/queries/master";
import {
  attendanceQueryOptions,
  syncAttendance,
} from "@/lib/queries/readiness";
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
  IOCell,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { useToast } from "@/components/ui/toast";

/**
 * The tap log as the machines recorded it: first IN and first OUT per person
 * per day, enriched with who the NIK is and what the roster says. What a tap
 * *means* against a shift (late, unfit, absent) needs the allocation engine
 * and arrives with the Actual tab — this screen does not guess.
 */

const isoDate = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const MAX_SPAN_DAYS = 62;

/** "YYYY-MM-DD HH:MM:SS" → "HH:MM", for the in/out cells. */
const clock = (at: string | null) => (at ? at.slice(11, 16) : undefined);

type SortKey = "date" | "in" | "out";
type SortDir = "asc" | "desc";
type Sort = { key: SortKey; dir: SortDir } | null;

/** Latest first on every column here — a tap's interesting end is the late one. */
const FIRST_DIR: SortDir = "desc";

const nextSort = (current: Sort, key: SortKey): Sort => {
  if (!current || current.key !== key) return { key, dir: FIRST_DIR };
  if (current.dir === FIRST_DIR) return { key, dir: "asc" };
  return null;
};

type AttRow = {
  firstInAt: string | null;
  late: boolean | null;
  checkoutOf: string | null;
};

/**
 * Reading order: worst first, among arrivals (owner, 2026-08-30).
 *
 *   tapped late → unknowable → on time → no check-in → night checkout
 *
 * This screen is about who arrived and when, so a row with no IN tap sorts
 * below every row that has one — including the missing-check-in case, which is
 * still a fault but not an arrival to compare against the gate. It keeps its
 * red badge and its own filter, so it is one click away.
 *
 * Nothing is hidden (owner, 2026-08-30). 410 of today's 1,200 rows are the
 * night shift going home and nobody has to act on them, but ordering is enough
 * to keep them out of the way — a filter that removes rows by default makes a
 * reader wonder what else the screen is not showing them.
 *
 * "Unknowable" sits between the fault and a clean tap: the NIK matches no
 * employee here, so we cannot fault them — but nor have we cleared them, and
 * ranking it with "on time" would quietly assert we had.
 */
const severity = (r: AttRow): number =>
  !r.firstInAt
    ? r.checkoutOf
      ? 4
      : 3
    : r.late === true
      ? 0
      : r.late === null
        ? 1
        : 2;

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

export function AttendanceMenu({ mode }: { mode: AccessMode }) {
  const { t, lang } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const today = isoDate(new Date());
  /* Today only: the screen is read to act on this morning, and a wider range
     is a question you go and ask rather than the one you arrive with. */
  const [from, setFrom] = React.useState(today);
  const [to, setTo] = React.useState(today);
  const [dept, setDept] = React.useState("");
  const [company, setCompany] = React.useState("");
  const [statusF, setStatusF] = React.useState("");
  const [q, setQ] = React.useState("");
  const [sort, setSort] = React.useState<Sort>(null);
  const [exporting, setExporting] = React.useState(false);

  const spanOk =
    from <= to &&
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000 <
      MAX_SPAN_DAYS;

  const deptsQ = useQuery(masterQueryOptions("departemen", true));
  const listQ = useQuery({
    ...attendanceQueryOptions(from, to),
    enabled: spanOk,
  });

  const sync = useMutation({
    mutationFn: syncAttendance,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
      /* What the sync actually found. Every pass upserts the whole window, so
         `upserted` is near-constant and a pull that brought thirty new taps
         looked identical to one that brought none. */
      pushToast(
        "success",
        t.refreshDoneT,
        result.inserted
          ? `${result.inserted} ${t.ftwSyncNew} · ${result.upserted} ${t.ftwSyncSeen}`
          : `${t.ftwSyncNone} · ${result.upserted} ${t.ftwSyncSeen}`
      );
    },
    onError: (error) =>
      pushToast("error", t.navR4, errorMessage(error, t.attLoadErr)),
  });

  // Memoized because `companyOptions` depends on it: a fresh array literal on
  // every render would rebuild that list on every keystroke in the search box.
  const all = React.useMemo(() => listQ.data?.rows ?? [], [listQ.data]);

  const needle = q.trim().toLowerCase();
  const rows = all
    .filter((r) => {
      if (dept && r.department !== dept) return false;
      if (company && r.company !== company) return false;
      if (statusF === "late" && r.late !== true) return false;
      if (statusF === "out-only" && !(!r.firstInAt && r.checkoutOf))
        return false;
      if (statusF === "missing-in" && !(!r.firstInAt && !r.checkoutOf))
        return false;
      if (statusF === "on-time" && r.late !== false) return false;
      if (!needle) return true;
      return (
        (r.name ?? "").toLowerCase().includes(needle) || r.nik.includes(needle)
      );
    })
    /* Newest day first, then worst first inside it — the same bargain the Fit
       To Work list strikes, for the same reason: a missed tap from six days
       ago must not sit above this morning's. A chosen column replaces that
       ordering rather than layering on top of it. */
    .sort((a, b) => {
      const byName = (a.name ?? "").localeCompare(b.name ?? "");
      if (!sort)
        return (
          b.date.localeCompare(a.date) || severity(a) - severity(b) || byName
        );
      const dir = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "date")
        return a.date.localeCompare(b.date) * dir || byName;
      const key = sort.key === "in" ? "firstInAt" : "firstOutAt";
      const av = a[key];
      const bv = b[key];
      // A row with no tap has nothing to sort by, so it sits at the end
      // whichever way the column points rather than crowding the top.
      if (!av || !bv) return av ? -1 : bv ? 1 : byName;
      return av.localeCompare(bv) * dir || byName;
    });
  const pg = usePagination(rows);

  const companyOptions = React.useMemo(
    () =>
      [...new Set(all.flatMap((r) => (r.company ? [r.company] : [])))].sort(),
    [all]
  );

  /**
   * Exports what is on screen, not what is in the table — every active filter
   * travels with the request.
   */
  async function exportSheet() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ from, to });
      if (company) params.set("company", company);
      if (dept) params.set("department", dept);
      if (statusF) params.set("status", statusF);
      if (q.trim()) params.set("q", q.trim());
      const blob = await fetchBlob(`/v1/attendance/export?${params}`);
      const url = URL.createObjectURL(blob);
      const name = `absensi-${from}${from === to ? "" : `-sd-${to}`}.xlsx`;
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
        error instanceof Error ? error.message : t.attLoadErr
      );
    } finally {
      setExporting(false);
    }
  }
  const presentN = rows.filter((r) => r.firstInAt).length;

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

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title={t.navR4}
        sub={
          <>
            {t.attSubA} {t.flowRevisi}
            {t.attSubB}
          </>
        }
      >
        <div className="flex flex-col items-end gap-2">
          {/* Both act on the data as a whole, and Sync is what moves the clock
              below it — a filter changes only the view. */}
          <div className="flex items-center gap-2">
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
          <ToolbarTitle>{t.attLog}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder={t.searchEmp}
              aria-label={t.searchEmp}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {/* Only when there is a choice: one company on site is the usual
                case, and a select with a single option is furniture. */}
            {companyOptions.length > 1 ? (
              <Select
                aria-label={t.allCompanies}
                wrapperClassName="w-[200px]"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              >
                <option value="">{t.allCompanies}</option>
                {companyOptions.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            ) : null}
            <Select
              aria-label={t.allDepts}
              wrapperClassName="w-[180px]"
              value={dept}
              onChange={(e) => setDept(e.target.value)}
            >
              <option value="">{t.allDepts}</option>
              {(deptsQ.data ?? []).map((d) => (
                <option key={d.id}>{d.name}</option>
              ))}
            </Select>
            <Select
              aria-label={t.allStatus}
              wrapperClassName="w-[170px]"
              value={statusF}
              onChange={(e) => setStatusF(e.target.value)}
            >
              <option value="">{t.allStatus}</option>
              <option value="missing-in">{t.attMissingIn}</option>
              <option value="out-only">{t.attOutOnly}</option>
              <option value="late">{t.attLate}</option>
              <option value="on-time">{t.attOnTime}</option>
            </Select>
            <div className="flex items-center gap-2">
              <label
                htmlFor="att-from"
                className="text-xs text-(--text-tertiary)"
              >
                {t.lblDate}
              </label>
              <Input
                id="att-from"
                type="date"
                className="w-[160px] font-mono"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <span className="text-(--text-tertiary)">–</span>
              <Input
                id="att-to"
                type="date"
                className="w-[160px] font-mono"
                aria-label={t.lblDateTo}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </ToolbarGroup>
        </Toolbar>

        {listQ.isPending && spanOk ? (
          <TableSkeleton rows={8} />
        ) : listQ.isError ? (
          <StateBox
            icon={<Search className="text-(--color-primary-bright)" />}
            title={t.attLoadErr}
            body={errorMessage(listQ.error, t.attLoadErr)}
          />
        ) : pg.rows.length ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>{t.thEmp}</TableHead>
                <TableHead>NIK</TableHead>
                <SortHead
                  label={t.lblDate}
                  sortKey="date"
                  sort={sort}
                  onSort={(k) => setSort((cur) => nextSort(cur, k))}
                />
                <TableHead className="max-xl:hidden">{t.thDept}</TableHead>
                <TableHead>{t.thRoster}</TableHead>
                <SortHead
                  label={t.thIn}
                  sortKey="in"
                  sort={sort}
                  onSort={(k) => setSort((cur) => nextSort(cur, k))}
                />
                <SortHead
                  label={t.thOut}
                  sortKey="out"
                  sort={sort}
                  onSort={(k) => setSort((cur) => nextSort(cur, k))}
                />
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((r) => (
                <TableRow key={`${r.nik}-${r.date}`}>
                  <TableCell
                    className={cn(
                      "font-semibold",
                      !r.name && "text-(--text-tertiary)"
                    )}
                  >
                    {r.name ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-(--text-secondary) tabular-nums">
                    {r.nik}
                  </TableCell>
                  <TableCell className="font-mono whitespace-nowrap">
                    {dLabel(r.date)}
                  </TableCell>
                  <TableCell className="max-xl:hidden">
                    {r.department ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="info">{r.rosterCode ?? "–"}</Badge>
                  </TableCell>
                  <TableCell>
                    {/* The flag sits on the tap time, where lateness is
                        legible, rather than in a column of its own. Amber, not
                        red: it is a fact for a supervisor to weigh, and the
                        board has already acted on it. */}
                    {r.late ? (
                      <span>
                        <Badge variant="warning" dot>
                          {clock(r.firstInAt)}
                        </Badge>
                        {/* The machine matters most on a late tap: it is the
                            first thing anyone checks when the time is
                            disputed. */}
                        {r.firstInMachine ? (
                          <span className="mt-0.5 block text-xs text-(--text-tertiary)">
                            {r.firstInMachine}
                          </span>
                        ) : null}
                      </span>
                    ) : r.firstInAt ? (
                      <IOCell
                        time={clock(r.firstInAt)}
                        machine={r.firstInMachine ?? undefined}
                      />
                    ) : r.checkoutOf ? (
                      /* Not a fault — the night shift going home, whose
                         checkout lands on the next date. */
                      <span className="text-xs text-(--text-tertiary)">
                        {t.attCheckoutOf} {r.checkoutOf}
                      </span>
                    ) : (
                      <Badge variant="danger" dot>
                        {t.attMissingIn}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <IOCell
                      time={clock(r.firstOutAt)}
                      machine={r.firstOutMachine ?? undefined}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <StateBox
            icon={<Search className="text-(--color-primary-bright)" />}
            title={t.noResTitle}
            body={t.attEmptyB}
          />
        )}

        <PanelFoot>
          <FootSum>
            {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
            {t.attSumLog} · <b>{presentN}</b> {t.attSumD}
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
