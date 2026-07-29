"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Download, Eye, Search, Upload } from "lucide-react";

import type { RosterDocumentStatus } from "@universe/contracts";

import type { AccessMode } from "@/lib/access";
import { API_URL, errorMessage, fetchBlob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { masterQueryOptions } from "@/lib/queries/master";
import {
  rosterDocumentsQueryOptions,
  type RosterDocumentRow,
} from "@/lib/queries/roster";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
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
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { StateBox } from "@/components/ui/state-box";
import {
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

/** "2026-07-01" → "Juli 2026", the period an operator recognises. */
function monthLabel(month: string, lang: string): string {
  const [year, m] = [month.slice(0, 4), Number(month.slice(5, 7))];
  const name = new Date(Date.UTC(2026, m - 1, 1)).toLocaleDateString(
    lang === "en" ? "en-GB" : "id-ID",
    { month: "long", timeZone: "UTC" }
  );
  return `${name} ${year}`;
}

/** An upload's timestamp as a plain date, in the reader's locale. */
function dateLabel(iso: string, lang: string): string {
  return new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function RosterDataMenu({ mode }: { mode: AccessMode }) {
  const { t, lang } = useI18n();
  const { pushToast } = useToast();
  const router = useRouter();
  const base = `/roster-data`;
  const canW = mode === "manage";

  /* Every filter is sent to the API rather than applied to a loaded list: the
     search reaches the joined department and uploader names, which this side
     holds only as rendered text. */
  const [month, setMonth] = React.useState("");
  const [departmentId, setDepartmentId] = React.useState("");
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<RosterDocumentStatus | "">("");

  const documentsQ = useQuery(
    rosterDocumentsQueryOptions({
      ...(q.trim() ? { q: q.trim() } : {}),
      ...(departmentId ? { departmentId } : {}),
      ...(month ? { month } : {}),
      ...(status ? { status } : {}),
    })
  );
  const departmentsQ = useQuery(masterQueryOptions("departemen", true));

  const rows: RosterDocumentRow[] = React.useMemo(
    () => documentsQ.data ?? [],
    [documentsQ.data]
  );
  const pg = usePagination(rows);

  /**
   * The document as a spreadsheet, generated from the stored days.
   *
   * `fetchBlob` rather than Eden: Treaty decodes an unrecognised body as text,
   * and a workbook that survives that downloads and then refuses to open.
   */
  async function download(row: RosterDocumentRow) {
    try {
      const blob = await fetchBlob(`/v1/roster/${row.id}/export`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = row.fileName || `roster_${row.month.slice(0, 7)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      pushToast("success", t.rdDlT, row.fileName);
    } catch (error) {
      pushToast("error", t.rdDlErrT, errorMessage(error, t.rdLoadErr));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.navRD} sub={t.rdSub}>
        {canW ? (
          <Button onClick={() => router.push(`${base}/upload`)}>
            <Upload />
            {t.rdUpload}
          </Button>
        ) : null}
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.rdListTitle}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder={t.rdSearchPh}
              aria-label={t.rdSearchPh}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select
              aria-label={t.allDepts}
              wrapperClassName="w-[180px]"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">{t.allDepts}</option>
              {(departmentsQ.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t.allStatus}
              wrapperClassName="w-[170px]"
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as RosterDocumentStatus | "")
              }
            >
              <option value="">{t.allStatus}</option>
              <option value="aktif">{t.stAktif}</option>
              <option value="arsip">{t.stArsip}</option>
            </Select>
            {/* A month, not a month-of-year: a document is one month of one
                year, and a bare "July" filter would mix 2026 with 2027. */}
            <Input
              type="month"
              aria-label={t.lblMonth}
              className="w-[170px]"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </ToolbarGroup>
        </Toolbar>

        {documentsQ.isPending ? (
          <TableSkeleton rows={6} />
        ) : pg.rows.length ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>{t.thPeriod}</TableHead>
                <TableHead>{t.thDept}</TableHead>
                <TableHead className="max-xl:hidden">{t.thUploaded}</TableHead>
                <TableHead>{t.thEmpN}</TableHead>
                <TableHead>{t.thRows}</TableHead>
                <TableHead>{t.thStatus}</TableHead>
                <TableHead>{t.thAct}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <NameCell
                      name={monthLabel(r.month, lang)}
                      sub={r.fileName}
                    />
                  </TableCell>
                  <TableCell>{r.departmentName}</TableCell>
                  <TableCell className="max-xl:hidden">
                    <NameCell
                      name={
                        <span className="font-medium">{r.uploadedByName}</span>
                      }
                      sub={dateLabel(r.createdAt, lang)}
                    />
                  </TableCell>
                  <TableCell className="font-mono">{r.employeeCount}</TableCell>
                  <TableCell className="font-mono">{r.dayCount}</TableCell>
                  <TableCell>
                    <Badge
                      variant={r.status === "aktif" ? "success" : "neutral"}
                      dot
                    >
                      {r.status === "aktif" ? t.stAktif : t.stArsip}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <IconButton
                        aria-label={t.rdDetail}
                        onClick={() => router.push(`${base}/detail?p=${r.id}`)}
                      >
                        <Eye />
                      </IconButton>
                      <IconButton
                        aria-label={t.rdDl}
                        onClick={() => void download(r)}
                      >
                        <Download />
                      </IconButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <StateBox
            icon={<Search className="text-(--color-primary-bright)" />}
            title={documentsQ.isError ? t.rdLoadErr : t.noResTitle}
            body={
              documentsQ.isError
                ? errorMessage(documentsQ.error, t.rdLoadErr)
                : q || departmentId || month || status
                  ? t.rdEmptyB
                  : t.rdEmptyNone
            }
          >
            {documentsQ.isError ? (
              <Button
                variant="secondary"
                className="mx-auto"
                onClick={() => void documentsQ.refetch()}
              >
                {t.rdRetry}
              </Button>
            ) : null}
          </StateBox>
        )}

        <PanelFoot>
          <FootSum>
            {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
            {t.rdSumB}
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

export { API_URL };
