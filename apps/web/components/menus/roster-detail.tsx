"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, Search } from "lucide-react";

import { errorMessage, fetchBlob } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  rosterDaysQueryOptions,
  rosterDocumentQueryOptions,
} from "@/lib/queries/roster";
import { rosterCodeColor } from "@/lib/roster-data";
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

  const documentQ = useQuery({
    ...rosterDocumentQueryOptions(id),
    enabled: Boolean(id),
  });
  const gridQ = useQuery({
    ...rosterDaysQueryOptions(id, {
      page,
      pageSize: Number(per),
      ...(q.trim() ? { q: q.trim() } : {}),
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
                {t.thRows.toLowerCase()} · {doc.uploadedByName}
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

        {gridQ.isPending ? (
          <TableSkeleton rows={8} />
        ) : grid && grid.rows.length ? (
          <div className="overflow-x-auto pb-2">
            <Table className="min-w-[1600px]">
              <TableHeader>
                <tr>
                  <TableHead className="w-[110px]">NIK</TableHead>
                  <TableHead className="w-[190px]">{t.thNama}</TableHead>
                  {grid.days.map((d) => (
                    <TableHead
                      key={d}
                      className="px-1.5 py-3 text-center font-mono"
                    >
                      {d.slice(8)}
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
