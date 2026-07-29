"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Plus, Search } from "lucide-react";

import type { RosterRevisionStatus } from "@universe/contracts";

import type { AccessMode } from "@/lib/access";
import { errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  rosterRevisionsQueryOptions,
  type RosterRevisionRow,
} from "@/lib/queries/roster";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogIcon,
  DialogTitle,
} from "@/components/ui/dialog";
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

const stBadge: Record<RosterRevisionStatus, BadgeVariant> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
};

/** A submission's statuses, deduplicated — one badge per distinct verdict. */
const statusesOf = (r: RosterRevisionRow): RosterRevisionStatus[] =>
  Array.from(new Set(r.items.map((i) => i.status)));

export function RosterRevisionMenu({ mode }: { mode: AccessMode }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const canW = mode === "manage";

  const [status, setStatus] = React.useState<RosterRevisionStatus | "">("");
  const [q, setQ] = React.useState("");
  const [detailId, setDetailId] = React.useState<string | null>(null);

  /* Filtered by the API, like every other list here: the search reaches the
     joined employee names, and the status filter is a predicate on the
     *entries* — a submission is shown when one of its entries matches. */
  const revisionsQ = useQuery(
    rosterRevisionsQueryOptions({
      ...(q.trim() ? { q: q.trim() } : {}),
      ...(status ? { status } : {}),
    })
  );

  const rows = React.useMemo(() => revisionsQ.data ?? [], [revisionsQ.data]);
  const pg = usePagination(rows);

  const stLabel = (s: RosterRevisionStatus) =>
    s === "pending"
      ? t.stPending
      : s === "approved"
        ? t.stApproved
        : t.stRejected;

  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  const pendingN = rows.reduce(
    (n, r) => n + r.items.filter((i) => i.status === "pending").length,
    0
  );
  const detail = detailId ? rows.find((r) => r.id === detailId) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.navR2} sub={t.revListSub}>
        {canW ? (
          <Button onClick={() => router.push(`/roster-revision/new`)}>
            <Plus />
            {t.revNewBtn}
          </Button>
        ) : null}
      </PageTitle>

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.rvListTitle}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder={t.searchEmp}
              aria-label={t.searchEmp}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select
              aria-label={t.allStatus}
              wrapperClassName="w-[170px]"
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as RosterRevisionStatus | "")
              }
            >
              <option value="">{t.allStatus}</option>
              <option value="pending">{t.stPending}</option>
              <option value="approved">{t.stApproved}</option>
              <option value="rejected">{t.stRejected}</option>
            </Select>
          </ToolbarGroup>
        </Toolbar>

        {revisionsQ.isPending ? (
          <TableSkeleton rows={6} />
        ) : pg.rows.length ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead className="w-[170px]">{t.thSubmission}</TableHead>
                <TableHead>{t.thEmp}</TableHead>
                <TableHead className="w-[150px] max-xl:hidden">
                  {t.thWhen}
                </TableHead>
                <TableHead className="w-[180px]">{t.thStatus}</TableHead>
                <TableHead className="w-[90px]">{t.thAct}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <NameCell
                      name={<span className="font-mono">{r.code}</span>}
                      sub={`${r.items.length} ${t.revCount}`}
                    />
                  </TableCell>
                  <TableCell className="max-w-[340px]">
                    {Array.from(
                      new Set(r.items.map((i) => i.employeeName))
                    ).join(", ")}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-(--text-secondary) max-xl:hidden">
                    {dateLabel(r.submittedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {/* A set, not one badge: entries of one submission are
                          decided independently (API design D10). */}
                      {statusesOf(r).map((s) => (
                        <Badge key={s} variant={stBadge[s]} dot>
                          {stLabel(s)}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setDetailId(r.id)}
                    >
                      {t.rvDetail}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <StateBox
            icon={<Search className="text-primary-bright" />}
            title={revisionsQ.isError ? t.rvLoadErr : t.noResTitle}
            body={
              revisionsQ.isError
                ? errorMessage(revisionsQ.error, t.rvLoadErr)
                : q || status
                  ? t.apEmptyB
                  : t.rvEmptyNone
            }
          >
            {revisionsQ.isError ? (
              <Button
                variant="secondary"
                className="mx-auto"
                onClick={() => void revisionsQ.refetch()}
              >
                {t.rdRetry}
              </Button>
            ) : null}
          </StateBox>
        )}

        <PanelFoot>
          <FootSum>
            {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
            {t.rvSumB} · <b>{pendingN}</b> {t.apSumC}
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

      <Dialog
        open={!!detail}
        onClose={() => setDetailId(null)}
        className="w-[min(620px,100%)]"
        labelledBy="rvd-t"
      >
        {detail ? (
          <>
            <DialogIcon variant="info">
              <CalendarDays />
            </DialogIcon>
            <DialogTitle id="rvd-t" className="font-mono">
              {detail.code}
            </DialogTitle>
            <DialogBody>
              {detail.items.length} {t.revCount} · {t.rvSubmittedBy}{" "}
              {detail.submittedByName} · {dateLabel(detail.submittedAt)}
            </DialogBody>
            <div className="mt-3 max-h-[50vh] overflow-y-auto">
              {detail.items.map((item) => (
                <div key={item.id} className="border-b border-(--divider) py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-sm">{item.employeeName}</b>
                    <span className="font-mono text-xs text-(--text-tertiary)">
                      {item.nik}
                    </span>
                    <Badge
                      variant={stBadge[item.status]}
                      dot
                      className="ml-auto"
                    >
                      {stLabel(item.status)}
                    </Badge>
                  </div>
                  <div className="mt-1 text-sm text-(--text-secondary)">
                    <span className="font-mono">{item.date}</span>:{" "}
                    <span className="font-mono">{item.fromCode}</span> →{" "}
                    <span className="font-mono">{item.toCode}</span>
                    {item.startTime
                      ? ` (${item.startTime}–${item.endTime ?? "…"})`
                      : ""}{" "}
                    — {item.reason}
                  </div>
                  <div className="mt-0.5 text-xs text-(--text-tertiary)">
                    {item.decidedByName
                      ? `${t.rvDecidedBy} ${item.decidedByName}${
                          item.decidedAt
                            ? ` · ${dateLabel(item.decidedAt)}`
                            : ""
                        }${item.decisionNote ? ` · ${item.decisionNote}` : ""}`
                      : dateLabel(detail.submittedAt)}
                  </div>
                </div>
              ))}
            </div>
            <DialogActions>
              <Button variant="secondary" onClick={() => setDetailId(null)}>
                {t.btnClose}
              </Button>
            </DialogActions>
          </>
        ) : null}
      </Dialog>
    </div>
  );
}
