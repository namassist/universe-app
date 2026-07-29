"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, PenLine, TriangleAlert } from "lucide-react";

import type { RosterRevisionStatus } from "@universe/contracts";

import type { AccessMode } from "@/lib/access";
import { api, errorCode, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  rosterQueueQueryOptions,
  type RosterRevisionItemRow,
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
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
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
import { Segmented, SegmentedButton } from "@/components/ui/segmented";
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

type Filter = RosterRevisionStatus;

const stBadge: Record<RosterRevisionStatus, BadgeVariant> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
};

/**
 * The approval queue.
 *
 * Every decision is a request, and the answer is a refetch rather than a local
 * `setState` — which matters more here than on most screens, because approving
 * writes a roster day and two approvers can reach for the same entry. A stale
 * entry comes back 409 naming both codes (API design D10), and the queue is
 * reloaded so the operator sees what the day now says.
 */
export function RosterApprovalMenu({ mode }: { mode: AccessMode }) {
  const { t, lang } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const canW = mode === "manage";

  const [filter, setFilter] = React.useState<Filter>("pending");
  const [q, setQ] = React.useState("");
  const [noteFor, setNoteFor] = React.useState<RosterRevisionItemRow | null>(
    null
  );
  const [note, setNote] = React.useState("");
  const [noFor, setNoFor] = React.useState<RosterRevisionItemRow | null>(null);
  const [reason, setReason] = React.useState("");

  const queueQ = useQuery(
    rosterQueueQueryOptions({
      status: filter,
      ...(q.trim() ? { q: q.trim() } : {}),
    })
  );
  // Only the current segment is loaded, so the pending badge needs its own
  // count rather than being derived from the rows on screen.
  const pendingQ = useQuery(rosterQueueQueryOptions({ status: "pending" }));

  const rows = React.useMemo(() => queueQ.data ?? [], [queueQ.data]);
  const pg = usePagination(rows);
  const pendingN = pendingQ.data?.length ?? 0;

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

  const refresh = React.useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["roster-approval-queue"] }),
        queryClient.invalidateQueries({ queryKey: ["roster-revisions"] }),
        // Approving rewrote a roster day; anything reading the roster has to
        // hear about it, which is the whole point of deciding here.
        queryClient.invalidateQueries({ queryKey: ["roster-days"] }),
        queryClient.invalidateQueries({ queryKey: ["roster-in-force"] }),
      ]),
    [queryClient]
  );

  /** Both refusals worth naming: a day that moved, and a document that froze. */
  function reportFailure(error: unknown) {
    const code = errorCode(error);
    if (code === "stale_revision") {
      const value = (error as { value?: Record<string, unknown> }).value ?? {};
      pushToast(
        "error",
        t.apStaleT,
        `${String(value.recordedCode ?? "?")} → ${String(value.currentCode ?? "?")} · ${errorMessage(error, "")}`
      );
      return;
    }
    pushToast(
      "error",
      code === "document_archived" ? t.apFrozen : t.apDecideErrT,
      errorMessage(error, t.rvLoadErr)
    );
  }

  const approveM = useMutation({
    mutationFn: async (input: { id: string; note?: string }) => {
      const { data, error } = await api.v1["roster-revisions"]
        .items({ id: input.id })
        .approve.post({ note: input.note ?? "" });
      if (error) throw error;
      return data;
    },
    onSuccess: async (item) => {
      await refresh();
      pushToast(
        "success",
        t.toastOkT,
        `${item.employeeName} — ${item.date}: ${item.fromCode} → ${item.toCode}`
      );
    },
    // Refreshed on failure too: a 409 means this screen is showing something
    // that is no longer true, and leaving it up invites the same click again.
    onError: async (error) => {
      reportFailure(error);
      await refresh();
    },
  });

  const rejectM = useMutation({
    mutationFn: async (input: { id: string; reason: string }) => {
      const { data, error } = await api.v1["roster-revisions"]
        .items({ id: input.id })
        .reject.post({ reason: input.reason });
      if (error) throw error;
      return data;
    },
    onSuccess: async (item) => {
      await refresh();
      pushToast("info", t.toastNoT, `${item.employeeName} — ${t.toastNoD}`);
    },
    onError: async (error) => {
      reportFailure(error);
      await refresh();
    },
  });

  const busy = approveM.isPending || rejectM.isPending;

  const segs: { f: Filter; label: React.ReactNode }[] = [
    {
      f: "pending",
      label: (
        <>
          {t.segPending} <span className="font-mono">{pendingN}</span>
        </>
      ),
    },
    { f: "approved", label: t.segApproved },
    { f: "rejected", label: t.segRejected },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.apTitle} sub={t.apSub} />

      <Panel>
        <Toolbar>
          <ToolbarTitle>{t.apQueue}</ToolbarTitle>
          <ToolbarGroup>
            <SearchInput
              className="w-[240px]"
              placeholder={t.searchEmp}
              aria-label={t.searchEmp}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Segmented role="group" aria-label={t.allStatus}>
              {segs.map((s) => (
                <SegmentedButton
                  key={s.f}
                  active={filter === s.f}
                  onClick={() => setFilter(s.f)}
                >
                  {s.label}
                </SegmentedButton>
              ))}
            </Segmented>
          </ToolbarGroup>
        </Toolbar>

        {queueQ.isPending ? (
          <TableSkeleton rows={6} />
        ) : pg.rows.length ? (
          <Table>
            <TableHeader>
              <tr>
                <TableHead>{t.thEmp}</TableHead>
                <TableHead>NIK</TableHead>
                <TableHead>{t.thSubmission}</TableHead>
                <TableHead>{t.thWhen}</TableHead>
                <TableHead>{t.thStatus}</TableHead>
                <TableHead className="w-[330px]">{t.thAct}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {pg.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-semibold">
                    {r.employeeName}
                  </TableCell>
                  <TableCell className="font-mono text-(--text-secondary) tabular-nums">
                    {r.nik}
                  </TableCell>
                  <TableCell className="max-w-[360px]">
                    <span className="font-mono">{r.revisionCode}</span> ·{" "}
                    <span className="font-mono">{r.date}</span>:{" "}
                    <span className="font-mono">{r.fromCode}</span> →{" "}
                    <span className="font-mono">{r.toCode}</span>
                    {r.startTime ? ` (${r.startTime}–${r.endTime ?? "…"})` : ""}
                    <div className="mt-0.5 text-xs text-(--text-tertiary)">
                      {r.reason}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-(--text-secondary)">
                    {dateLabel(r.submittedAt)}
                    <div className="text-xs text-(--text-tertiary)">
                      {r.submittedByName}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={stBadge[r.status]} dot>
                      {stLabel(r.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {r.decidable && canW ? (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => approveM.mutate({ id: r.id })}
                        >
                          {t.btnOk}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setNote("");
                            setNoteFor(r);
                          }}
                        >
                          {t.btnNote}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setReason("");
                            setNoFor(r);
                          }}
                        >
                          {t.btnNo}
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-(--text-tertiary)">
                        {/* Both accounts are shown, deliberately: an approver
                            may decide its own submission (API design D18), and
                            visibility is what replaces the refusal. */}
                        {r.decidedByName
                          ? `${t.rvDecidedBy} ${r.decidedByName}${
                              r.decidedAt ? ` · ${dateLabel(r.decidedAt)}` : ""
                            }${r.decisionNote ? ` · ${r.decisionNote}` : ""}`
                          : t.apFrozen}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <StateBox
            icon={<CheckCircle2 className="text-(--badge-success-text)" />}
            title={queueQ.isError ? t.rvLoadErr : t.apEmptyT}
            body={
              queueQ.isError
                ? errorMessage(queueQ.error, t.rvLoadErr)
                : t.apEmptyB
            }
          >
            {queueQ.isError ? (
              <Button
                variant="secondary"
                className="mx-auto"
                onClick={() => void queueQ.refetch()}
              >
                {t.rdRetry}
              </Button>
            ) : null}
          </StateBox>
        )}

        <PanelFoot>
          <FootSum>
            {t.attSumA} <b>{pg.range}</b> {t.attSumB} <b>{pg.total}</b>{" "}
            {t.apSumB} · <b>{pendingN}</b> {t.apSumC}
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
        open={noteFor !== null}
        onClose={() => setNoteFor(null)}
        labelledBy="note-t"
      >
        <DialogIcon variant="info">
          <PenLine />
        </DialogIcon>
        <DialogTitle id="note-t">
          {t.noteDlgT1} {noteFor?.employeeName} {t.noteDlgT2}
        </DialogTitle>
        <DialogBody>{t.noteDlgB}</DialogBody>
        <Field label={t.lblNote} htmlFor="ap-note" className="mt-4">
          <Textarea
            id="ap-note"
            placeholder={t.phNote}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <DialogActions>
          <Button variant="ghost" onClick={() => setNoteFor(null)}>
            {t.btnCancel}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              if (noteFor)
                approveM.mutate({ id: noteFor.id, note: note.trim() });
              setNoteFor(null);
            }}
          >
            {t.btnOk}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={noFor !== null}
        onClose={() => setNoFor(null)}
        labelledBy="no-t"
      >
        <DialogIcon variant="warning">
          <TriangleAlert />
        </DialogIcon>
        <DialogTitle id="no-t">
          {t.noDlgT1} {noFor?.employeeName}?
        </DialogTitle>
        <DialogBody>{t.noDlgB}</DialogBody>
        <Field
          label={t.lblWhy}
          htmlFor="ap-reason"
          required
          helper={t.helpWhy}
          className="mt-4"
        >
          <Textarea
            id="ap-reason"
            placeholder={t.phWhy}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <DialogActions>
          <Button variant="ghost" onClick={() => setNoFor(null)}>
            {t.btnCancel}
          </Button>
          {/* Disabled until there is a reason — and refused by the API without
              one regardless, because a disabled button is not a boundary. */}
          <Button
            variant="destructive"
            disabled={!reason.trim() || busy}
            onClick={() => {
              if (noFor)
                rejectM.mutate({ id: noFor.id, reason: reason.trim() });
              setNoFor(null);
            }}
          >
            {t.btnNoDo}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
