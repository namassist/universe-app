"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  Fingerprint,
  HeartPulse,
  SearchX,
  TriangleAlert,
  Truck,
  UserX,
  type LucideIcon,
} from "lucide-react";

import {
  REPORT_COLUMNS,
  REPORT_DESCRIPTIONS,
  REPORT_KINDS,
  REPORT_LABELS,
  REPORT_NEEDS_BOARD,
  type ReportKind,
  type ShiftKind,
} from "@universe/contracts";

import { errorMessage, fetchBlob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  reportDepartmentsQueryOptions,
  reportParams,
  reportQueryOptions,
  type ReportFilter,
} from "@/lib/queries/reports";
import { cn } from "@/lib/utils";
import { useRole } from "@/components/providers/role-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pagination, usePagination } from "@/components/ui/pagination";
import {
  FootSum,
  PageTitle,
  Panel,
  PanelFoot,
  Toolbar,
  ToolbarGroup,
  ToolbarTitle,
} from "@/components/ui/panel";
import { Segmented, SegmentedButton } from "@/components/ui/segmented";
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

import { isoDate } from "./fit-to-work-shared";

const KIND_ICON: Record<ReportKind, LucideIcon> = {
  "equipment-no-operator": Truck,
  "operator-no-equipment": UserX,
  "operator-no-ftw": HeartPulse,
  "operator-no-finger": Fingerprint,
  "final-validation": ClipboardCheck,
};

/** The shift being mustered: Siang before noon, Malam after — as elsewhere. */
const shiftNow = (): ShiftKind =>
  new Date().getHours() < 12 ? "day" : "night";

/**
 * One report to choose. A button, not a link: choosing one keeps the date,
 * shift and department already set, which is how somebody walks the five
 * reports of one morning.
 */
function ReportCard({
  kind,
  active,
  onPick,
}: {
  kind: ReportKind;
  active: boolean;
  onPick: (kind: ReportKind) => void;
}) {
  const Icon = KIND_ICON[kind];
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onPick(kind)}
      className={cn(
        "flex cursor-pointer flex-col items-start gap-3 rounded-card p-5 text-left glass-card transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-[rgba(0,212,255,.45)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        active && "border-[rgba(0,212,255,.45)] bg-[rgba(0,212,255,.08)]"
      )}
    >
      <span
        className={cn(
          "grid size-11 place-items-center rounded-icon border border-(--divider) bg-(--fill-subtle) [&_svg]:size-5",
          active ? "text-primary-bright" : "text-(--text-secondary)"
        )}
      >
        <Icon />
      </span>
      <span className="text-sm font-semibold">{REPORT_LABELS[kind]}</span>
      <span className="text-xs leading-relaxed text-(--text-secondary)">
        {REPORT_DESCRIPTIONS[kind]}
      </span>
    </button>
  );
}

/**
 * The chosen report: its filters, its table, and its workbook.
 *
 * Renders the moment a date and shift are set — both have values from the
 * start (today, the shift being mustered), so choosing a card is enough to
 * read a report. Department opens on the whole site for a role that sees it,
 * and on its own for one scoped to a department; the API enforces the second
 * either way, and the select only says so.
 */
