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
  NameCell,
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
 * One row per shift the morning is accountable for: every IN tap, plus every
 * rostered `D`/`N` that nobody tapped for.
 *
 * The second half is the point. Driven by taps alone, a scheduled operator who
 * never tapped had no row at all — invisible on the one screen whose job is to
 * notice them. Check-out is not shown: it was only ever here because a reading
 * is keyed by (nik, date), so a night shift's 06:00 checkout arrived as a row
 * with no arrival and needed explaining away.
 *
 * What a tap *means* against a shift (unfit, spare, replaced) still needs the
 * allocation engine and arrives with the Actual tab — this screen does not
 * guess. It reports two contradictions and stops there: scheduled and absent,
 * or present and not scheduled.
 */

const isoDate = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const MAX_SPAN_DAYS = 62;

/**
 * The shift the screen opens on, read off the wall clock at noon — the same
 * boundary the IN tap itself is split at. Open it in the morning and you are
 * looking at the day shift that has just started; open it in the afternoon and
 * you are looking at the night shift that is about to.
 *
 * Only the *starting* value. Nothing re-runs it, so a board left open across
 * noon keeps whatever the operator last chose instead of changing under them.
 */
const shiftNow = (): "D" | "N" => (new Date().getHours() < 12 ? "D" : "N");

/** "YYYY-MM-DD HH:MM:SS" → "HH:MM", for the in/out cells. */
const clock = (at: string | null) => (at ? at.slice(11, 16) : undefined);

type SortKey = "date" | "in";
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
  rosterCode: string | null;
};

/**
 * Tapped in on a day the roster does not schedule — the highlighted anomaly.
 *
 * A null `rosterCode` is deliberately not one: two thirds of the taps come
 * from NIKs we hold no roster for and never will, and flagging them would
 * report a gap in our own records as though it were their contradiction.
 */
const isMismatch = (r: AttRow): boolean =>
  !!r.firstInAt &&
  r.rosterCode !== null &&
  r.rosterCode !== "D" &&
  r.rosterCode !== "N";

/**
 * Reading order: worst first (owner, 2026-08-30).
 *
 *   no tap → late → roster mismatch → unknowable → on time
 *
 * A rostered shift with no tap leads, because it is the only row here that can
 * leave a unit without an operator at 05:30. That reverses the previous
 * ordering, which sorted every row without an IN tap to the bottom — correct
 * then, when 410 of them were the night shift going home and no fault of
 * anyone's. Those rows no longer exist, and what is left in that bucket is
 * exactly the fault the old one was hiding.
 *
 * "Unknowable" sits between the anomalies and a clean tap: the NIK matches no
 * employee here, so we cannot fault them — but nor have we cleared them, and
 * ranking it with "on time" would quietly assert we had.
 */
const severity = (r: AttRow): number =>
  !r.firstInAt
    ? 0
    : r.late === true
      ? 1
      : isMismatch(r)
        ? 2
        : r.late === null
          ? 3
          : 4;

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
  /* Only D and N are offered. The other twenty-seven codes describe why
     somebody is *not* on shift, and a screen about who turned up this morning
     has no question they answer. Opens on the shift in progress rather than on
     everything: both shifts at once is a report, and this is a board. */
  const [rosterF, setRosterF] = React.useState<string>(shiftNow);
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
      if (rosterF && r.rosterCode !== rosterF) return false;
      if (statusF === "late" && r.late !== true) return false;
      if (statusF === "no-tap" && r.firstInAt) return false;
      if (statusF === "mismatch" && !isMismatch(r)) return false;
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
      const av = a.firstInAt;
      const bv = b.firstInAt;
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
      if (rosterF) params.set("roster", rosterF);
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
        {/* Two rows, because five filters and a search box no longer fit on
            one. The search keeps the title's line — it is the one control you
            reach for without having decided anything yet — and the filters
            that narrow the set sit together below it, in the order they are
            usually decided: which morning, whose department, which shift,
            what went wrong. */}
        <Toolbar className="mb-3">
          <ToolbarTitle>{t.attLog}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder={t.searchEmp}
              aria-label={t.searchEmp}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </ToolbarGroup>
        </Toolbar>

        <ToolbarGroup className="mb-5 justify-start">
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
            aria-label={t.allRoster}
            wrapperClassName="w-[150px]"
            value={rosterF}
            onChange={(e) => setRosterF(e.target.value)}
          >
            <option value="">{t.allRoster}</option>
            <option value="D">{`D — ${t.rcD}`}</option>
            <option value="N">{`N — ${t.rcN}`}</option>
          </Select>
          <Select
            aria-label={t.allStatus}
            wrapperClassName="w-[170px]"
            value={statusF}
            onChange={(e) => setStatusF(e.target.value)}
          >
            <option value="">{t.allStatus}</option>
            <option value="no-tap">{t.attNoTap}</option>
            <option value="mismatch">{t.attMismatch}</option>
            <option value="late">{t.attLate}</option>
            <option value="on-time">{t.attOnTime}</option>
          </Select>
          {/* Last, and only when there is a choice: one company on site is the
              usual case, and a select with a single option is furniture. It
              sits after the four that are always here so their order stays
              the same on the sites where it does appear. */}
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
        </ToolbarGroup>

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
                <SortHead
                  label={t.lblDate}
                  sortKey="date"
                  sort={sort}
                  onSort={(k) => setSort((cur) => nextSort(cur, k))}
                />
                <TableHead className="max-xl:hidden">{t.thDept}</TableHead>
                <TableHead className="max-lg:hidden">{t.thPos}</TableHead>
                <TableHead>{t.thRoster}</TableHead>
                <SortHead
                  label={t.thIn}
                  sortKey="in"
                  sort={sort}
                  onSort={(k) => setSort((cur) => nextSort(cur, k))}
                />
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((r) => (
                <TableRow
                  key={`${r.nik}-${r.date}`}
                  /* The contradiction is between two cells, so the tint sits on
                     the row that holds both rather than on either one. Faint —
                     it marks the row for a second look, and the badges say
                     which way to look. */
                  className={cn(isMismatch(r) && "bg-[rgba(255,159,10,.07)]")}
                >
                  {/* Name over NIK in one cell, as everywhere else a person is
                      listed: the NIK is how you confirm you have the right
                      person, not a column anybody scans on its own. It carries
                      the row when the name does not — an unknown NIK still
                      identifies the tap. */}
                  <TableCell
                    className={cn(!r.name && "text-(--text-tertiary)")}
                  >
                    <NameCell name={r.name ?? "—"} sub={r.nik} />
                  </TableCell>
                  <TableCell className="font-mono whitespace-nowrap">
                    {dLabel(r.date)}
                  </TableCell>
                  <TableCell className="max-xl:hidden">
                    {r.department ?? "—"}
                  </TableCell>
                  <TableCell className="max-lg:hidden">
                    {r.position ?? "—"}
                  </TableCell>
                  <TableCell>
                    {/* Amber on a mismatch, and only when we actually hold a
                        roster for them: a dash means we have nothing to
                        contradict, which is our gap, not their anomaly. */}
                    <Badge
                      variant={isMismatch(r) ? "warning" : "info"}
                      dot={isMismatch(r)}
                    >
                      {r.rosterCode ?? "–"}
                    </Badge>
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
                    ) : (
                      /* Rostered for a shift and never seen. Red, because this
                         is the row that can leave a unit without an operator. */
                      <Badge variant="danger" dot>
                        {t.attNoTap}
                      </Badge>
                    )}
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