function ReportView({
  filter,
  setFilter,
}: {
  filter: ReportFilter;
  setFilter: (next: ReportFilter) => void;
}) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const { scope } = useRole();
  const [exporting, setExporting] = React.useState(false);

  const deptQ = useQuery(reportDepartmentsQueryOptions());
  const reportQ = useQuery(reportQueryOptions(filter));

  const columns = REPORT_COLUMNS[filter.kind];
  const rows = reportQ.data?.rows ?? [];
  const pg = usePagination(rows, "25");
  const noBoard =
    REPORT_NEEDS_BOARD[filter.kind] && reportQ.data?.boardGenerated === false;
  const siteWide = scope === "all";

  async function exportSheet() {
    setExporting(true);
    try {
      // fetchBlob, not Eden — Treaty decodes an unrecognised body as text and
      // mangles the workbook past recovery (lib/api.ts).
      const blob = await fetchBlob(
        `/v1/reports/${filter.kind}/export?${reportParams(filter)}`
      );
      const shift = filter.shift === "day" ? t.shiftDay : t.shiftNight;
      const name = `${filter.kind}-${filter.date}-${shift.toLowerCase()}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      pushToast(
        "success",
        t.toastExportT,
        `${name} · ${rows.length} ${t.rptRows}`
      );
    } catch (error) {
      pushToast(
        "error",
        t.toastExportT,
        error instanceof Error ? error.message : t.rptLoadErr
      );
    } finally {
      setExporting(false);
    }
  }

  const body = (() => {
    if (reportQ.isPending) return <TableSkeleton />;
    if (reportQ.isError)
      return (
        <StateBox
          icon={<TriangleAlert />}
          title={t.rptLoadErr}
          body={errorMessage(reportQ.error, t.rptLoadErr)}
        />
      );
    if (noBoard)
      return (
        <StateBox
          icon={<FileSpreadsheet />}
          title={t.rptNoBoardT}
          body={t.rptNoBoardB}
        />
      );
    if (!rows.length)
      return (
        <StateBox icon={<SearchX />} title={t.rptEmptyT} body={t.rptEmptyB} />
      );
    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14 text-center">No</TableHead>
              {columns.map((c) => (
                <TableHead key={c.key}>{c.header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pg.rows.map((row, i) => (
              <TableRow key={`${row.nik ?? row.unit}-${i}`}>
                <TableCell className="text-center font-mono text-(--text-secondary)">
                  {(pg.page - 1) * Number(pg.per) + i + 1}
                </TableCell>
                {columns.map((c) => (
                  <TableCell
                    key={c.key}
                    className={cn(
                      (c.key === "nik" || c.key === "jamIn") && "font-mono",
                      c.key === "unit" && "font-semibold"
                    )}
                  >
                    {row[c.key] || "—"}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  })();

  return (
    <Panel>
      <Toolbar>
        <ToolbarTitle>{REPORT_LABELS[filter.kind]}</ToolbarTitle>
        <ToolbarGroup>
          <Input
            type="date"
            className="w-40 font-mono"
            value={filter.date}
            onChange={(e) =>
              e.target.value && setFilter({ ...filter, date: e.target.value })
            }
            aria-label={t.lblDate}
          />
          <Select
            wrapperClassName="w-[220px]"
            value={filter.department}
            onChange={(e) =>
              setFilter({ ...filter, department: e.target.value })
            }
            disabled={!siteWide}
            aria-label={t.allDepts}
          >
            {siteWide ? <option value="">{t.allDepts}</option> : null}
            {(deptQ.data ?? []).map((d) => (
              <option key={d.id} value={siteWide ? d.id : ""}>
                {d.name} · {d.company}
              </option>
            ))}
          </Select>
          <Segmented role="group" aria-label={t.rptShift}>
            {(["day", "night"] as const).map((shift) => (
              <SegmentedButton
                key={shift}
                type="button"
                active={filter.shift === shift}
                aria-pressed={filter.shift === shift}
                onClick={() => setFilter({ ...filter, shift })}
              >
                {shift === "day" ? t.shiftDay : t.shiftNight}
              </SegmentedButton>
            ))}
          </Segmented>
          <Button
            onClick={exportSheet}
            disabled={exporting || reportQ.isPending || !rows.length}
          >
            <Download />
            {t.rptExport}
          </Button>
        </ToolbarGroup>
      </Toolbar>

      {filter.kind !== "equipment-no-operator" ? (
        <p className="mb-4 text-xs text-(--text-tertiary)">{t.rptNowNote}</p>
      ) : null}

      {body}

      {rows.length && !noBoard ? (
        <PanelFoot>
          <FootSum>
            <b>{pg.range}</b> / <b>{pg.total}</b> {t.rptRows}
          </FootSum>
          <Pagination
            page={pg.page}
            pageCount={pg.pageCount}
            onPage={pg.setPage}
            per={pg.per}
            perOptions={["25", "50", "100"]}
            onPer={pg.setPer}
          />
        </PanelFoot>
      ) : null}
    </Panel>
  );
}

/**
 * The Report menu: pick one of five reports, then read it for a date, shift
 * and department — or take it away as the site's template workbook.
 *
 * Read-only for every role that holds it, so it takes no access mode.
 */
export function ReportMenu() {
  const { t } = useI18n();
  const [kind, setKind] = React.useState<ReportKind | null>(null);
  const [filter, setFilter] = React.useState<Omit<ReportFilter, "kind">>(
    () => ({ date: isoDate(new Date()), shift: shiftNow(), department: "" })
  );

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title="Laporan" sub={t.rptSub} />

      <section aria-label={t.rptPick}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {REPORT_KINDS.map((k) => (
            <ReportCard key={k} kind={k} active={kind === k} onPick={setKind} />
          ))}
        </div>
      </section>

      {kind ? (
        <ReportView
          filter={{ ...filter, kind }}
          setFilter={({ kind: next, ...rest }) => {
            setKind(next);
            setFilter(rest);
          }}
        />
      ) : null}
    </div>
  );
}
